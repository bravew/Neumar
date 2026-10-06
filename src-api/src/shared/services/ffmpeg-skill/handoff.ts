/**
 * Capability gating, instruction injection, and output publication for the
 * managed FFmpeg skill.
 *
 * The runner (`runner.ts`) validates and executes one operation into a private
 * per-run staging directory but does not publish the result. This module owns
 * the boundary between the managed service and each mode's asset flow:
 *
 *  - which providers can reach the managed server (and how),
 *  - the selected-skill instruction body for subprocess providers that do not
 *    consume pinned skills themselves,
 *  - publication of a validated artifact into task/design/video ownership and
 *    replacement of the raw staging path with an authorized reference.
 *
 * Server construction lives in `attach.ts` (it imports the MCP server, which in
 * turn imports this module for publication — keep that edge one-way).
 *
 * Native `mcp__ffmpeg__*` tools stay on `ffmpeg-server.ts` and are untouched.
 */

import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import type { AgentProvider } from '@/core/agent/types';

import { createFile } from '@/shared/db/operations';
import {
  appendJsonl,
  getProjectDir,
  resolveProjectPath,
} from '@/shared/services/design-mode/fs';
import {
  getDesignProject,
  patchDesignProject,
} from '@/shared/services/design-mode/projects';
import type { DesignOutput } from '@/shared/services/design-mode/types';
import { getSessionContext } from '@/shared/services/session-context';
import { findSkill, loadSkills } from '@/shared/skills/loader';
import { createLogger } from '@/shared/utils/logger';
import {
  attachCopiedProjectAsset,
  getVideoAssetsDir,
  getVideoProjectRoot,
  mediaItemFromPath,
  updateProjectDocument,
} from '@/shared/video/store';

import type { SkillArtifact, SkillOperationResult } from './runner';

const logger = createLogger('FfmpegSkillHandoff');

/** Public skill identity, matching the vendored `skills/ffmpeg` name. */
export const FFMPEG_SKILL_ID = 'ffmpeg';

/** Managed MCP server name. Hyphens, not underscores: the bridge rejects the
 * latter and the SDK maps the server name to `mcp__ffmpeg-skill__*`. */
export const FFMPEG_SKILL_SERVER_NAME = 'ffmpeg-skill';

export type FfmpegSkillTransport = 'in-process' | 'bridge' | 'unsupported';

const IN_PROCESS_PROVIDERS: ReadonlySet<string> = new Set(['claude']);
const BRIDGE_PROVIDERS: ReadonlySet<string> = new Set([
  'codex',
  'cursor-agent',
  // Kimi is feature-gated, but its run() already forwards
  // `bridgeInProcessServers`, so attaching here is trivial when it is enabled.
  'kimi',
]);

/**
 * How the managed server reaches a given provider. Providers absent from both
 * sets have no host-factory attachment and must not claim support.
 */
export function ffmpegSkillTransportFor(
  provider: AgentProvider | undefined,
): FfmpegSkillTransport {
  if (!provider) return 'unsupported';
  if (IN_PROCESS_PROVIDERS.has(provider)) return 'in-process';
  if (BRIDGE_PROVIDERS.has(provider)) return 'bridge';
  return 'unsupported';
}

/**
 * A clear capability message when `ffmpeg` is selected on a provider that
 * cannot reach the managed server. Null when the provider supports it. Callers
 * gate on the skill being selected before using this.
 */
export function ffmpegSkillCapabilityMessage(
  provider: AgentProvider | undefined,
): string | null {
  if (ffmpegSkillTransportFor(provider) !== 'unsupported') return null;
  return (
    `The ffmpeg skill is not available on the ${provider ?? 'selected'} provider. ` +
    'Managed FFmpeg operations are supported on Claude, Codex, Cursor Agent, and Kimi. ' +
    'Switch to one of those providers to use the ffmpeg skill.'
  );
}

/**
 * Render the selected `ffmpeg` skill body for subprocess providers that do not
 * consume pinned skills themselves (Codex, Cursor, Kimi). Claude's adapter
 * already loads pinned skill bodies via `buildPinnedSkillsInstruction`, so this
 * must not be injected a second time there. Returns '' when `ffmpeg` isn't
 * selected or isn't installed.
 */
export async function buildFfmpegSkillInstruction(
  pinnedSkills: readonly string[] | undefined,
): Promise<string> {
  if (!pinnedSkills?.length || !pinnedSkills.includes(FFMPEG_SKILL_ID)) {
    return '';
  }
  try {
    const skills = await loadSkills();
    const skill = findSkill(skills, FFMPEG_SKILL_ID);
    if (!skill) return '';
    return [
      '<pinned-skills>',
      'The user has pinned the following skill for this message. You MUST use it as instructed.',
      `<pinned-skill name="ffmpeg">\n${skill.content}\n</pinned-skill>`,
      '</pinned-skills>',
    ].join('\n\n');
  } catch {
    return '';
  }
}

/**
 * Append the selected-skill instruction to `systemContext` for bridge
 * providers only. Claude injects pinned skills itself; every other provider is
 * gated separately and never reaches this helper with a supported transport.
 */
export async function appendFfmpegSkillContext(
  provider: AgentProvider | undefined,
  pinnedSkills: readonly string[] | undefined,
  systemContext: string,
): Promise<string> {
  if (ffmpegSkillTransportFor(provider) !== 'bridge') return systemContext;
  const instruction = await buildFfmpegSkillInstruction(pinnedSkills);
  return [systemContext, instruction].filter(Boolean).join('\n\n');
}

interface PublishedReference {
  path: string;
  mode: 'task' | 'design' | 'video';
}

/**
 * Publish a validated artifact into the originating mode's ownership and return
 * an authorized reference. Never publishes a partial or cancelled result: the
 * caller re-checks status/verified/preview before invoking.
 */
export async function publishFfmpegSkillArtifact(
  result: SkillOperationResult,
  toolName: string,
): Promise<SkillOperationResult> {
  const artifact = result.artifact;
  if (
    result.status !== 'completed' ||
    !result.artifactCreated ||
    !result.verified ||
    result.preview ||
    !artifact
  ) {
    await discardStagingOf(artifact);
    return result;
  }

  let reference: PublishedReference;
  try {
    reference = await publishArtifact(artifact, toolName);
  } catch (error) {
    // A publication failure must not masquerade as a successful deliverable.
    logger.warn('ffmpeg_skill_publication_failed', {
      tool: toolName,
      error: error instanceof Error ? error.message : String(error),
    });
    await discardStagingOf(artifact);
    return {
      ...result,
      status: 'failed',
      artifactCreated: false,
      verified: false,
      artifact: null,
      error: {
        kind: 'publication',
        message:
          error instanceof Error
            ? error.message
            : 'Artifact publication failed',
      },
    };
  }
  await discardStagingOf(artifact);

  return {
    ...result,
    artifact: {
      path: reference.path,
      bytes: artifact.bytes,
      sha256: artifact.sha256,
    },
  };
}

async function publishArtifact(
  artifact: SkillArtifact,
  toolName: string,
): Promise<PublishedReference> {
  const session = getSessionContext();
  if (session?.videoProjectId) {
    return {
      path: await publishVideo(session.videoProjectId, artifact, toolName),
      mode: 'video',
    };
  }
  if (session?.designProjectId) {
    return {
      path: await publishDesign(session.designProjectId, artifact, toolName),
      mode: 'design',
    };
  }
  return {
    path: await publishTask(artifact),
    mode: 'task',
  };
}

async function publishVideo(
  projectId: string,
  artifact: SkillArtifact,
  toolName: string,
): Promise<string> {
  // The runner stages into a private `/tmp` dir, which is outside the video
  // project's readable roots, so `addProjectAssetFromPath` (which validates the
  // source against the project) would reject it. Copy the validated artifact
  // into the project assets dir and attach it with the same content-dedupe the
  // normal path uses.
  const assetsDir = getVideoAssetsDir(projectId);
  await mkdir(assetsDir, { recursive: true });
  const dest = join(
    assetsDir,
    `${randomUUID().replace(/-/g, '').slice(0, 8)}_${sanitizeName(basename(artifact.path))}`,
  );
  await copyFile(artifact.path, dest);
  const item = await mediaItemFromPath(
    dest,
    'user',
    getVideoProjectRoot(projectId),
  );
  const { asset } = await attachCopiedProjectAsset(
    projectId,
    item,
    artifact.sha256,
  );
  // Record provenance without touching the timeline: timeline edits stay on the
  // existing explicit apply tools. Preserve any pre-existing provenance when the
  // content deduped onto an asset the project already held.
  await updateProjectDocument(projectId, (project) => ({
    ...project,
    assets: project.assets.map((entry) =>
      entry.id === asset.id
        ? {
            ...entry,
            provenance: entry.provenance ?? {
              provider: 'ffmpeg-skill',
              model: 'ffmpeg-skill',
              prompt: toolName,
              attribution: 'Managed FFmpeg skill operation',
            },
          }
        : entry,
    ),
    updatedAt: new Date().toISOString(),
  }));
  return asset.path;
}

async function publishDesign(
  projectId: string,
  artifact: SkillArtifact,
  toolName: string,
): Promise<string> {
  const relative = `assets/generated/ffmpeg-skill-${sanitizeName(basename(artifact.path))}`;
  const dest = resolveProjectPath(projectId, relative);
  await mkdir(dirname(dest.absolutePath), { recursive: true });
  await copyFile(artifact.path, dest.absolutePath);
  const output: DesignOutput = {
    id: `asset_${randomUUID().slice(0, 10)}`,
    kind: mediaKind(artifact.path),
    path: dest.relativePath,
    mime: mimeForPath(dest.relativePath),
    provider: 'ffmpeg-skill',
    model: toolName,
    createdAt: new Date().toISOString(),
  };
  // Append the output without flipping the project to `complete`: the ffmpeg
  // skill can run mid-conversation, so a single artifact must not end the
  // project (unlike the media dispatcher's terminal `addProjectOutput`).
  const project = await getDesignProject(projectId);
  await patchDesignProject(projectId, {
    outputs: [
      output,
      ...project.outputs.filter((item) => item.id !== output.id),
    ],
  });
  await appendJsonl(join(getProjectDir(projectId), 'provenance/assets.jsonl'), {
    assetId: output.id,
    projectId,
    path: output.path,
    provider: output.provider,
    model: output.model,
    kind: output.kind,
    source: 'managed-ffmpeg-skill',
    createdAt: output.createdAt,
  });
  return dest.relativePath;
}

async function publishTask(artifact: SkillArtifact): Promise<string> {
  const session = getSessionContext();
  const workDir = session?.workDir;
  if (!workDir || !session?.taskId) {
    throw new Error(
      'No task session is bound to this run, so the output cannot be attributed.',
    );
  }
  const outputDir = join(workDir, 'output');
  await mkdir(outputDir, { recursive: true });
  const name = sanitizeName(basename(artifact.path));
  const dest = join(outputDir, name);
  await copyFile(artifact.path, dest);
  createFile({
    task_id: session.taskId,
    name,
    type: fileTypeFor(name),
    path: dest,
    preview: 'Managed FFmpeg skill output',
    provenance: JSON.stringify({
      provider: 'ffmpeg-skill',
      model: 'ffmpeg-skill',
      source: 'managed-ffmpeg-skill',
    }),
  });
  return dest;
}

/** Remove the per-run staging directory the runner left behind. Best-effort. */
async function discardStagingOf(artifact: SkillArtifact | null): Promise<void> {
  if (!artifact) return;
  const staging = stagingRootOf(artifact.path);
  if (!staging) return;
  try {
    await rm(staging, { recursive: true, force: true });
  } catch {
    // Staging cleanup is best-effort; a failed publish already surfaced.
  }
}

function stagingRootOf(candidate: string): string | null {
  let current = dirname(candidate);
  for (let depth = 0; depth < 4; depth += 1) {
    if (basename(current).startsWith('neumar-ffmpeg-skill-')) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return null;
}

function sanitizeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '-');
}

function mediaKind(filePath: string): string {
  const ext = filePath.toLowerCase();
  if (/\.(mp4|webm|mov|avi|mkv)$/.test(ext)) return 'video';
  if (/\.(mp3|wav|flac|ogg|aac|m4a)$/.test(ext)) return 'audio';
  if (/\.(png|jpe?g|gif|webp)$/.test(ext)) return 'image';
  return 'file';
}

function mimeForPath(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.mp4')) return 'video/mp4';
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.md')) return 'text/markdown';
  return lower.endsWith('.png') ? 'image/png' : 'application/octet-stream';
}

function fileTypeFor(
  name: string,
):
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'presentation'
  | 'spreadsheet'
  | 'code'
  | 'website'
  | 'text' {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (
    ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext)
  ) {
    return 'image';
  }
  if (['mp4', 'webm', 'mov', 'avi', 'mkv', 'wmv', 'flv'].includes(ext)) {
    return 'video';
  }
  if (['mp3', 'wav', 'flac', 'ogg', 'aac', 'm4a', 'wma'].includes(ext)) {
    return 'audio';
  }
  if (['pdf', 'md', 'doc', 'docx', 'txt', 'rtf', 'odt'].includes(ext)) {
    return 'document';
  }
  if (['ppt', 'pptx', 'key', 'odp'].includes(ext)) return 'presentation';
  if (['xls', 'xlsx', 'numbers', 'ods'].includes(ext)) return 'spreadsheet';
  if (['html', 'htm'].includes(ext)) return 'website';
  if (
    [
      'js',
      'jsx',
      'ts',
      'tsx',
      'py',
      'go',
      'rs',
      'java',
      'sh',
      'sql',
      'css',
      'json',
      'csv',
    ].includes(ext)
  ) {
    return 'code';
  }
  return 'text';
}
