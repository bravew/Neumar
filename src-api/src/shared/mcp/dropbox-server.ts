/**
 * Dropbox MCP Server (first-party)
 *
 * Curated tool surface backed by the Dropbox HTTP API v2. Tokens come
 * from the native OAuth path (`shared/auth/connection-broker`) — never
 * Composio. Tool shapes mirror the Box / Google Drive servers so an
 * agent can reach for them by the same mental model.
 *
 * Reference: https://www.dropbox.com/developers/documentation/http/documentation
 */
import { readFile } from 'node:fs/promises';
import nodePath from 'node:path';

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import { getConnectionBroker } from '@/shared/auth/connection-broker';
import { DropboxLocalAdapter } from '@/shared/integrations/cloud-storage/providers/dropbox-local-adapter';
import { errorMessage } from '@/shared/utils/errors';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('DropboxMCP');

const DROPBOX_API = 'https://api.dropboxapi.com/2';
const DROPBOX_CONTENT_API = 'https://content.dropboxapi.com/2';
const MAX_PAYLOAD_BYTES = 200_000;

async function rpc(
  path: string,
  body: unknown,
): Promise<Record<string, unknown>> {
  const client = await getConnectionBroker().getServiceClient('dropbox');
  const response = await client(`${DROPBOX_API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Dropbox API ${response.status}: ${text.slice(0, 300)}`);
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
  logger.warn('Dropbox tool failed', { error: errorMessage(err) });
  return {
    content: [
      { type: 'text' as const, text: `Dropbox error: ${errorMessage(err)}` },
    ],
    isError: true,
  };
}

export const dropboxTools = [
  tool(
    'dropbox_list_folder',
    `List files and subfolders at a Dropbox path.

Path "" (empty string) is the user's root. Pass a path like "/Documents" to list a subfolder. Use the returned \`cursor\` with dropbox_list_folder_continue for large folders.`,
    {
      path: z
        .string()
        .default('')
        .describe('Folder path ("" = root). Default: "".'),
      recursive: z.boolean().optional().default(false),
      limit: z.number().int().min(1).max(2000).optional().default(200),
    },
    async (input) => {
      try {
        const body = await rpc('/files/list_folder', {
          path: input.path ?? '',
          recursive: input.recursive ?? false,
          include_deleted: false,
          include_non_downloadable_files: true,
          limit: input.limit ?? 200,
        });
        return asText(summarize(body));
      } catch (err) {
        return asError(err);
      }
    },
  ),
  tool(
    'dropbox_list_folder_continue',
    `Page forward through a previous dropbox_list_folder result using the returned cursor.`,
    { cursor: z.string().describe('Cursor from a prior list response.') },
    async (input) => {
      try {
        const body = await rpc('/files/list_folder/continue', {
          cursor: input.cursor,
        });
        return asText(summarize(body));
      } catch (err) {
        return asError(err);
      }
    },
  ),
  tool(
    'dropbox_search',
    `Search files and folders by name or content across the connected Dropbox account.

\`file_categories\` filters by Dropbox's content category (image, video, audio, document, pdf, paper, spreadsheet, presentation). Omit to search everything.`,
    {
      query: z.string().min(1).describe('Search terms.'),
      path: z
        .string()
        .optional()
        .describe(
          'Restrict to a folder path (e.g. "/Projects"). Default: all.',
        ),
      file_categories: z
        .array(z.string())
        .optional()
        .describe(
          'Filter to one or more categories: image, video, audio, document, pdf, paper, spreadsheet, presentation.',
        ),
      limit: z.number().int().min(1).max(1000).optional().default(100),
    },
    async (input) => {
      try {
        const body = await rpc('/files/search_v2', {
          query: input.query,
          include_highlights: false,
          options: {
            max_results: input.limit ?? 100,
            ...(input.path ? { path: input.path } : {}),
            ...(input.file_categories
              ? { file_categories: input.file_categories }
              : {}),
          },
        });
        return asText(summarize(body));
      } catch (err) {
        return asError(err);
      }
    },
  ),
  tool(
    'dropbox_get_metadata',
    `Get metadata for a single file or folder by path or id.`,
    {
      path: z
        .string()
        .describe('Path ("/path/to/file") or id ("id:xxx") of the item.'),
    },
    async (input) => {
      try {
        const body = await rpc('/files/get_metadata', {
          path: input.path,
          include_deleted: false,
        });
        return asText(body);
      } catch (err) {
        return asError(err);
      }
    },
  ),
  tool(
    'dropbox_download_file',
    `Download a file's contents. Returns UTF-8 text for text-like files (up to 200 KB) or a base64 preview for binaries.`,
    {
      path: z.string().describe('Path or id of the file to download.'),
      asText: z
        .boolean()
        .optional()
        .default(true)
        .describe('When true, decode as UTF-8 text. Default: true.'),
    },
    async (input) => {
      try {
        const client = await getConnectionBroker().getServiceClient('dropbox');
        const response = await client(`${DROPBOX_CONTENT_API}/files/download`, {
          method: 'POST',
          headers: {
            'Dropbox-API-Arg': JSON.stringify({ path: input.path }),
          },
        });
        if (!response.ok) {
          throw new Error(`Dropbox download failed (${response.status})`);
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
    'dropbox_upload_file',
    `Upload a local file to Dropbox. Use this whenever the user asks to upload, publish, save, or send a generated/local file to Dropbox. \`filePath\` must be an absolute path the API server can read. \`parentPath\` is the destination Dropbox folder path (e.g. "" for root, "/Photos"); \`name\` defaults to the source filename. Files >= 150 MB use Dropbox's upload-session API automatically (8 MB chunks). Returns the new Dropbox file's id, name, path, and size.`,
    {
      filePath: z.string().min(1),
      parentPath: z.string().default(''),
      name: z.string().optional(),
      mimeType: z.string().optional(),
      overwrite: z.boolean().default(false),
    },
    async (input) => {
      try {
        const buffer = await readFile(input.filePath);
        const adapter = new DropboxLocalAdapter();
        const result = await adapter.upload({
          parentId: input.parentPath || null,
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
          path: result.path,
          size: result.size,
          mimeType: result.mimeType,
        });
      } catch (err) {
        return asError(err);
      }
    },
  ),
  tool(
    'dropbox_create_shared_link',
    `Create or retrieve a shared link for a file or folder.`,
    { path: z.string() },
    async (input) => {
      try {
        const body = await rpc('/sharing/create_shared_link_with_settings', {
          path: input.path,
        });
        return asText(body);
      } catch (err) {
        // Dropbox returns 409 with shared_link_already_exists; surface the
        // existing link rather than as an error.
        try {
          const existing = await rpc('/sharing/list_shared_links', {
            path: input.path,
            direct_only: true,
          });
          return asText(existing);
        } catch {
          return asError(err);
        }
      }
    },
  ),
];

export const DROPBOX_TOOL_NAMES = dropboxTools.map((t) => t.name);

export function createDropboxMcpServer() {
  return createSdkMcpServer({
    name: 'dropbox',
    version: '1.0.0',
    tools: dropboxTools,
  });
}
