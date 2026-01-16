import { atom } from 'recoil';

/**
 * MCP Prompt parameters to inject context into the system prompt.
 * Set via URL query params: ?mcp_server=workspace&mcp_prompt=client_session&contact_id=xxx
 */
export interface MCPPromptParams {
  serverName: string;
  promptName: string;
  promptArgs: Record<string, string>;
}

/**
 * Atom to store MCP prompt parameters extracted from URL.
 * When set, the first message will trigger prompt injection in the backend.
 */
export const mcpPromptState = atom<MCPPromptParams | null>({
  key: 'mcpPromptState',
  default: null,
});
