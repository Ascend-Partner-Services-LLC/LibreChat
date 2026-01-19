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
const { getAppConfig } = require('~/server/services/Config');
const { getBalanceConfig } = require('@librechat/api');

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
  logger.info(`[embeddedAuth] getStoredWorkspaceCookie called for userId: ${userId}, type: ${typeof userId}`);
  logger.info(`[embeddedAuth] Current store keys: ${Array.from(workspaceCookieStore.keys()).join(', ')}`);
  
  const stored = workspaceCookieStore.get(userId);
  if (stored && Date.now() - stored.timestamp < CACHE_TTL) {
    const age = Date.now() - stored.timestamp;
    logger.info(`[embeddedAuth] ✅ Retrieved stored workspace cookie for user: ${userId}, age: ${age}ms, cookie length: ${stored.cookie?.length || 0}`);
    return stored.cookie;
  }
  if (stored) {
    const age = Date.now() - stored.timestamp;
    logger.warn(`[embeddedAuth] ⚠️ Stored cookie expired for user: ${userId}, age: ${age}ms (TTL: ${CACHE_TTL}ms)`);
  } else {
    logger.warn(`[embeddedAuth] ❌ No stored cookie found for user: ${userId}`);
    // Try to find similar keys (in case of format mismatch)
    const allKeys = Array.from(workspaceCookieStore.keys());
    const similarKeys = allKeys.filter(key => key.includes(userId) || userId.includes(key));
    if (similarKeys.length > 0) {
      logger.warn(`[embeddedAuth] Found similar keys in store: ${similarKeys.join(', ')}`);
    }
  }
  return null;
}

/**
 * Store workspace cookie for a user
 * Normalizes cookie to store only the value part (without _workspacex_key= prefix)
 */
function storeWorkspaceCookie(userId, cookie) {
  // Normalize: extract just the value part (remove _workspacex_key= prefix if present)
  let cookieValue = cookie;
  if (cookie && cookie.startsWith('_workspacex_key=')) {
    cookieValue = cookie.substring('_workspacex_key='.length);
  }
  
  logger.info(`[embeddedAuth] 🔐 Storing workspace cookie for userId: ${userId}, type: ${typeof userId}, cookie length: ${cookieValue?.length || 0}`);
  workspaceCookieStore.set(userId, { cookie: cookieValue, timestamp: Date.now() });
  logger.info(`[embeddedAuth] Store now contains ${workspaceCookieStore.size} entries. Keys: ${Array.from(workspaceCookieStore.keys()).join(', ')}`);
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
    // Get app config and balance config for new user creation
    const appConfig = await getAppConfig();
    const balanceConfig = getBalanceConfig(appConfig);
    
    // Create new user for embedded access
    user = await createUser({
      email: workspaceUser.email,
      name: workspaceUser.name || workspaceUser.email.split('@')[0],
      username: workspaceUser.email.split('@')[0],
      emailVerified: true, // Trust workspace auth
      provider: 'workspace', // Mark as workspace-authenticated user
    }, balanceConfig);
    logger.info(`[embeddedAuth] Created new user for workspace user: ${workspaceUser.email} with balance config:`, balanceConfig);
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
  
  logger.info(`[embeddedAuth] 📥 Request received: path=${req.path}, isEmbedded=${isEmbedded}, hasEmbeddedQuery=${req.query.embedded === 'true'}, hasWorkspaceCookieQuery=${!!req.query.workspace_cookie}, workspaceCookieQueryLength=${req.query.workspace_cookie?.length || 0}, hasCookieHeader=${!!req.headers.cookie}, hasUser=${!!req.user}, userId=${req.user?._id?.toString() || req.user?.id?.toString() || 'none'}, queryParams=${Object.keys(req.query).join(',')}, userAgent=${req.headers['user-agent']?.substring(0, 50) || 'unknown'}`);
  
  if (!isEmbedded) {
    logger.debug('[embeddedAuth] Skipping - not embedded mode');
    return next();
  }

  // Get workspace cookie from query parameter (set by frontend from backend response body)
  // The workspace backend now returns workspace_cookie in the response body for login/me endpoints
  // Frontend passes it via query param since cookies may not be sent in cross-origin iframes
  let workspaceCookie = req.query.workspace_cookie;
  let parsedCookies = {};
  
  logger.info(`[embeddedAuth] Checking for workspace cookie: fromQueryParam=${!!workspaceCookie}, queryParamLength=${workspaceCookie?.length || 0}, queryParamValue=${workspaceCookie ? workspaceCookie.substring(0, 20) + '...' : 'none'}`);
  
  // Parse existing cookies for token check (but don't use for workspace cookie)
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    parsedCookies = cookies.parse(cookieHeader);
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
      logger.info(`[embeddedAuth] ✅ Stored workspace cookie for already-authenticated user: ${req.user.email}, userId: ${userId}, cookie length: ${workspaceCookie.length}, source: ${req.query.workspace_cookie ? 'query-param' : 'cookie-header'}`);
    }
    return next();
  }
  
  if (!workspaceCookie) {
    logger.warn(`[embeddedAuth] ⚠️ No workspace cookie found in query param: hasUser=${!!req.user}, userId=${req.user?._id?.toString() || req.user?.id?.toString() || 'none'}, queryParams=${Object.keys(req.query).join(',')}, fullUrl=${req.protocol}://${req.get('host')}${req.originalUrl}`);
    // If user is already authenticated, continue (don't block)
    if (req.user) {
      logger.info('[embeddedAuth] User authenticated but no workspace cookie - continuing anyway');
      return next();
    }
    return next();
  }
  
  // Normalize cookie format - frontend passes it as "_workspacex_key=value" from backend response
  // Ensure it's in the correct format for validation
  if (!workspaceCookie.startsWith('_workspacex_key=')) {
    // If just the value, prepend the key name
    workspaceCookie = `_workspacex_key=${workspaceCookie}`;
  }

  // Validate against workspace backend
  const workspaceApiUrl = process.env.WORKSPACE_API_URL;
  if (!workspaceApiUrl) {
    logger.warn('[embeddedAuth] WORKSPACE_API_URL not configured');
    return next();
  }

  const workspaceUser = await validateWorkspaceCookie(
    workspaceCookie,
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
      logger.info('[embeddedAuth] ✅ Found/created user. User object:', {
        _id: user._id?.toString(),
        id: user.id?.toString(),
        email: user.email,
        userId: userId
      });
      storeWorkspaceCookie(userId, workspaceCookie);
      logger.info(`[embeddedAuth] 🍪 Stored workspace cookie for user: ${user.email}, userId: ${userId}, cookieLength: ${workspaceCookie.length}`);
      
      // Check if we already have valid LibreChat tokens
      const existingToken = parsedCookies.token;
      if (!existingToken) {
        // Set JWT tokens so frontend recognizes authentication
        // This prevents redirect to login/OIDC
        // Use isEmbedded: true to set cookies with SameSite=None for cross-origin iframes (incognito mode)
        logger.info(`[embeddedAuth] 🔐 Calling setAuthTokens with isEmbedded=true for user: ${user.email}, userId: ${user._id?.toString() || user.id?.toString()}`);
        await setAuthTokens(user._id, res, null, { isEmbedded: true });
        logger.info(`[embeddedAuth] ✅ Auth tokens set for embedded user: ${user.email}`);
      } else {
        logger.info(`[embeddedAuth] ℹ️ User already has auth token, skipping token setup for: ${user.email}`);
      }
      
      logger.info(`[embeddedAuth] ✅ Successfully authenticated embedded user: ${user.email}, userId: ${userId}, hasAuthTokens: ${!!existingToken || 'will be set'}`);
    }
  } catch (error) {
    logger.error('[embeddedAuth] ❌ Error finding/creating user:', error);
  }

  next();
};

module.exports = { embeddedAuth, getStoredWorkspaceCookie };
