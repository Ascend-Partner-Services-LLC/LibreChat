/**
 * Embedded Authentication Middleware
 * 
 * Allows workspace-ui to embed LibreChat with automatic authentication.
 * When `embedded=true` query param is present and a valid workspace cookie exists,
 * the user is automatically authenticated without requiring LibreChat login.
 * 
 * Flow:
 * 1. Check for embedded=true and _workspacex_key cookie
 * 2. Validate cookie against workspace backend
 * 3. Find or create user in LibreChat database
 * 4. Set JWT tokens in cookies (so frontend recognizes auth)
 * 5. Set req.user for downstream middleware
 */

const { logger } = require('@librechat/data-schemas');
const cookies = require('cookie');
const { findUser, createUser, getUserById } = require('~/models');
const { setAuthTokens } = require('~/server/services/AuthService');

// Cache validated users to avoid repeated API calls
const userCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Store workspace cookies by LibreChat user ID (for MCP forwarding)
// This is needed because API requests from the iframe don't include the workspace cookie
const workspaceCookieStore = new Map();

/**
 * Get stored workspace cookie for a user
 * Used by MCP forwarding when the API request doesn't have the cookie
 */
function getStoredWorkspaceCookie(userId) {
  const stored = workspaceCookieStore.get(userId);
  if (stored && Date.now() - stored.timestamp < CACHE_TTL) {
    logger.debug('[embeddedAuth] Retrieved stored workspace cookie for user:', userId, 'age:', Date.now() - stored.timestamp, 'ms');
    return stored.cookie;
  }
  if (stored) {
    logger.debug('[embeddedAuth] Stored cookie expired for user:', userId, 'age:', Date.now() - stored.timestamp, 'ms');
  } else {
    logger.debug('[embeddedAuth] No stored cookie found for user:', userId);
  }
  return null;
}

/**
 * Store workspace cookie for a user
 */
function storeWorkspaceCookie(userId, cookie) {
  workspaceCookieStore.set(userId, { cookie, timestamp: Date.now() });
}

/**
 * Validate workspace cookie and get user info from workspace backend
 */
async function validateWorkspaceCookie(workspaceCookie, workspaceApiUrl) {
  try {
    const response = await fetch(`${workspaceApiUrl}/employee_auth/me`, {
      headers: {
        Cookie: workspaceCookie,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      logger.debug('[embeddedAuth] Workspace cookie validation failed:', response.status);
      return null;
    }

    const data = await response.json();
    // Handle wrapped response
    const userData = data.data || data;
    
    return {
      id: userData.id,
      email: userData.email,
      name: userData.name || userData.displayName || userData.first_name,
      firmId: userData.firm_id || userData.firmId,
    };
  } catch (error) {
    logger.error('[embeddedAuth] Error validating workspace cookie:', error);
    return null;
  }
}

/**
 * Find or create a LibreChat user based on workspace user info
 */
async function findOrCreateUser(workspaceUser) {
  // Check cache first
  const cacheKey = `workspace_${workspaceUser.id}`;
  const cached = userCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.user;
  }

  // Find existing user by email
  let user = await findUser({ email: workspaceUser.email });

  if (!user) {
    // Create new user for embedded access
    user = await createUser({
      email: workspaceUser.email,
      name: workspaceUser.name || workspaceUser.email.split('@')[0],
      username: workspaceUser.email.split('@')[0],
      emailVerified: true, // Trust workspace auth
      provider: 'workspace', // Mark as workspace-authenticated user
    });
    logger.info('[embeddedAuth] Created new user for workspace user:', workspaceUser.email);
  }

  // Cache the user
  userCache.set(cacheKey, { user, timestamp: Date.now() });

  return user;
}

/**
 * Middleware to handle embedded authentication
 */
const embeddedAuth = async (req, res, next) => {
  // Skip if not embedded mode
  const isEmbedded = req.query.embedded === 'true' || req.headers['x-embedded-mode'] === 'true';
  if (!isEmbedded) {
    return next();
  }

  // Check for workspace cookie first (even if user is already authenticated)
  // We need to store it for MCP forwarding even if user already has JWT tokens
  // Try multiple sources: 1) URL query param (for cross-origin iframe), 2) Cookie header
  let workspaceCookie = req.query.workspace_cookie;
  
  if (!workspaceCookie) {
    const cookieHeader = req.headers.cookie;
    if (cookieHeader) {
      const parsedCookies = cookies.parse(cookieHeader);
      workspaceCookie = parsedCookies._workspacex_key;
    }
  }
  
  // If user is already authenticated but we have a workspace cookie, store it for MCP forwarding
  if (req.user && workspaceCookie) {
    storeWorkspaceCookie(req.user._id.toString(), workspaceCookie);
    logger.info('[embeddedAuth] Stored workspace cookie for already-authenticated user:', req.user.email, 'cookie length:', workspaceCookie.length, 'source:', req.query.workspace_cookie ? 'query-param' : 'cookie-header');
    return next();
  }
  
  if (!workspaceCookie) {
    logger.debug('[embeddedAuth] No workspace cookie found (checked query param and cookie header)');
    // If user is already authenticated, continue (don't block)
    if (req.user) {
      return next();
    }
    return next();
  }

  // Validate against workspace backend
  const workspaceApiUrl = process.env.WORKSPACE_API_URL;
  if (!workspaceApiUrl) {
    logger.warn('[embeddedAuth] WORKSPACE_API_URL not configured');
    return next();
  }

  const workspaceUser = await validateWorkspaceCookie(
    `_workspacex_key=${workspaceCookie}`,
    workspaceApiUrl
  );

  if (!workspaceUser) {
    logger.debug('[embeddedAuth] Invalid workspace cookie');
    return next();
  }

  // Find or create LibreChat user
  try {
    const user = await findOrCreateUser(workspaceUser);
    if (user) {
      req.user = user;
      
      // Store workspace cookie for MCP forwarding
      // This is needed because API requests from iframe don't include the workspace cookie
      storeWorkspaceCookie(user._id.toString(), workspaceCookie);
      logger.info('[embeddedAuth] Stored workspace cookie for user:', user.email);
      
      // Check if we already have valid LibreChat tokens
      const existingToken = parsedCookies.token;
      if (!existingToken) {
        // Set JWT tokens so frontend recognizes authentication
        // This prevents redirect to login/OIDC
        await setAuthTokens(user._id, res);
        logger.info('[embeddedAuth] Set auth tokens for embedded user:', user.email);
      }
      
      logger.debug('[embeddedAuth] Authenticated embedded user:', user.email);
    }
  } catch (error) {
    logger.error('[embeddedAuth] Error finding/creating user:', error);
  }

  next();
};

module.exports = { embeddedAuth, getStoredWorkspaceCookie };
