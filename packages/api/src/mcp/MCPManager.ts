import pick from 'lodash/pick';
import { logger } from '@librechat/data-schemas';
import { CallToolResultSchema, ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import type { RequestOptions } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { TokenMethods, IUser } from '@librechat/data-schemas';
import type { FlowStateManager } from '~/flow/manager';
import type { MCPOAuthTokens } from './oauth';
import type { RequestBody } from '~/types';
import type * as t from './types';
import { UserConnectionManager } from './UserConnectionManager';
import { ConnectionsRepository } from './ConnectionsRepository';
import { MCPServerInspector } from './registry/MCPServerInspector';
import { MCPServersInitializer } from './registry/MCPServersInitializer';
import { MCPServersRegistry } from './registry/MCPServersRegistry';
import { formatToolContent } from './parsers';
import { MCPConnection } from './connection';
import { processMCPEnv } from '~/utils/env';

/**
 * Centralized manager for MCP server connections and tool execution.
 * Extends UserConnectionManager to handle both app-level and user-specific connections.
 */
export class MCPManager extends UserConnectionManager {
  private static instance: MCPManager | null;

  /** Creates and initializes the singleton MCPManager instance */
  public static async createInstance(configs: t.MCPServers): Promise<MCPManager> {
    if (MCPManager.instance) throw new Error('MCPManager has already been initialized.');
    MCPManager.instance = new MCPManager();
    await MCPManager.instance.initialize(configs);
    return MCPManager.instance;
  }

  /** Returns the singleton MCPManager instance */
  public static getInstance(): MCPManager {
    if (!MCPManager.instance) throw new Error('MCPManager has not been initialized.');
    return MCPManager.instance;
  }

  /** Initializes the MCPManager by setting up server registry and app connections */
  public async initialize(configs: t.MCPServers) {
    await MCPServersInitializer.initialize(configs);
    this.appConnections = new ConnectionsRepository(undefined);
  }

  /** Retrieves an app-level or user-specific connection based on provided arguments */
  public async getConnection(
    args: {
      serverName: string;
      user?: IUser;
      forceNew?: boolean;
      flowManager?: FlowStateManager<MCPOAuthTokens | null>;
    } & Omit<t.OAuthConnectionOptions, 'useOAuth' | 'user' | 'flowManager'>,
  ): Promise<MCPConnection> {
    //the get method checks if the config is still valid as app level
    const existingAppConnection = await this.appConnections!.get(args.serverName);
    if (existingAppConnection) {
      return existingAppConnection;
    } else if (args.user?.id) {
      return this.getUserConnection(args as Parameters<typeof this.getUserConnection>[0]);
    } else {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `No connection found for server ${args.serverName}`,
      );
    }
  }

  /** Returns all available tool functions from app-level connections */
  public async getAppToolFunctions(): Promise<t.LCAvailableTools> {
    const toolFunctions: t.LCAvailableTools = {};
    const configs = await MCPServersRegistry.getInstance().getAllServerConfigs();
    for (const config of Object.values(configs)) {
      if (config.toolFunctions != null) {
        Object.assign(toolFunctions, config.toolFunctions);
      }
    }
    return toolFunctions;
  }

  /** Returns all available tool functions from all connections available to user */
  public async getServerToolFunctions(
    userId: string,
    serverName: string,
  ): Promise<t.LCAvailableTools | null> {
    try {
      //try get the appConnection (if the config is not in the app level anymore any existing connection will disconnect and get will return null)
      const existingAppConnection = await this.appConnections?.get(serverName);
      if (existingAppConnection) {
        return MCPServerInspector.getToolFunctions(serverName, existingAppConnection);
      }

      const userConnections = this.getUserConnections(userId);
      if (!userConnections || userConnections.size === 0) {
        return null;
      }
      if (!userConnections.has(serverName)) {
        return null;
      }

      return MCPServerInspector.getToolFunctions(serverName, userConnections.get(serverName)!);
    } catch (error) {
      logger.warn(
        `[getServerToolFunctions] Error getting tool functions for server ${serverName}`,
        error,
      );
      return null;
    }
  }

  /**
   * Get instructions for MCP servers
   * @param serverNames Optional array of server names. If not provided or empty, returns all servers.
   * @returns Object mapping server names to their instructions
   */
  private async getInstructions(serverNames?: string[]): Promise<Record<string, string>> {
    const instructions: Record<string, string> = {};
    const configs = await MCPServersRegistry.getInstance().getAllServerConfigs();
    for (const [serverName, config] of Object.entries(configs)) {
      if (config.serverInstructions != null) {
        instructions[serverName] = config.serverInstructions as string;
      }
    }
    if (!serverNames) return instructions;
    return pick(instructions, serverNames);
  }

  /**
   * Format MCP server instructions for injection into context
   * @param serverNames Optional array of server names to include. If not provided, includes all servers.
   * @returns Formatted instructions string ready for context injection
   */
  public async formatInstructionsForContext(serverNames?: string[]): Promise<string> {
    /** Instructions for specified servers or all stored instructions */
    const instructionsToInclude = await this.getInstructions(serverNames);

    if (Object.keys(instructionsToInclude).length === 0) {
      return '';
    }

    // Format instructions for context injection
    const formattedInstructions = Object.entries(instructionsToInclude)
      .map(([serverName, instructions]) => {
        return `## ${serverName} MCP Server Instructions

${instructions}`;
      })
      .join('\n\n');

    return `# MCP Server Instructions

The following MCP servers are available with their specific instructions:

${formattedInstructions}

Please follow these instructions when using tools from the respective MCP servers.`;
  }

  /**
   * Calls a tool on an MCP server, using either a user-specific connection
   * (if userId is provided) or an app-level connection. Updates the last activity timestamp
   * for user-specific connections upon successful call initiation.
   */
  async callTool({
    user,
    serverName,
    toolName,
    provider,
    toolArguments,
    options,
    tokenMethods,
    requestBody,
    flowManager,
    oauthStart,
    oauthEnd,
    customUserVars,
  }: {
    user?: IUser;
    serverName: string;
    toolName: string;
    provider: t.Provider;
    toolArguments?: Record<string, unknown>;
    options?: RequestOptions;
    requestBody?: RequestBody;
    tokenMethods?: TokenMethods;
    customUserVars?: Record<string, string>;
    flowManager: FlowStateManager<MCPOAuthTokens | null>;
    oauthStart?: (authURL: string) => Promise<void>;
    oauthEnd?: () => Promise<void>;
  }): Promise<t.FormattedToolResponse> {
    /** User-specific connection */
    let connection: MCPConnection | undefined;
    const userId = user?.id;
    const logPrefix = userId ? `[MCP][User: ${userId}][${serverName}]` : `[MCP][${serverName}]`;

    try {
      if (userId && user) this.updateUserLastActivity(userId);

      connection = await this.getConnection({
        serverName,
        user,
        flowManager,
        tokenMethods,
        oauthStart,
        oauthEnd,
        signal: options?.signal,
        customUserVars,
        requestBody,
      });

      if (!(await connection.isConnected())) {
        /** May happen if getUserConnection failed silently or app connection dropped */
        throw new McpError(
          ErrorCode.InternalError, // Use InternalError for connection issues
          `${logPrefix} Connection is not active. Cannot execute tool ${toolName}.`,
        );
      }

      const rawConfig = (await MCPServersRegistry.getInstance().getServerConfig(
        serverName,
        userId,
      )) as t.MCPOptions;
      const currentOptions = processMCPEnv({
        user,
        options: rawConfig,
        customUserVars: customUserVars,
        body: requestBody,
      });
      
      // Build headers: merge config headers with forwarded cookies
      const headers: Record<string, string> = {};
      if ('headers' in currentOptions && currentOptions.headers) {
        Object.assign(headers, currentOptions.headers);
      }
      
      // Forward workspace cookies from the original request to MCP server
      // This enables MCP servers to authenticate using the user's session
      const mcpCookies = (requestBody as { mcpCookies?: Record<string, string> })?.mcpCookies;
      logger.info(`${logPrefix} requestBody keys: ${Object.keys(requestBody || {}).join(', ')}`);
      logger.info(`${logPrefix} mcpCookies present: ${!!mcpCookies}`);
      if (mcpCookies) {
        const cookieStr = Object.entries(mcpCookies)
          .map(([key, value]) => `${key}=${value}`)
          .join('; ');
        headers['Cookie'] = cookieStr;
        logger.info(`${logPrefix} Forwarding cookies to MCP server: ${Object.keys(mcpCookies).join(', ')}`);
      }
      
      if (Object.keys(headers).length > 0) {
        connection.setRequestHeaders(headers);
      }

      const result = await connection.client.request(
        {
          method: 'tools/call',
          params: {
            name: toolName,
            arguments: toolArguments,
          },
        },
        CallToolResultSchema,
        {
          timeout: connection.timeout,
          resetTimeoutOnProgress: true,
          ...options,
        },
      );
      if (userId) {
        this.updateUserLastActivity(userId);
      }
      this.checkIdleConnections();
      return formatToolContent(result as t.MCPToolCallResponse, provider);
    } catch (error) {
      // Log with context and re-throw or handle as needed
      logger.error(`${logPrefix}[${toolName}] Tool call failed`, error);
      // Rethrowing allows the caller (createMCPTool) to handle the final user message
      throw error;
    }
  }

  /**
   * Get a prompt from an MCP server and return its content.
   * This is used to inject dynamic context into conversations.
   * 
   * @param serverName - The name of the MCP server
   * @param promptName - The name of the prompt to get
   * @param promptArgs - Arguments to pass to the prompt
   * @param requestBody - Request body containing cookies for auth forwarding
   * @param user - Optional user object for user-specific connections
   * @returns The prompt content as a string, or null if not found
   */
  public async getPrompt(
    serverName: string,
    promptName: string,
    promptArgs: Record<string, string>,
    requestBody?: RequestBody,
    user?: IUser,
  ): Promise<string | null> {
    const logPrefix = `[MCP][${serverName}]`;
    
    try {
      // Get connection to the MCP server, passing requestBody so cookies are set during connection
      // If user is provided, create a user-specific connection (needed for cookies)
      const connection = await this.getConnection({ 
        serverName,
        user,
        requestBody,
      });
      if (!connection) {
        logger.warn(`${logPrefix} No connection found for prompt request`);
        return null;
      }

      // Ensure cookies are set on the connection (in case it was reused from cache)
      // This is critical for prompt requests which need authentication
      if (requestBody) {
        const mcpCookies = (requestBody as { mcpCookies?: Record<string, string> })?.mcpCookies;
        if (mcpCookies) {
          const cookieStr = Object.entries(mcpCookies)
            .map(([key, value]) => `${key}=${value}`)
            .join('; ');
          connection.setRequestHeaders({ Cookie: cookieStr });
          logger.info(`${logPrefix} Set cookies on connection for prompt request: ${Object.keys(mcpCookies).join(', ')}`);
        }
      }

      logger.info(`${logPrefix} Getting prompt: ${promptName} with args:`, promptArgs);

      // Call prompts/get on the MCP server
      const result = await connection.client.getPrompt({
        name: promptName,
        arguments: promptArgs,
      });

      if (!result || !result.messages || result.messages.length === 0) {
        logger.warn(`${logPrefix} Prompt returned no messages`);
        return null;
      }

      // Extract text content from prompt messages
      const content = result.messages
        .map((msg) => {
          if (msg.content.type === 'text') {
            return msg.content.text;
          }
          return '';
        })
        .filter(Boolean)
        .join('\n\n');

      logger.info(`${logPrefix} Got prompt content (${content.length} chars)`);
      return content;
    } catch (error) {
      logger.error(`${logPrefix} Failed to get prompt "${promptName}":`, error);
      return null;
    }
  }
}
