/**
 * `tools/list` regression for every in-process SDK MCP server factory.
 *
 * `@anthropic-ai/claude-agent-sdk` 0.3.283's root entry inlines its own copy
 * of zod (4.4.x) and converts tool input schemas to JSON Schema with it. Our
 * schemas are built with the installed zod (4.6.x), whose `z.record()` JSON
 * Schema processor pushes onto a `ctx.deferred` list the older inlined
 * converter never creates, so `tools/list` failed with
 * `-32603 Cannot read properties of undefined (reading 'push')`. The servers
 * now import from the SDK's `/core` entry, which uses the installed zod and
 * MCP SDK. Listing every server's tools here makes the next SDK or zod bump
 * fail in CI instead of at runtime.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';

import {
  GOOGLE_CALENDAR_SCOPES,
  GOOGLE_CONTACTS_SCOPES,
  GOOGLE_DIRECTORY_SCOPES,
  GOOGLE_DOCS_SCOPES,
  GOOGLE_DRIVE_SCOPES,
  GOOGLE_GMAIL_SCOPES,
  GOOGLE_MEET_SCOPES,
  GOOGLE_PHOTOS_SCOPES,
  GOOGLE_SHEETS_SCOPES,
  GOOGLE_SLIDES_SCOPES,
  GOOGLE_TASKS_SCOPES,
} from '@/config/oauth';

import { createAssetsMcpServer } from '@/shared/mcp/assets-server';
import { createBoxMcpServer } from '@/shared/mcp/box-server';
import { createBrollMcpServer } from '@/shared/mcp/broll-server';
import { createCloudStorageMediaMcpServer } from '@/shared/mcp/cloud-storage-media-server';
import { createConnectorsMcpServer } from '@/shared/mcp/connectors-server';
import { createDropboxMcpServer } from '@/shared/mcp/dropbox-server';
import { createFFmpegMcpServer } from '@/shared/mcp/ffmpeg-server';
import { createFfmpegSkillMcpServer } from '@/shared/mcp/ffmpeg-skill-server';
import {
  ALL_GOOGLE_TOOL_NAMES,
  createGoogleMcpServer,
} from '@/shared/mcp/google-server';
import { createLinearMcpServer } from '@/shared/mcp/linear-server';
import { createMediaMcpServer } from '@/shared/mcp/media-server';
import { createMemoryMcpServer } from '@/shared/mcp/memory-server';
import { createOneDriveMcpServer } from '@/shared/mcp/onedrive-server';
import { createPublishMcpServer } from '@/shared/mcp/publish-server';
import { createScheduleMcpServer } from '@/shared/mcp/schedule-server';
import { createSearchMcpServer } from '@/shared/mcp/search-server';
import { createSlackSearchServer } from '@/shared/mcp/slack-search-server';
import { createSpeechMcpServer } from '@/shared/mcp/speech-server';
import { createVideoEditServer } from '@/shared/mcp/video-edit-server';
import { createVideoMcpServer } from '@/shared/mcp/video-server/server';
import { createWorkspaceMcpServer } from '@/shared/mcp/workspace-server';

const ALL_GOOGLE_SCOPES = [
  GOOGLE_GMAIL_SCOPES,
  GOOGLE_CALENDAR_SCOPES,
  GOOGLE_DRIVE_SCOPES,
  GOOGLE_PHOTOS_SCOPES,
  GOOGLE_MEET_SCOPES,
  GOOGLE_TASKS_SCOPES,
  GOOGLE_CONTACTS_SCOPES,
  GOOGLE_DIRECTORY_SCOPES,
  GOOGLE_SHEETS_SCOPES,
  GOOGLE_SLIDES_SCOPES,
  GOOGLE_DOCS_SCOPES,
].flat();

const createVideoEditTestServer = () =>
  createVideoEditServer({
    projectId: 'p-tools-list',
    aspectRatio: '16:9',
    clientKind: 'first-party',
  });

/** Source file (relative to src/shared/mcp) → factory producing its server. */
const FACTORIES: Record<string, () => McpSdkServerConfigWithInstance> = {
  'assets-server.ts': () => createAssetsMcpServer(),
  'box-server.ts': () => createBoxMcpServer(),
  'broll-server.ts': () => createBrollMcpServer(),
  'cloud-storage-media-server.ts': () => createCloudStorageMediaMcpServer(),
  'connectors-server.ts': () =>
    createConnectorsMcpServer({
      buildContext: () => {
        throw new Error('not called by tools/list');
      },
    }),
  'dropbox-server.ts': () => createDropboxMcpServer(),
  'ffmpeg-server.ts': () => createFFmpegMcpServer(),
  'ffmpeg-skill-server.ts': () => createFfmpegSkillMcpServer(),
  'google-server.ts': () => createGoogleMcpServer(ALL_GOOGLE_SCOPES),
  'linear-server.ts': () => createLinearMcpServer(),
  'media-server.ts': () => createMediaMcpServer(),
  'memory-server.ts': () => createMemoryMcpServer({ provider: 'local' }),
  'onedrive-server.ts': () => createOneDriveMcpServer(),
  'publish-server.ts': () => createPublishMcpServer(),
  'schedule-server.ts': () => createScheduleMcpServer(),
  'search-server.ts': () => createSearchMcpServer(),
  'slack-search-server.ts': () =>
    createSlackSearchServer({ botToken: 'xoxb-test' }),
  'speech-server.ts': () => createSpeechMcpServer(),
  'video-edit-server.ts': createVideoEditTestServer,
  'video-server/server.ts': () => createVideoMcpServer(),
  'workspace-server.ts': () => createWorkspaceMcpServer(),
};

const MCP_DIR = join(__dirname, '../../../src/shared/mcp');

function filesCallingCreateSdkMcpServer(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((file) =>
      readFileSync(file, 'utf8').includes('createSdkMcpServer('),
    )
    .map((file) => relative(dir, file))
    .sort();
}

async function listTools(config: McpSdkServerConfigWithInstance) {
  const [serverTransport, clientTransport] =
    InMemoryTransport.createLinkedPair();
  await config.instance.connect(serverTransport);
  const client = new Client({ name: 'tools-list-test', version: '1.0.0' });
  await client.connect(clientTransport);
  try {
    return (await client.listTools()).tools;
  } finally {
    await client.close();
  }
}

describe('SDK MCP servers: tools/list', () => {
  it('covers every createSdkMcpServer factory under src/shared/mcp', () => {
    expect(Object.keys(FACTORIES).sort()).toEqual(
      filesCallingCreateSdkMcpServer(MCP_DIR),
    );
  });

  it.each(Object.entries(FACTORIES))(
    '%s lists its tools with object input schemas',
    async (_file, create) => {
      const tools = await listTools(create());
      expect(tools.length).toBeGreaterThan(0);
      for (const t of tools) {
        expect(t.inputSchema.type, t.name).toBe('object');
      }
    },
  );

  it('lists every Google tool when all scopes are granted', async () => {
    const tools = await listTools(createGoogleMcpServer(ALL_GOOGLE_SCOPES));
    expect(tools.map((t) => t.name).sort()).toEqual(
      [...ALL_GOOGLE_TOOL_NAMES].sort(),
    );
  });

  it('describes z.record() inputs such as video_set_clip_params.patch', async () => {
    const tools = await listTools(createVideoEditTestServer());
    const setClipParams = tools.find((t) => t.name === 'video_set_clip_params');
    expect(setClipParams?.inputSchema.properties?.patch).toMatchObject({
      type: 'object',
    });
  });
});
