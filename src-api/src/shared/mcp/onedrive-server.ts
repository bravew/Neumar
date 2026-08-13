/**
 * OneDrive MCP Server (first-party)
 *
 * Curated tool surface backed by Microsoft Graph (`/me/drive`). Tokens
 * come from the native OAuth path — no Composio. Tool shapes mirror the
 * Box / Google Drive / Dropbox servers so the agent's mental model is
 * consistent across providers.
 *
 * Reference: https://learn.microsoft.com/en-us/graph/api/resources/onedrive
 */
import { readFile } from 'node:fs/promises';
import nodePath from 'node:path';

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import { getConnectionBroker } from '@/shared/auth/connection-broker';
import { OneDriveLocalAdapter } from '@/shared/integrations/cloud-storage/providers/onedrive-local-adapter';
import { errorMessage } from '@/shared/utils/errors';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('OneDriveMCP');

const GRAPH_API = 'https://graph.microsoft.com/v1.0';
const MAX_PAYLOAD_BYTES = 200_000;

async function graphFetch(
  path: string,
  init: RequestInit = {},
): Promise<Record<string, unknown>> {
  const client = await getConnectionBroker().getServiceClient('onedrive');
  const url = path.startsWith('http') ? path : `${GRAPH_API}${path}`;
  const headers = new Headers(init.headers);
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');
  const response = await client(url, { ...init, headers });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`OneDrive API ${response.status}: ${text.slice(0, 300)}`);
  }
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

function summarize(value: unknown): unknown {
  const json = JSON.stringify(value);
  if (json.length <= MAX_PAYLOAD_BYTES) return value;
  return {
    truncated: true,
    note: `Output ${json.length} bytes truncated to ${MAX_PAYLOAD_BYTES}.`,
    preview: json.slice(0, MAX_PAYLOAD_BYTES),
  };
}

function asText(value: unknown): {
  content: [{ type: 'text'; text: string }];
} {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  };
}

function asError(err: unknown) {
  logger.warn('OneDrive tool failed', { error: errorMessage(err) });
  return {
    content: [
      {
        type: 'text' as const,
        text: `OneDrive error: ${errorMessage(err)}`,
      },
    ],
    isError: true,
  };
}

function itemPath(idOrRoot: string | undefined): string {
  if (!idOrRoot || idOrRoot === 'root') return '/me/drive/root';
  return `/me/drive/items/${encodeURIComponent(idOrRoot)}`;
}

export const onedriveTools = [
  tool(
    'onedrive_list_children',
    `List the children of a OneDrive folder.

Pass parent id "root" (or omit) for the user's drive root. Use \`top\` for the page size. The response includes \`@odata.nextLink\` if more pages exist; pass that as \`nextLink\` to continue.`,
    {
      parentId: z
        .string()
        .optional()
        .default('root')
        .describe('Folder id ("root" = drive root). Default: "root".'),
      top: z.number().int().min(1).max(200).optional().default(50),
      nextLink: z
        .string()
        .optional()
        .describe('@odata.nextLink from a previous response to paginate.'),
    },
    async (input) => {
      try {
        const url =
          input.nextLink ??
          `${itemPath(input.parentId)}/children?$top=${input.top ?? 50}`;
        const body = await graphFetch(url);
        return asText(summarize(body));
      } catch (err) {
        return asError(err);
      }
    },
  ),
  tool(
    'onedrive_search',
    `Search the user's OneDrive for files/folders by name or content.`,
    {
      query: z.string().min(1).describe('Search terms.'),
      top: z.number().int().min(1).max(200).optional().default(50),
    },
    async (input) => {
      try {
        const q = encodeURIComponent(input.query.replace(/'/g, "''"));
        const body = await graphFetch(
          `/me/drive/root/search(q='${q}')?$top=${input.top ?? 50}`,
        );
        return asText(summarize(body));
      } catch (err) {
        return asError(err);
      }
    },
  ),
  tool(
    'onedrive_get_metadata',
    `Get metadata for a single DriveItem by id (or "root" for the drive root).`,
    { itemId: z.string() },
    async (input) => {
      try {
        const body = await graphFetch(itemPath(input.itemId));
        return asText(body);
      } catch (err) {
        return asError(err);
      }
    },
  ),
  tool(
    'onedrive_download_file',
    `Download a file's contents by id. Returns UTF-8 text for text-like files (up to 200 KB) or a base64 preview for binaries.`,
    {
      itemId: z.string(),
      asText: z
        .boolean()
        .optional()
        .default(true)
        .describe('When true, decode as UTF-8 text. Default: true.'),
    },
    async (input) => {
      try {
        const client = await getConnectionBroker().getServiceClient('onedrive');
        const response = await client(
          `${GRAPH_API}${itemPath(input.itemId)}/content`,
          { redirect: 'follow' },
        );
        if (!response.ok) {
          throw new Error(`OneDrive download failed (${response.status})`);
        }
        const buffer = await response.arrayBuffer();
        if (input.asText !== false) {
          const text = new TextDecoder('utf-8', { fatal: false }).decode(
            buffer.slice(0, MAX_PAYLOAD_BYTES),
          );
          return asText({
            bytes: buffer.byteLength,
            truncated: buffer.byteLength > MAX_PAYLOAD_BYTES,
            text,
          });
        }
        const slice = Buffer.from(
          buffer.slice(0, Math.min(buffer.byteLength, MAX_PAYLOAD_BYTES)),
        );
        return asText({
          bytes: buffer.byteLength,
          truncated: buffer.byteLength > MAX_PAYLOAD_BYTES,
          base64Preview: slice.toString('base64'),
        });
      } catch (err) {
        return asError(err);
      }
    },
  ),
  tool(
    'onedrive_upload_file',
    `Upload a local file to OneDrive. Use this whenever the user asks to upload, publish, save, or send a generated/local file to OneDrive. \`filePath\` must be an absolute path the API server can read; \`parentId\` is the destination OneDrive folder id (omit or pass empty for root). \`name\` defaults to the source filename. Files larger than 4 MiB automatically use Graph's upload-session API with 10 MiB chunks and per-chunk retry. Returns the new OneDrive file's id, name, parent, and size.`,
    {
      filePath: z.string().min(1),
      parentId: z.string().optional(),
      name: z.string().optional(),
      mimeType: z.string().optional(),
      overwrite: z.boolean().default(false),
    },
    async (input) => {
      try {
        const buffer = await readFile(input.filePath);
        const adapter = new OneDriveLocalAdapter();
        const result = await adapter.upload({
          parentId: input.parentId ?? null,
          name: input.name ?? nodePath.basename(input.filePath),
          content: new Blob([new Uint8Array(buffer).buffer], {
            type: input.mimeType ?? 'application/octet-stream',
          }),
          mimeType: input.mimeType,
          overwrite: input.overwrite,
        });
        return asText({
          id: result.id,
          name: result.name,
          parentId: result.parentId,
          size: result.size,
          mimeType: result.mimeType,
        });
      } catch (err) {
        return asError(err);
      }
    },
  ),
  tool(
    'onedrive_create_share_link',
    `Create or retrieve an anonymous share link for a DriveItem. \`type\` is "view" (default) or "edit".`,
    {
      itemId: z.string(),
      type: z.enum(['view', 'edit']).optional().default('view'),
    },
    async (input) => {
      try {
        const body = await graphFetch(`${itemPath(input.itemId)}/createLink`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: input.type ?? 'view',
            scope: 'anonymous',
          }),
        });
        return asText(body);
      } catch (err) {
        return asError(err);
      }
    },
  ),
];

export const ONEDRIVE_TOOL_NAMES = onedriveTools.map((t) => t.name);

export function createOneDriveMcpServer() {
  return createSdkMcpServer({
    name: 'onedrive',
    version: '1.0.0',
    tools: onedriveTools,
  });
}
