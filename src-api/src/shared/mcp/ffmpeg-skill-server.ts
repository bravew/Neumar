/**
 * Managed FFmpeg skill MCP server.
 *
 * Three tools, not the vendored 42. The catalog names the operations; check
 * reports the installed interpreters; execute runs one structured operation
 * through the host boundary. Native `mcp__ffmpeg__*` tools stay on
 * `ffmpeg-server.ts` and are not registered here.
 *
 * The server name is `ffmpeg-skill`. The in-process bridge accepts hyphens
 * and rejects underscores, so the name is fixed to match that constraint.
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk/core';
import { z } from 'zod';

import {
  catalogEntries,
  executeSkillOperation,
  FfmpegSkillError,
  isFfmpegSkillError,
  loadFfmpegContract,
  resolvePython,
  resolveSkillRuntime,
} from '@/shared/services/ffmpeg-skill';
import { publishFfmpegSkillArtifact } from '@/shared/services/ffmpeg-skill/handoff';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('FfmpegSkillMcp');

const SERVER_TIMEOUT_MS = 31 * 60 * 1000;

function textResult(text: string, isError = false) {
  return {
    content: [{ type: 'text' as const, text }],
    ...(isError ? { isError: true } : {}),
  };
}

function failure(error: unknown) {
  if (isFfmpegSkillError(error)) {
    return textResult(`${error.kind}: ${error.message}`, true);
  }
  const message = error instanceof Error ? error.message : String(error);
  logger.error('ffmpeg skill tool failed', { message });
  return textResult(`failed: ${message}`, true);
}

export const ffmpegSkillTools = [
  tool(
    'ffmpeg_skill_catalog',
    `List the managed FFmpeg skill operations. Returns each tool's name, id, role, description, and the structured argument names the host accepts. Does not include the full schemas; pass those argument names to ffmpeg_skill_execute.`,
    {},
    async () => {
      try {
        const loaded = await loadFfmpegContract();
        return textResult(
          JSON.stringify(
            {
              contractVersion: loaded.contract.contract_version,
              payloadVersion: loaded.payloadVersion,
              tools: catalogEntries(loaded.contract),
            },
            null,
            2,
          ),
        );
      } catch (error) {
        return failure(error);
      }
    },
  ),

  tool(
    'ffmpeg_skill_check',
    `Check the installed Python, FFmpeg, and ffprobe this skill runs with. Reports what is missing and how to provide it. Never installs or downloads anything.`,
    {},
    async () => {
      try {
        const loaded = await loadFfmpegContract();
        const python = safePython();
        const media = safeMedia(loaded.payloadVersion);
        return textResult(
          JSON.stringify(
            {
              payloadVersion: loaded.payloadVersion,
              python,
              ffmpeg: media.ffmpeg,
              ffprobe: media.ffprobe,
              ready:
                python.available &&
                media.ffmpeg.available &&
                media.ffprobe.available,
            },
            null,
            2,
          ),
        );
      } catch (error) {
        return failure(error);
      }
    },
  ),

  tool(
    'ffmpeg_skill_execute',
    `Run one managed FFmpeg skill operation. tool is a catalog name. args is the structured object for that tool (unknown keys are rejected). preview measures without writing a deliverable. The result keeps process status, artifact creation, and verification as separate facts; status completed with verified false is not an approved deliverable.`,
    {
      tool: z
        .string()
        .describe('Catalog tool name, for example cut, probe, or loudness'),
      args: z
        .record(z.string(), z.unknown())
        .default({})
        .describe('Structured arguments for that tool. No raw argv.'),
      preview: z
        .boolean()
        .optional()
        .describe(
          'Measure only. Rejects operations that would write a deliverable.',
        ),
    },
    async ({ tool: toolName, args, preview }) => {
      try {
        const result = await executeSkillOperation({
          tool: toolName,
          args,
          preview,
        });
        const published = await publishFfmpegSkillArtifact(result, toolName);
        return textResult(
          JSON.stringify(published, null, 2),
          published.status !== 'completed',
        );
      } catch (error) {
        return failure(error);
      }
    },
  ),
];

export const FFMPEG_SKILL_TOOL_NAMES = ffmpegSkillTools.map(
  (entry) => entry.name,
);

/** A fresh server per call. Do not cache the instance across runs. */
export function createFfmpegSkillMcpServer() {
  return createSdkMcpServer({
    name: 'ffmpeg-skill',
    version: '1.0.0',
    tools: ffmpegSkillTools,
    timeout: SERVER_TIMEOUT_MS,
  });
}

function safePython(): {
  available: boolean;
  version?: string;
  action?: string;
} {
  try {
    const python = resolvePython();
    return { available: true, version: python.version };
  } catch (error) {
    return {
      available: false,
      action: error instanceof FfmpegSkillError ? error.message : String(error),
    };
  }
}

function safeMedia(payloadVersion: string): {
  ffmpeg: {
    available: boolean;
    path?: string;
    version?: string;
    action?: string;
  };
  ffprobe: { available: boolean; path?: string; action?: string };
} {
  try {
    const runtime = resolveSkillRuntime(payloadVersion);
    return {
      ffmpeg: {
        available: true,
        path: runtime.ffmpegPath,
        version: runtime.ffmpegVersion,
      },
      ffprobe: { available: true, path: runtime.ffprobePath },
    };
  } catch (error) {
    const action =
      error instanceof FfmpegSkillError ? error.message : String(error);
    return {
      ffmpeg: { available: false, action },
      ffprobe: { available: false, action },
    };
  }
}
