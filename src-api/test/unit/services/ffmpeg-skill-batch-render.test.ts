/**
 * Managed FFmpeg skill batch and render publication boundaries.
 *
 * These cases drive the real `executeSkillOperation` runner over synthetic
 * footage, then the real `publishFfmpegSkillArtifact` handoff, and assert what
 * the caller can observe at the publication path:
 *
 *   - a render whose chapters stage hands the export's own output back to the
 *     output guard completes and publishes that file (before the fix the guard
 *     refused the file the run itself had just written);
 *   - a repeated render whose project output already exists is refused, and
 *     neither that file nor the earlier published deliverable is replaced;
 *   - a symbolic link at the publication destination is refused without
 *     touching its target or registering a file;
 *   - a project-relative audiogram image is read against the project file, not
 *     the process working directory, and the render publishes;
 *   - a project-relative overlay font file reaches the overlay stage as the
 *     absolute path the project named (asserted on the planned command; this
 *     host's FFmpeg 9.0.2 has no `drawtext` filter, so the pixel path cannot
 *     run here);
 *   - a batch recipe is refused by the managed host before the payload runs,
 *     which is why the batch candidates in #300 cannot be reproduced through
 *     this caller.
 *
 * The suite is skipped when `detectBinaries()` cannot find ffmpeg/ffprobe,
 * matching the other real-media suites in this directory.
 */
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDatabase, getDatabase } from '@/shared/db';
import { createSession, createTask } from '@/shared/db/operations';
import { detectBinaries } from '@/shared/services/ffmpeg';
import { clearFfmpegContractCache } from '@/shared/services/ffmpeg-skill/contract';
import { publishFfmpegSkillArtifact } from '@/shared/services/ffmpeg-skill/handoff';
import {
  executeSkillOperation,
  type SkillOperationResult,
} from '@/shared/services/ffmpeg-skill/runner';
import { clearSkillRuntimeCache } from '@/shared/services/ffmpeg-skill/runtime';
import { runWithSessionContext } from '@/shared/services/session-context';

const binaries = detectBinaries();
const mediaDescribe =
  binaries && binaries.ffmpegPath && binaries.ffprobePath
    ? describe
    : describe.skip;

const tempDirs: string[] = [];

beforeEach(async () => {
  closeDatabase();
  vi.stubEnv(
    'NEUMAR_APP_DATA_DIR',
    await makeTempDir('neumar-batch-render-data-'),
  );
});

afterEach(async () => {
  closeDatabase();
  clearFfmpegContractCache();
  clearSkillRuntimeCache();
  vi.unstubAllEnvs();
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function makeTempDir(prefix: string): Promise<string> {
  const dir = realpathSync(await mkdtemp(path.join(tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}

function ffmpegBin(): string {
  if (!binaries?.ffmpegPath) throw new Error('ffmpeg not detected');
  return binaries.ffmpegPath;
}

function ffprobeBin(): string {
  if (!binaries?.ffprobePath) throw new Error('ffprobe not detected');
  return binaries.ffprobePath;
}

function runProcess(
  command: string,
  args: string[],
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function ffmpeg(args: string[]): Promise<void> {
  const { code, stderr } = await runProcess(ffmpegBin(), args);
  if (code !== 0) {
    throw new Error(`ffmpeg ${args.join(' ')} exited ${code}: ${stderr}`);
  }
}

async function makeSource(workDir: string): Promise<string> {
  const source = path.join(workDir, 'clip.mp4');
  await ffmpeg([
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=160x120:rate=25:duration=2',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=2',
    '-shortest',
    '-c:v',
    'libx264',
    '-g',
    '1',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    source,
  ]);
  return source;
}

function sha256Of(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

/** A session row plus a task row, so task-mode publication has an owner. */
async function bindTask(
  workDir: string,
): Promise<{ sessionId: string; taskId: string }> {
  const sessionId = `session-${randomUUID()}`;
  const taskId = `task-${randomUUID()}`;
  createSession({ id: sessionId, prompt: 'render this project' });
  createTask({
    id: taskId,
    session_id: sessionId,
    task_index: 0,
    prompt: 'render this project',
    work_dir: workDir,
  });
  return { sessionId, taskId };
}

async function writeProject(
  workDir: string,
  name: string,
  project: Record<string, unknown>,
): Promise<string> {
  const file = path.join(workDir, name);
  await writeFile(file, `${JSON.stringify(project, null, 2)}\n`, 'utf8');
  return file;
}

async function renderAndPublish(
  context: { workDir: string; sessionId: string; taskId: string },
  project: string,
  args: Record<string, unknown> = {},
): Promise<SkillOperationResult> {
  return runWithSessionContext(context, async () => {
    const result = await executeSkillOperation({
      tool: 'render',
      args: { project, ...args },
    });
    return publishFfmpegSkillArtifact(result, 'render');
  });
}

async function chapterCount(filePath: string): Promise<number> {
  const { code, stdout, stderr } = await runProcess(ffprobeBin(), [
    '-v',
    'error',
    '-show_chapters',
    '-of',
    'json',
    filePath,
  ]);
  if (code !== 0) {
    throw new Error(`ffprobe ${filePath} exited ${code}: ${stderr}`);
  }
  const parsed = JSON.parse(stdout) as { chapters?: unknown[] };
  return parsed.chapters?.length ?? 0;
}

mediaDescribe('render publication handoff', () => {
  it('publishes a render whose chapters stage hands back the export it just wrote', async () => {
    const workDir = await makeTempDir('neumar-ffmpeg-render-chapters-');
    const source = await makeSource(workDir);
    const sourceHash = sha256Of(source);
    const project = await writeProject(workDir, 'project.json', {
      output: 'final.mp4',
      clips: [{ src: 'clip.mp4' }],
      export: { preset: 'copy' },
      chapters: [{ at: '0:00', title: 'Intro' }],
    });
    const context = { workDir, ...(await bindTask(workDir)) };

    const published = await renderAndPublish(context, project);

    expect(published.status).toBe('completed');
    expect(published.artifactCreated).toBe(true);
    expect(published.verified).toBe(true);
    const publishedPath = published.artifact?.path ?? '';
    expect(publishedPath).toBe(path.join(workDir, 'output', 'final.mp4'));
    expect(existsSync(publishedPath)).toBe(true);
    expect(await chapterCount(publishedPath)).toBe(1);
    // The render never replaced its own input.
    expect(sha256Of(source)).toBe(sourceHash);
    expect(
      getDatabase()
        .prepare('SELECT COUNT(*) AS c FROM files WHERE task_id = ?')
        .get(context.taskId),
    ).toEqual({ c: 1 });
  });

  it('refuses a repeated render whose project output collides with the earlier one', async () => {
    const workDir = await makeTempDir('neumar-ffmpeg-render-repeat-');
    await makeSource(workDir);
    const project = await writeProject(workDir, 'project.json', {
      output: 'final.mp4',
      clips: [{ src: 'clip.mp4' }],
      export: { preset: 'copy' },
      chapters: [{ at: '0:00', title: 'Intro' }],
    });
    const context = { workDir, ...(await bindTask(workDir)) };

    const first = await renderAndPublish(context, project);
    expect(first.status).toBe('completed');
    if (!first.artifact) throw new Error('First render did not publish');
    const firstHash = sha256Of(first.artifact.path);
    // The project names its own output beside itself; the host cannot stage it.
    const projectOutput = path.join(workDir, 'final.mp4');
    const projectOutputHash = sha256Of(projectOutput);

    const second = await renderAndPublish(context, project);
    expect(second.status).toBe('failed');
    expect(second.error).toMatchObject({ kind: 'input' });
    expect(second.error?.message).toContain('refusing to overwrite');
    expect(second.artifactCreated).toBe(false);
    expect(second.artifact).toBeNull();
    expect(sha256Of(projectOutput)).toBe(projectOutputHash);
    expect(sha256Of(first.artifact.path)).toBe(firstHash);
    expect(await chapterCount(first.artifact.path)).toBe(1);
    expect(
      getDatabase()
        .prepare('SELECT COUNT(*) AS c FROM files WHERE task_id = ?')
        .get(context.taskId),
    ).toEqual({ c: 1 });
  });

  it('refuses a publication symlink without replacing its target or registering a file', async () => {
    const workDir = await makeTempDir('neumar-ffmpeg-render-collision-');
    const source = await makeSource(workDir);
    const sourceHash = sha256Of(source);
    await mkdir(path.join(workDir, 'output'));
    await symlink(source, path.join(workDir, 'output', 'final.mp4'));
    const project = await writeProject(workDir, 'project.json', {
      output: 'final.mp4',
      clips: [{ src: 'clip.mp4' }],
      export: { preset: 'copy' },
      chapters: [{ at: '0:00', title: 'Intro' }],
    });
    const context = { workDir, ...(await bindTask(workDir)) };

    const result = await renderAndPublish(context, project);
    expect(result.status).toBe('failed');
    expect(result.error).toMatchObject({ kind: 'publication' });
    expect(result.error?.message).toContain('symbolic link');
    expect(result.artifactCreated).toBe(false);
    expect(result.artifact).toBeNull();
    expect(sha256Of(source)).toBe(sourceHash);
    expect(
      getDatabase()
        .prepare('SELECT COUNT(*) AS c FROM files WHERE task_id = ?')
        .get(context.taskId),
    ).toEqual({ c: 0 });
  });

  it('reads a project-relative audiogram image against the project file and publishes', async () => {
    const workDir = await makeTempDir('neumar-ffmpeg-render-audiogram-');
    await makeSource(workDir);
    await ffmpeg([
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=blue:s=64x64:d=1',
      '-frames:v',
      '1',
      path.join(workDir, 'cover.png'),
    ]);
    const project = await writeProject(workDir, 'project.json', {
      output: 'audiogram.mp4',
      clips: [{ src: 'clip.mp4' }],
      audiogram: { image: 'cover.png' },
    });
    const context = { workDir, ...(await bindTask(workDir)) };

    const published = await renderAndPublish(context, project);

    expect(published.status).toBe('completed');
    expect(published.artifactCreated).toBe(true);
    const publishedPath = published.artifact?.path ?? '';
    expect(publishedPath).toBe(path.join(workDir, 'output', 'audiogram.mp4'));
    expect(existsSync(publishedPath)).toBe(true);
  });

  it('passes a project-relative overlay font file to the overlay stage as an absolute path', async () => {
    const workDir = await makeTempDir('neumar-ffmpeg-render-font-');
    await makeSource(workDir);
    const font = path.join(workDir, 'custom.ttf');
    await writeFile(font, 'not-a-real-font');
    const project = await writeProject(workDir, 'project.json', {
      output: 'overlay.mp4',
      clips: [{ src: 'clip.mp4' }],
      overlays: [
        {
          text: 'Hello',
          position: 'bottom',
          font_file: 'custom.ttf',
          start: 0,
          end: 1,
        },
      ],
    });

    const result = await runWithSessionContext({ workDir }, () =>
      executeSkillOperation({
        tool: 'render',
        args: { project, dry_run: true },
      }),
    );

    expect(result.status).toBe('completed');
    const details = result.details as { commands?: unknown } | null;
    const commands = Array.isArray(details?.commands)
      ? details.commands.filter(
          (entry): entry is string => typeof entry === 'string',
        )
      : [];
    const overlay = commands.find((command) => command.includes('fontfile='));
    expect(overlay).toBeTruthy();
    expect(overlay).toContain(`fontfile=${font}`);
  });
});

describe('batch through the managed caller', () => {
  it('refuses a batch recipe before the payload runs', async () => {
    const workDir = await makeTempDir('neumar-ffmpeg-batch-refused-');
    const recipe = path.join(workDir, 'batch.json');
    await writeFile(
      recipe,
      JSON.stringify({ glob: '*.mp4', steps: [['probe.py', '{in}']] }),
      'utf8',
    );

    await expect(
      runWithSessionContext({ workDir }, () =>
        executeSkillOperation({
          tool: 'batch',
          args: { folder: workDir, recipe },
        }),
      ),
    ).rejects.toThrow(/batch recipes are not executed/);
  });
});
