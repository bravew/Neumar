/**
 * Gate for MCP Apps `ui://` reads. The URI must be one a connected server
 * advertised on the tool the host says was invoked. Callers never supply
 * the URI themselves.
 */

const UI_RESOURCE_URI = /^ui:\/\/[^\s]+$/;

export interface McpUiToolStatus {
  name: string;
  _meta?: Record<string, unknown>;
}

export interface McpUiServerStatus {
  name: string;
  tools?: McpUiToolStatus[];
}

export function uiResourceUriFromMeta(meta: unknown): string | undefined {
  if (!meta || typeof meta !== 'object') return undefined;
  const record = meta as Record<string, unknown>;
  const ui = record.ui;
  if (ui && typeof ui === 'object') {
    const uri = (ui as Record<string, unknown>).resourceUri;
    if (typeof uri === 'string' && UI_RESOURCE_URI.test(uri)) return uri;
  }
  const flat = record['ui/resourceUri'];
  if (typeof flat === 'string' && UI_RESOURCE_URI.test(flat)) return flat;
  return undefined;
}

/** URI advertised by this server's tool, or undefined when it has no UI. */
export function advertisedUiResourceUri(
  servers: readonly McpUiServerStatus[],
  serverName: string,
  toolName: string,
): string | undefined {
  const server = servers.find((entry) => entry.name === serverName);
  const tool = server?.tools?.find((entry) => entry.name === toolName);
  return tool ? uiResourceUriFromMeta(tool._meta) : undefined;
}
