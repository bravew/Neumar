/**
 * MCP Config Loader
 *
 * Loads MCP server configuration from the app data directory.
 */

import fs from 'fs/promises';

import { getAppMcpConfigPath } from '@/config/constants';

import { getExternalMcpAuthorizationHeader } from '@/shared/mcp/external-client/tokens';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('MCP');

// MCP Server Config Types (matching SDK types)
export interface McpStdioServerConfig {
  type?: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpHttpServerConfig {
  type: 'http';
  url: string;
  headers?: Record<string, string>;
}

export interface McpSSEServerConfig {
  type: 'sse';
  url: string;
  headers?: Record<string, string>;
}

export type McpServerConfig =
  | McpStdioServerConfig
  | McpHttpServerConfig
  | McpSSEServerConfig;

/**
 * Expected MCP config file shape (mcp.json).
 *
 * Two formats are supported:
 *
 * Format A — wrapped:
 * ```json
 * {
 *   "mcpServers": {
 *     "server-name": { "command": "...", "args": [...] },
 *     "remote-server": { "type": "http", "url": "https://..." }
 *   }
 * }
 * ```
 *
 * Format B — flat (server entries at root level):
 * ```json
 * {
 *   "server-name": { "command": "...", "args": [...] }
 * }
 * ```
 *
 * Each server entry can be:
 *   - Stdio:  `{ command, args?, env?, type?: "stdio" }`
 *   - HTTP:   `{ url, headers?, type?: "http" }`  (default for URL-based)
 *   - SSE:    `{ url, headers?, type: "sse" }`
 */
export interface McpConfigFile {
  mcpServers?: Record<
    string,
    McpStdioServerConfig | McpHttpServerConfig | McpSSEServerConfig
  >;
  [serverName: string]: unknown; // Flat format support
}

/**
 * Get the MCP config path
 */
export function getMcpConfigPath(): string {
  return getAppMcpConfigPath();
}

/**
 * Load MCP servers from a single config file
 */
async function loadMcpServersFromFile(
  configPath: string,
  sourceName: string,
): Promise<Record<string, McpServerConfig>> {
  try {
    await fs.access(configPath);
    const content = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(content);

    // Support both formats: { mcpServers: {...} } and direct { serverName: {...} }
    const mcpServers = config.mcpServers || config;

    if (!mcpServers || typeof mcpServers !== 'object') {
      return {};
    }

    const servers: Record<string, McpServerConfig> = {};

    for (const [name, serverConfig] of Object.entries(mcpServers)) {
      const cfg = serverConfig as Record<string, unknown>;
      if (cfg.url) {
        const headers = await resolveHttpMcpHeaders(
          name,
          cfg.headers as Record<string, string> | undefined,
        );
        // Determine type: use explicit type if provided, otherwise default to 'http'
        // User can specify 'sse' in config if the server uses SSE protocol
        const urlType = (cfg.type as string) || 'http';
        if (urlType === 'sse') {
          servers[name] = {
            type: 'sse',
            url: cfg.url as string,
            headers,
          };
          logger.info(`Loaded SSE server from ${sourceName}: ${name}`);
        } else {
          // Default to HTTP for URL-based MCP servers
          servers[name] = {
            type: 'http',
            url: cfg.url as string,
            headers,
          };
          logger.info(`Loaded HTTP server from ${sourceName}: ${name}`);
        }
      } else if (cfg.command) {
        servers[name] = {
          type: 'stdio',
          command: cfg.command as string,
          args: cfg.args as string[],
          env: cfg.env as Record<string, string>,
        };
        logger.info(`Loaded stdio server from ${sourceName}: ${name}`);
      }
    }

    return servers;
  } catch {
    return {};
  }
}

async function resolveHttpMcpHeaders(
  serverId: string,
  headers: Record<string, string> | undefined,
): Promise<Record<string, string> | undefined> {
  const merged = { ...(headers ?? {}) };
  try {
    const authorization = await getExternalMcpAuthorizationHeader(serverId);
    if (authorization) {
      merged.Authorization = authorization;
    }
  } catch (error) {
    logger.warn(
      `Unable to load encrypted MCP OAuth token for "${serverId}"`,
      error,
    );
  }
  return Object.keys(merged).length ? merged : undefined;
}

/**
 * MCP configuration interface
 */
export interface McpConfig {
  enabled: boolean;
}

/**
 * Load MCP servers configuration from app data directory mcp.json
 *
 * @param mcpConfig Optional config to control loading
 * @returns Record of server name to config
 */
export async function loadMcpServers(
  mcpConfig?: McpConfig,
): Promise<Record<string, McpServerConfig>> {
  // If MCP is globally disabled, return empty
  if (mcpConfig && !mcpConfig.enabled) {
    logger.info('MCP disabled, skipping server load');
    return {};
  }

  const configPath = getMcpConfigPath();
  const servers = await loadMcpServersFromFile(configPath, 'app');

  const serverCount = Object.keys(servers).length;
  if (serverCount > 0) {
    logger.info(`Loaded ${serverCount} MCP server(s)`);
  } else {
    logger.info('No MCP servers found');
  }

  return servers;
}
