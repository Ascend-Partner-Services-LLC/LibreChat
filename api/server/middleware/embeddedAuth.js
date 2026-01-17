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
  logger.info('[embeddedAuth] getStoredWorkspaceCookie called for userId:', userId, 'type:', typeof userId);
  logger.info('[embeddedAuth] Current store keys:', Array.from(workspaceCookieStore.keys()));
  
  const stored = workspaceCookieStore.get(userId);
  if (stored && Date.now() - stored.timestamp < CACHE_TTL) {
    const age = Date.now() - stored.timestamp;
    logger.info('[embeddedAuth] ✅ Retrieved stored workspace cookie for user:', userId, 'age:', age, 'ms', 'cookie length:', stored.cookie?.length || 0);
    return stored.cookie;
  }
  if (stored) {
    const age = Date.now() - stored.timestamp;
    logger.warn('[embeddedAuth] ⚠️ Stored cookie expired for user:', userId, 'age:', age, 'ms (TTL:', CACHE_TTL, 'ms)');
  } else {
    logger.warn('[embeddedAuth] ❌ No stored cookie found for user:', userId);
    // Try to find similar keys (in case of format mismatch)
    const allKeys = Array.from(workspaceCookieStore.keys());
    const similarKeys = allKeys.filter(key => key.includes(userId) || userId.includes(key));
    if (similarKeys.length > 0) {
      logger.warn('[embeddedAuth] Found similar keys in store:', similarKeys);
    }
  }
  return null;
}

/**
 * Store workspace cookie for a user
 */
function storeWorkspaceCookie(userId, cookie) {
  logger.info('[embeddedAuth] 🔐 Storing workspace cookie for userId:', userId, 'type:', typeof userId, 'cookie length:', cookie?.length || 0);
  workspaceCookieStore.set(userId, { cookie, timestamp: Date.now() });
  logger.info('[embeddedAuth] Store now contains', workspaceCookieStore.size, 'entries. Keys:', Array.from(workspaceCookieStore.keys()));
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
  
  logger.info('[embeddedAuth] Request received:', {
    path: req.path,
    isEmbedded,
    hasEmbeddedQuery: req.query.embedded === 'true',
    hasEmbeddedHeader: req.headers['x-embedded-mode'] === 'true',
    hasWorkspaceCookieQuery: !!req.query.workspace_cookie,
    workspaceCookieQueryLength: req.query.workspace_cookie?.length || 0,
    hasCookieHeader: !!req.headers.cookie,
    hasUser: !!req.user,
    userId: req.user?._id?.toString() || req.user?.id?.toString() || 'none'
  });
  
  if (!isEmbedded) {
    logger.debug('[embeddedAuth] Skipping - not embedded mode');
    return next();
  }

  // Check for workspace cookie first (even if user is already authenticated)
  // We need to store it for MCP forwarding even if user already has JWT tokens
  // Try multiple sources: 1) URL query param (for cross-origin iframe), 2) Cookie header
  let workspaceCookie = req.query.workspace_cookie;
  let parsedCookies = {};
  
  logger.info('[embeddedAuth] Checking for workspace cookie:', {
    fromQueryParam: !!workspaceCookie,
    queryParamLength: workspaceCookie?.length || 0
  });
  
  if (!workspaceCookie) {
    const cookieHeader = req.headers.cookie;
    if (cookieHeader) {
      parsedCookies = cookies.parse(cookieHeader);
      workspaceCookie = parsedCookies._workspacex_key;
      logger.info('[embeddedAuth] Checked cookie header:', {
        hasCookieHeader: true,
        cookieKeys: Object.keys(parsedCookies),
        foundWorkspaceCookie: !!workspaceCookie,
        workspaceCookieLength: workspaceCookie?.length || 0
      });
    } else {
      logger.info('[embeddedAuth] No cookie header present');
    }
  }
  
  // If user is already authenticated but we have a workspace cookie, store it for MCP forwarding
  if (req.user && workspaceCookie) {
    const userId = req.user._id?.toString() || req.user.id?.toString();
    logger.info('[embeddedAuth] ✅ User already authenticated with workspace cookie. User object:', {
      _id: req.user._id?.toString(),
      id: req.user.id?.toString(),
      email: req.user.email,
      userId: userId,
      userIdType: typeof userId,
      userIdLength: userId?.length || 0
    });
    
    if (!userId) {
      logger.error('[embeddedAuth] ❌ Cannot store cookie - no valid user ID found!', {
        userObject: JSON.stringify(req.user, null, 2)
      });
    } else {
      storeWorkspaceCookie(userId, workspaceCookie);
      logger.info('[embeddedAuth] ✅ Stored workspace cookie for already-authenticated user:', req.user.email, 'userId:', userId, 'cookie length:', workspaceCookie.length, 'source:', req.query.workspace_cookie ? 'query-param' : 'cookie-header');
    }
    return next();
  }
  
  if (!workspaceCookie) {
    logger.warn('[embeddedAuth] ⚠️ No workspace cookie found (checked query param and cookie header)', {
      hasUser: !!req.user,
      userId: req.user?._id?.toString() || req.user?.id?.toString() || 'none',
      queryParams: Object.keys(req.query),
      cookieHeaderPresent: !!req.headers.cookie
    });
    // If user is already authenticated, continue (don't block)
    if (req.user) {
      logger.info('[embeddedAuth] User authenticated but no workspace cookie - continuing anyway');
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
      const userId = user._id?.toString() || user.id?.toString();
      logger.info('[embeddedAuth] Found/created user. User object:', {
        _id: user._id?.toString(),
        id: user.id?.toString(),
        email: user.email,
        userId: userId
      });
      storeWorkspaceCookie(userId, workspaceCookie);
      logger.info('[embeddedAuth] Stored workspace cookie for user:', user.email, 'userId:', userId);
      
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
