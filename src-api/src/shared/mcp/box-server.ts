/**
 * Box MCP Server (first-party)
 *
 * Direct integration with the Box Content API v2 (`api.box.com/2.0/`).
 * Bypasses Composio's tool-execute shim so the agent gets:
 *   - A curated tool surface (~6 tools instead of 280+).
 *   - Purpose-built descriptions and input schemas, not Composio's
 *     auto-generated JSON Schema mush.
 *   - Lower latency: one direct API call instead of two hops
 *     (`connectors_execute` → Composio → Box).
 *
 * Composio is still the OAuth provider — we fetch the user's access token
 * from Composio at call time via the credential broker. This lets users
 * connect Box through the same Settings → Connectors flow they already
 * use for everything else, while runtime stays first-party.
 *
 * @module mcp/box-server
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import { getConnectionBroker } from '@/shared/auth/connection-broker';
import { BoxLocalAdapter } from '@/shared/integrations/cloud-storage/providers/box-local-adapter';
import { errorMessage } from '@/shared/utils/errors';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('BoxMCP');

const BOX_API = 'https://api.box.com/2.0';
const BOX_UPLOAD_API = 'https://upload.box.com/api/2.0';
const MAX_PAYLOAD_BYTES = 200_000;

interface BoxError {
  type?: string;
  status?: number;
  code?: string;
  message?: string;
  context_info?: unknown;
}

async function boxFetch(
  path: string,
  init: RequestInit = {},
  options: { upload?: boolean } = {},
): Promise<Record<string, unknown>> {
  const client = await getConnectionBroker().getServiceClient('box');
  const url = `${options.upload ? BOX_UPLOAD_API : BOX_API}${path}`;
  const headers = new Headers(init.headers);
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');

  const response = await client(url, { ...init, headers });
  const text = await response.text();
  let body: unknown = text;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
  }
  if (!response.ok) {
    const err = (body ?? {}) as BoxError;
    const message = err.message ?? `Box API ${response.status}`;
    const codeSuffix = err.code ? `, code=${err.code}` : '';
    throw new Error(`${message} (status=${response.status}${codeSuffix})`);
  }
  return (body ?? {}) as Record<string, unknown>;
}

function summarize(body: unknown): unknown {
  const json = JSON.stringify(body);
  if (json.length <= MAX_PAYLOAD_BYTES) return body;
  return {
    truncated: true,
    note: `Output (${json.length} bytes) exceeded ${MAX_PAYLOAD_BYTES} bytes — first slice only.`,
    preview: json.slice(0, MAX_PAYLOAD_BYTES),
  };
}

function asText(value: unknown): { content: [{ type: 'text'; text: string }] } {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  };
}

function asError(err: unknown) {
  logger.warn('Box tool failed', { error: errorMessage(err) });
  return {
    content: [
      { type: 'text' as const, text: `Box error: ${errorMessage(err)}` },
    ],
    isError: true,
  };
}

export const boxTools = [
  tool(
    'box_list_folder',
    `List items (files + subfolders) inside a Box folder.

Folder id "0" is the user's root folder. Returns id, name, type, size, and modified_at for each entry. Use offset+limit to paginate large folders.`,
    {
      folderId: z
        .string()
        .default('0')
        .describe('Box folder id ("0" = root). Default: "0".'),
      limit: z.number().int().min(1).max(1000).optional().default(100),
      offset: z.number().int().min(0).optional().default(0),
    },
    async (input) => {
      try {
        const params = new URLSearchParams({
          limit: String(input.limit ?? 100),
          offset: String(input.offset ?? 0),
          fields: 'id,name,type,size,modified_at,parent',
        });
        const body = await boxFetch(
          `/folders/${encodeURIComponent(input.folderId)}/items?${params}`,
        );
        return asText(summarize(body));
      } catch (err) {
        return asError(err);
      }
    },
  ),
  tool(
    'box_search',
    `Search files and folders in the connected Box account by name or content.

\`type\` filters to "file" or "folder" only; leave empty to search both. \`scope\` defaults to "user_content"; pass "enterprise_content" for org-wide search if the user has those permissions.`,
    {
      query: z.string().min(1).describe('Search terms.'),
      type: z.enum(['file', 'folder']).optional(),
      scope: z
        .enum(['user_content', 'enterprise_content'])
        .optional()
        .default('user_content'),
      limit: z.number().int().min(1).max(200).optional().default(50),
    },
    async (input) => {
      try {
        const params = new URLSearchParams({
          query: input.query,
          scope: input.scope ?? 'user_content',
          limit: String(input.limit ?? 50),
          fields: 'id,name,type,size,modified_at,parent',
        });
        if (input.type) params.set('type', input.type);
        const body = await boxFetch(`/search?${params}`);
        return asText(summarize(body));
      } catch (err) {
        return asError(err);
      }
    },
  ),
  tool(
    'box_get_file_info',
    `Get metadata for a single file (name, size, parent, sha1, version, etc.).`,
    { fileId: z.string().describe('Box file id.') },
    async (input) => {
      try {
        const body = await boxFetch(
          `/files/${encodeURIComponent(input.fileId)}?fields=id,name,size,sha1,modified_at,parent,version_number,extension`,
        );
        return asText(body);
      } catch (err) {
        return asError(err);
      }
    },
  ),
  tool(
    'box_download_file',
    `Download a file's contents. Returns the raw text for text-like files (up to 200 KB) or a base64 preview for binaries. For large files, prefer creating a shared link via box_create_shared_link.`,
    {
      fileId: z.string().describe('Box file id.'),
      asText: z
        .boolean()
        .optional()
        .default(true)
        .describe(
          'When true, decode the body as UTF-8 text. Set false for binary base64 preview.',
        ),
    },
    async (input) => {
      try {
        const client = await getConnectionBroker().getServiceClient('box');
        const response = await client(
          `${BOX_API}/files/${encodeURIComponent(input.fileId)}/content`,
        );
        if (!response.ok) {
          throw new Error(`Box download failed (status=${response.status})`);
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
    'box_create_folder',
    `Create a new folder under a parent (parentId "0" = root). Returns the new folder's id and metadata.`,
    {
      name: z.string().min(1),
      parentId: z.string().default('0'),
    },
    async (input) => {
      try {
        const body = await boxFetch('/folders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: input.name,
            parent: { id: input.parentId ?? '0' },
          }),
        });
        return asText(body);
      } catch (err) {
        return asError(err);
      }
    },
  ),
  tool(
    'box_upload_file',
    `Upload a local file to Box. Use this whenever the user asks to upload, publish, save, or send a generated/local file to Box. \`filePath\` must be an absolute path the API server can read; \`parentId\` is the destination Box folder id ("0" = root). \`name\` defaults to the source filename. Files >= 20 MB use Box's chunked upload-session API automatically. Returns the new Box file's id, name, parent, and size.`,
    {
      filePath: z.string().min(1),
      parentId: z.string().default('0'),
      name: z.string().optional(),
      mimeType: z.string().optional(),
      overwrite: z.boolean().default(false),
    },
    async (input) => {
      try {
        const buffer = await readFile(input.filePath);
        const adapter = new BoxLocalAdapter();
        const result = await adapter.upload({
          parentId: input.parentId === '0' ? null : input.parentId,
          name: input.name ?? path.basename(input.filePath),
          content: new Blob([new Uint8Array(buffer).buffer], {
            type: input.mimeType ?? 'application/octet-stream',
          }),
          mimeType: input.mimeType,
          overwrite: input.overwrite,
        });
        return asText({
          id: result.id,
          name: result.name,
          size: result.size,
          parentId: result.parentId,
          mimeType: result.mimeType,
        });
      } catch (err) {
        return asError(err);
      }
    },
  ),
  tool(
    'box_create_shared_link',
    `Create or refresh a shared link for a file. Access defaults to "open" (anyone with the link); pass "company" for org-only, "collaborators" for invited only.`,
    {
      fileId: z.string(),
      access: z
        .enum(['open', 'company', 'collaborators'])
        .optional()
        .default('open'),
    },
    async (input) => {
      try {
        const body = await boxFetch(
          `/files/${encodeURIComponent(input.fileId)}?fields=shared_link`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              shared_link: { access: input.access ?? 'open' },
            }),
          },
        );
        return asText(body);
      } catch (err) {
        return asError(err);
      }
    },
  ),
];

export const BOX_TOOL_NAMES = boxTools.map((t) => t.name);

/** Create the Box first-party MCP server (Claude SDK in-process). */
export function createBoxMcpServer() {
  return createSdkMcpServer({
    name: 'box',
    version: '1.0.0',
    tools: boxTools,
  });
}
