export interface MCPPreset {
  id: string;
  name: string;
  description: string;
  type: 'stdio' | 'http' | 'sse';
  command?: string;
  args?: string[];
  url?: string;
  /** True when the remote server requires an OAuth browser flow to authenticate */
  requiresOAuth?: boolean;
  /** Path to icon image relative to public root (e.g. "/mcp-icons/notion.svg") */
  icon?: string;
  /** Advertised tool count from the provider catalog, when known. */
  advertisedToolCount?: number;
}

export interface KeyValuePair {
  id: string;
  key: string;
  value: string;
}

export interface ConfigDialogState {
  open: boolean;
  mode: 'add' | 'edit';
  serverName: string;
  transportType: 'stdio' | 'http' | 'sse';
  command: string;
  args: string[];
  env: KeyValuePair[];
  url: string;
  headers: KeyValuePair[];
  editServerId?: string;
}
