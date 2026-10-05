/**
 * Regression coverage for the managed FFmpeg skill transport boundary
 * (`ffmpeg-skill/handoff.ts` + `ffmpeg-skill/attach.ts`): which providers get
 * the fresh in-process server vs the loopback bridge, the capability message
 * for unsupported providers, the exactly-once skill instruction injection, and
 * the never-publish-partial publication gate.
 */
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { closeDatabase, getDatabase } from '@/shared/db';
import { createSession, createTask, saveSetting } from '@/shared/db/operations';
import { getProjectDir } from '@/shared/services/design-mode/fs';
import {
  createDesignProject,
  getDesignProject,
} from '@/shared/services/design-mode/projects';
import { prepareFfmpegSkillAttachment } from '@/shared/services/ffmpeg-skill/attach';
import {
  appendFfmpegSkillContext,
  FFMPEG_SKILL_SERVER_NAME,
  ffmpegSkillCapabilityMessage,
  ffmpegSkillTransportFor,
  publishFfmpegSkillArtifact,
} from '@/shared/services/ffmpeg-skill/handoff';
import type { SkillOperationResult } from '@/shared/services/ffmpeg-skill/runner';
import { runWithSessionContext } from '@/shared/services/session-context';
import { createProject, getProject } from '@/shared/video/store';

const { ffmpegSkillFixture } = vi.hoisted(() => ({
  ffmpegSkillFixture: {
    name: 'ffmpeg',
    bareName: 'ffmpeg',
    path: '/skills/ffmpeg',
    content: 'FFMPEG SKILL BODY MARKER',
  },
}));

vi.mock('@/shared/skills/loader', () => ({
  loadSkills: async () => [ffmpegSkillFixture],
  findSkill: (_skills: unknown[], nameOrSlug: string) =>
    nameOrSlug === 'ffmpeg' ? ffmpegSkillFixture : undefined,
}));

const tempDirs: string[] = [];

afterEach(async () => {
  closeDatabase();
  vi.unstubAllEnvs();
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe('ffmpegSkillTransportFor', () => {
  it('maps claude to in-process and codex/cursor/kimi to the bridge', () => {
    expect(ffmpegSkillTransportFor('claude')).toBe('in-process');
    expect(ffmpegSkillTransportFor('codex')).toBe('bridge');
    expect(ffmpegSkillTransportFor('cursor-agent')).toBe('bridge');
    expect(ffmpegSkillTransportFor('kimi')).toBe('bridge');
  });

  it('marks every other provider and an absent provider unsupported', () => {
    expect(ffmpegSkillTransportFor(undefined)).toBe('unsupported');
    expect(ffmpegSkillTransportFor('pi-local')).toBe('unsupported');
    expect(ffmpegSkillTransportFor('gemini')).toBe('unsupported');
    expect(ffmpegSkillTransportFor('openai-compat')).toBe('unsupported');
    expect(ffmpegSkillTransportFor('open-agent-sdk')).toBe('unsupported');
    expect(ffmpegSkillTransportFor('http-agent')).toBe('unsupported');
    expect(ffmpegSkillTransportFor('a2a')).toBe('unsupported');
  });
});

describe('ffmpegSkillCapabilityMessage', () => {
  it('is null for providers that can reach the managed server', () => {
    expect(ffmpegSkillCapabilityMessage('claude')).toBeNull();
    expect(ffmpegSkillCapabilityMessage('codex')).toBeNull();
    expect(ffmpegSkillCapabilityMessage('cursor-agent')).toBeNull();
    expect(ffmpegSkillCapabilityMessage('kimi')).toBeNull();
  });

  it('names the supported providers for an unsupported one', () => {
    const message = ffmpegSkillCapabilityMessage('gemini');
    expect(message).toContain('gemini');
    expect(message).toContain('Claude');
    expect(message).toContain('Codex');
    expect(message).toContain('Cursor Agent');
    expect(message).toContain('Kimi');
  });
});

describe('prepareFfmpegSkillAttachment', () => {
  it('attaches the fresh in-process server for Claude and does not inject twice', async () => {
    const attachment = await prepareFfmpegSkillAttachment({
      provider: 'claude',
      pinnedSkills: ['ffmpeg'],
      systemContext: 'base-context',
    });

    expect(attachment.transport).toBe('in-process');
    expect(attachment.capabilityMessage).toBeNull();
    expect(Object.keys(attachment.inProcessMcpServers ?? {})).toEqual([
      FFMPEG_SKILL_SERVER_NAME,
    ]);
    const server = attachment.inProcessMcpServers?.[
      FFMPEG_SKILL_SERVER_NAME
    ] as { name?: string; instance?: unknown } | undefined;
    expect(server?.name).toBe(FFMPEG_SKILL_SERVER_NAME);
    expect(server?.instance).toBeDefined();
    // Claude's adapter loads pinned skill bodies itself, so the instruction
    // must not be injected a second time here.
    expect(attachment.systemContext).toBe('base-context');
    expect(attachment.bridgeInProcessServers).toBeUndefined();
  });

  it('bridges the server for Codex and appends the skill body exactly once', async () => {
    const attachment = await prepareFfmpegSkillAttachment({
      provider: 'codex',
      pinnedSkills: ['ffmpeg'],
      systemContext: 'base-context',
      sessionContext: { workDir: '/tmp/work', taskId: 'task-1' },
    });

    expect(attachment.transport).toBe('bridge');
    expect(attachment.capabilityMessage).toBeNull();
    expect(attachment.inProcessMcpServers).toBeUndefined();
    expect(attachment.bridgeInProcessServers).toHaveLength(1);
    const bridge = attachment.bridgeInProcessServers?.[0];
    expect(bridge?.name).toBe(FFMPEG_SKILL_SERVER_NAME);
    expect(bridge?.sessionContext?.taskId).toBe('task-1');
    expect(typeof bridge?.createServer).toBe('function');
    expect(bridge?.createServer()).toBeDefined();

    const marker = 'FFMPEG SKILL BODY MARKER';
    expect(attachment.systemContext).toContain(marker);
    expect(attachment.systemContext).toContain('<pinned-skill name="ffmpeg">');
    // Injected once, not once per provider or skill.
    expect(attachment.systemContext.split(marker).length - 1).toBe(1);
  });

  it('yields a capability message when ffmpeg is selected on an unsupported provider', async () => {
    const attachment = await prepareFfmpegSkillAttachment({
      provider: 'gemini',
      pinnedSkills: ['ffmpeg'],
      systemContext: 'base-context',
    });

    expect(attachment.transport).toBe('unsupported');
    expect(attachment.capabilityMessage).toBeTruthy();
    expect(attachment.inProcessMcpServers).toBeUndefined();
    expect(attachment.bridgeInProcessServers).toBeUndefined();
    expect(attachment.systemContext).toBe('base-context');
  });

  it('does not flag unsupported providers when ffmpeg is not selected', async () => {
    const attachment = await prepareFfmpegSkillAttachment({
      provider: 'gemini',
      pinnedSkills: ['canvas-design'],
      systemContext: 'base-context',
    });

    expect(attachment.capabilityMessage).toBeNull();
  });
});

describe('appendFfmpegSkillContext', () => {
  it('injects only for bridge providers with ffmpeg pinned', async () => {
    const injected = await appendFfmpegSkillContext(
      'codex',
      ['ffmpeg'],
      'base',
    );
    expect(injected).toContain('FFMPEG SKILL BODY MARKER');
    expect(injected.split('FFMPEG SKILL BODY MARKER').length - 1).toBe(1);

    expect(await appendFfmpegSkillContext('claude', ['ffmpeg'], 'base')).toBe(
      'base',
    );
    expect(await appendFfmpegSkillContext('codex', [], 'base')).toBe('base');
    expect(await appendFfmpegSkillContext('codex', ['other'], 'base')).toBe(
      'base',
    );
  });
});

describe('publishFfmpegSkillArtifact', () => {
  it('never publishes a cancelled result', async () => {
    const staging = await makeTempDir('neumar-ffmpeg-skill-cancelled-');
    const artifactPath = join(staging, 'output.mp4');
    await writeFile(artifactPath, 'partial');

    const cancelled = completedResult('cut', artifactPath, {
      status: 'cancelled',
      verified: true,
    });
    const published = await publishFfmpegSkillArtifact(cancelled, 'cut');

    expect(published.status).toBe('cancelled');
    expect(published.artifact?.path).toBe(artifactPath);
  });

  it('never publishes a preview result', async () => {
    const staging = await makeTempDir('neumar-ffmpeg-skill-preview-');
    const artifactPath = join(staging, 'output.mp4');
    await writeFile(artifactPath, 'preview');

    const preview = completedResult('cut', artifactPath, {
      preview: true,
    });
    const published = await publishFfmpegSkillArtifact(preview, 'cut');

    expect(published.status).toBe('completed');
    expect(published.artifact?.path).toBe(artifactPath);
  });

  it('attributes a produced artifact to the bound task session', async () => {
    const staging = await makeTempDir('neumar-ffmpeg-skill-task-');
    const artifactPath = join(staging, 'cut.mp4');
    await writeFile(artifactPath, 'FAKE MP4 BYTES');
    const workDir = await makeTempDir('neumar-task-work-');

    const sessionId = `session-${randomUUID()}`;
    const taskId = `task-${randomUUID()}`;
    createSession({ id: sessionId, prompt: 'cut this clip' });
    createTask({
      id: taskId,
      session_id: sessionId,
      task_index: 0,
      prompt: 'cut this clip',
      work_dir: workDir,
    });

    const result = completedResult('cut', artifactPath, {});
    const published = await runWithSessionContext(
      { workDir, sessionId, taskId },
      () => publishFfmpegSkillArtifact(result, 'cut'),
    );

    const expected = join(workDir, 'output', 'cut.mp4');
    expect(published.status).toBe('completed');
    expect(published.artifact?.path).toBe(expected);

    // The raw staging path must be replaced by an authorized, owned reference.
    const row = getDatabase()
      .prepare('SELECT task_id, path, preview FROM files WHERE path = ?')
      .get(expected) as
      | { task_id: string; path: string; preview: string }
      | undefined;
    expect(row).toBeDefined();
    expect(row?.task_id).toBe(taskId);
    expect(row?.preview).toBe('Managed FFmpeg skill output');
  });

  it('copies a staged artifact into the video project and records provenance', async () => {
    // The runner stages under `/tmp`, outside the video project's readable
    // roots. Publication must copy it into the project assets dir (never pass
    // the staging path through addProjectAssetFromPath's path validation).
    const workDir = await makeTempDir('neumar-video-work-');
    vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
    const project = await createProject({
      name: 'skill-video',
      template: 'slideshow',
    });

    const staging = await makeTempDir('neumar-ffmpeg-skill-video-');
    const artifactPath = join(staging, 'cut.mp4');
    await writeFile(artifactPath, 'FAKE MP4 BYTES');

    const result = completedResult('cut', artifactPath, {});
    const published = await runWithSessionContext(
      { workDir, videoProjectId: project.id },
      () => publishFfmpegSkillArtifact(result, 'cut'),
    );

    expect(published.status).toBe('completed');
    expect(published.artifact?.path).toBeTruthy();
    expect(published.artifact?.path).not.toBe(artifactPath);

    const after = await getProject(project.id);
    expect(after.assets).toHaveLength(1);
    expect(after.assets[0]?.path).toBe(published.artifact?.path);
    expect(after.assets[0]?.provenance).toMatchObject({
      provider: 'ffmpeg-skill',
    });

    // The authorized reference exists inside the project; the staging dir is gone.
    expect(existsSync(join(workDir, published.artifact?.path ?? ''))).toBe(
      true,
    );
    expect(existsSync(artifactPath)).toBe(false);
  });

  it('attributes a produced artifact to the bound design project and nowhere else', async () => {
    const staging = await makeTempDir('neumar-ffmpeg-skill-design-');
    const artifactPath = join(staging, 'cut.mp4');
    await writeFile(artifactPath, 'FAKE MP4 BYTES');
    const workDir = await makeTempDir('neumar-design-work-');
    saveSetting('workDir', workDir);

    const project = await createDesignProject({
      title: 'skill-design',
      surface: 'prototype',
      workspaceRoot: workDir,
    });

    const result = completedResult('cut', artifactPath, {});
    const published = await runWithSessionContext(
      { workDir, designProjectId: project.id },
      () => publishFfmpegSkillArtifact(result, 'cut'),
    );

    expect(published.status).toBe('completed');
    expect(published.artifact?.path).toBeTruthy();

    const after = await getDesignProject(project.id);
    expect(after.outputs).toHaveLength(1);
    expect(after.outputs[0]?.path).toBe(published.artifact?.path);
    expect(after.outputs[0]?.provider).toBe('ffmpeg-skill');

    // The authorized reference exists inside the project; the staging dir is gone.
    expect(
      existsSync(
        join(getProjectDir(project.id), published.artifact?.path ?? ''),
      ),
    ).toBe(true);
    expect(existsSync(artifactPath)).toBe(false);

    // And nowhere else: no task file row was created for the design output.
    const row = getDatabase()
      .prepare('SELECT id FROM files WHERE path = ?')
      .get(join(getProjectDir(project.id), published.artifact?.path ?? ''));
    expect(row).toBeUndefined();
  });

  it('routes publication exclusively to the bound owner across task, design, and video', async () => {
    const workDir = await makeTempDir('neumar-isolation-work-');
    saveSetting('workDir', workDir);
    vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);

    // Task owner
    const sessionId = `session-${randomUUID()}`;
    const taskId = `task-${randomUUID()}`;
    createSession({ id: sessionId, prompt: 'isolate output' });
    createTask({
      id: taskId,
      session_id: sessionId,
      task_index: 0,
      prompt: 'isolate output',
      work_dir: workDir,
    });

    // Design owner
    const design = await createDesignProject({
      title: 'iso-design',
      surface: 'prototype',
      workspaceRoot: workDir,
    });

    // Video owner
    const video = await createProject({
      name: 'iso-video',
      template: 'slideshow',
    });

    const publish = async (
      ctx: { workDir: string } & Record<string, string | undefined>,
      tool: string,
    ) => {
      const staging = await makeTempDir('neumar-ffmpeg-skill-iso-');
      const artifactPath = join(staging, `${tool}.mp4`);
      await writeFile(artifactPath, 'ISOLATION MP4 BYTES');
      return runWithSessionContext(ctx, () =>
        publishFfmpegSkillArtifact(
          completedResult(tool, artifactPath, {}),
          tool,
        ),
      );
    };

    // Task context: reference lands only in the task's files row.
    const taskPublished = await publish({ workDir, sessionId, taskId }, 'cut');
    const taskRow = getDatabase()
      .prepare('SELECT task_id, path FROM files WHERE task_id = ?')
      .get(taskId) as { task_id: string; path: string } | undefined;
    expect(taskRow?.path).toBe(taskPublished.artifact?.path);
    expect((await getDesignProject(design.id)).outputs).toHaveLength(0);
    expect((await getProject(video.id)).assets).toHaveLength(0);

    // Design context: reference lands only in the design project's outputs.
    const designPublished = await publish(
      { workDir, designProjectId: design.id },
      'fit',
    );
    const designOutputs = (await getDesignProject(design.id)).outputs;
    expect(designOutputs).toHaveLength(1);
    expect(designOutputs[0]?.path).toBe(designPublished.artifact?.path);
    expect(
      getDatabase()
        .prepare('SELECT id FROM files WHERE path = ?')
        .get(designPublished.artifact?.path ?? ''),
    ).toBeUndefined();
    expect(
      getDatabase()
        .prepare('SELECT COUNT(*) AS c FROM files WHERE task_id = ?')
        .get(taskId) as { c: number },
    ).toEqual({ c: 1 });
    expect((await getProject(video.id)).assets).toHaveLength(0);

    // Video context: reference lands only in the video project's assets.
    const videoPublished = await publish(
      { workDir, videoProjectId: video.id },
      'crop',
    );
    const videoAssets = (await getProject(video.id)).assets;
    expect(videoAssets).toHaveLength(1);
    expect(videoAssets[0]?.path).toBe(videoPublished.artifact?.path);
    expect(
      getDatabase()
        .prepare('SELECT COUNT(*) AS c FROM files WHERE task_id = ?')
        .get(taskId) as { c: number },
    ).toEqual({ c: 1 });
    expect((await getDesignProject(design.id)).outputs).toHaveLength(1);
  });
});

function completedResult(
  tool: string,
  artifactPath: string,
  overrides: Partial<SkillOperationResult>,
): SkillOperationResult {
  return {
    status: 'completed',
    tool,
    exitCode: 0,
    artifactCreated: true,
    verified: true,
    preview: false,
    visualInspection: 'not_applicable',
    artifact: { path: artifactPath, bytes: 14, sha256: 'sha-256' },
    details: { ok: true },
    stderr: '',
    durationMs: 10,
    ...overrides,
  };
}
