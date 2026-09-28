/**
 * Per-server MCP tool-call timeouts (issue #76 / C6).
 *
 * `createSdkMcpServer({ timeout })` (SDK 0.3.248) sets a hard per-call
 * wall-clock ceiling for an in-process SDK MCP server, overriding the
 * `MCP_TOOL_TIMEOUT` env var (effectively unbounded when unset). The
 * long-running in-process servers — video-edit, ffmpeg, media, speech — set
 * this explicitly instead of relying on that global default. See each
 * server's `*_SERVER_TIMEOUT_MS` constant for the reasoning behind its value.
 */
import { describe, expect, it } from 'vitest';

import { createFFmpegMcpServer } from '@/shared/mcp/ffmpeg-server';
import { createMediaMcpServer } from '@/shared/mcp/media-server';
import { createSpeechMcpServer } from '@/shared/mcp/speech-server';
import { createVideoEditServer } from '@/shared/mcp/video-edit-server';
import { MAX_EXECUTION_MS } from '@/shared/services/ffmpeg';
import { AI_CLIP_POLL_TIMEOUT_MS } from '@/shared/video/pipeline';

describe('per-server MCP tool-call timeouts', () => {
  it('video-edit: bounds calls above a single ai-clip/lipsync scene wait', () => {
    // video_render is not wrapped by withToolTimeout — it awaits
    // renderProject() synchronously, which polls each pending ai-clip/
    // lipsync scene up to AI_CLIP_POLL_TIMEOUT_MS *before* rendering starts.
    // A single such scene alone can legitimately need that long, so the
    // server timeout must clear it with room for the render/encode phase
    // too — a regression here (or a change to AI_CLIP_POLL_TIMEOUT_MS
    // without updating this) can silently re-introduce a stranded render
    // (see PR #96 review, Finding 1).
    const server = createVideoEditServer({ projectId: 'p-timeout-test' });
    expect(server.timeout).toBeGreaterThan(AI_CLIP_POLL_TIMEOUT_MS);
    // At least one full poll cycle plus a real render/encode buffer beyond
    // it, not just a hair above the floor.
    expect(server.timeout as number).toBeGreaterThanOrEqual(
      AI_CLIP_POLL_TIMEOUT_MS + 5 * 60_000,
    );
  });

  it('ffmpeg-processing: bounds calls just above the executor kill switch', () => {
    const server = createFFmpegMcpServer();
    // The executor's own MAX_EXECUTION_MS timeout should fire first and
    // produce a readable error; the SDK-level timeout is a backstop.
    expect(server.timeout).toBe(MAX_EXECUTION_MS + 60_000);
    expect(server.timeout).toBeGreaterThan(MAX_EXECUTION_MS);
  });

  it('media-generation: bounds calls at 5 minutes instead of MCP_TOOL_TIMEOUT', () => {
    const server = createMediaMcpServer();
    expect(server.timeout).toBe(5 * 60_000);
  });

  it('speech: bounds calls at 5 minutes instead of MCP_TOOL_TIMEOUT', () => {
    const server = createSpeechMcpServer();
    expect(server.timeout).toBe(5 * 60_000);
  });

  it('every configured timeout clears the SDK’s 1000ms floor', () => {
    // Values below 1000ms are ignored by the SDK (falls through to
    // MCP_TOOL_TIMEOUT or the default) — guard against a regression that
    // sets a near-zero value that silently does nothing.
    const servers = [
      createVideoEditServer({ projectId: 'p-timeout-floor-test' }),
      createFFmpegMcpServer(),
      createMediaMcpServer(),
      createSpeechMcpServer(),
    ];
    for (const server of servers) {
      expect(server.timeout).toBeDefined();
      expect(server.timeout as number).toBeGreaterThan(1000);
    }
  });
});
