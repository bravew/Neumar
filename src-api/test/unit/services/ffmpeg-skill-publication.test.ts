/**
 * Publication-boundary regression coverage for the managed FFmpeg skill.
 *
 * The runner validates a staged artifact and hands it to
 * `publishFfmpegSkillArtifact`, which copies it into the session owner's
 * directory. That final copy is the one place the runner's staging validation
 * cannot see: the destination parent belongs to the workspace, so an earlier
 * deliverable or a symlink planted there decides where the bytes land.
 *
 * These cases drive the real `executeSkillOperation` runner over synthetic
 * FFmpeg footage and assert measured facts at the publication path:
 *
 *   - repeating one operation yields two distinct outputs and leaves the
 *     source and the first output byte-identical,
 *   - a symlinked destination file, and a symlinked destination parent, are
 *     refused with no write through the link,
 *   - a failed output record removes the file it would have described.
 *
 * The media case is skipped when `detectBinaries()` cannot find ffmpeg/ffprobe,
 * matching the other real-media suites in this directory.
 */
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDatabase, getDatabase } from '@/shared/db';
import { createFile, createSession, createTask } from '@/shared/db/operations';
import { detectBinaries } from '@/shared/services/ffmpeg';
import { clearFfmpegContractCache } from '@/shared/services/ffmpeg-skill/contract';
import { publishFfmpegSkillArtifact } from '@/shared/services/ffmpeg-skill/handoff';
import { executeSkillOperation } from '@/shared/services/ffmpeg-skill/runner';
import type { SkillOperationResult } from '@/shared/services/ffmpeg-skill/runner';
import { clearSkillRuntimeCache } from '@/shared/services/ffmpeg-skill/runtime';
import { runWithSessionContext } from '@/shared/services/session-context';

vi.mock('@/shared/db/operations', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/shared/db/operations')>();
  return { ...original, createFile: vi.fn(original.createFile) };
});

const binaries = detectBinaries();
const mediaDescribe =
  binaries && binaries.ffmpegPath && binaries.ffprobePath
    ? describe
    : describe.skip;

const tempDirs: string[] = [];

beforeEach(async () => {
  closeDatabase();
  vi.stubEnv('NEUMAR_APP_DATA_DIR', await makeTempDir('neumar-publish-data-'));
});

afterEach(async () => {
  closeDatabase();
  clearFfmpegContractCache();
  clearSkillRuntimeCache();
  vi.mocked(createFile).mockClear();
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

async function ffmpeg(args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegBin(), args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`ffmpeg exited ${code}: ${stderr}`)),
    );
  });
}

async function makeSource(workDir: string): Promise<string> {
  const source = path.join(workDir, 'source.mp4');
  await ffmpeg([
    '-y',
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
  createSession({ id: sessionId, prompt: 'cut this clip' });
  createTask({
    id: taskId,
    session_id: sessionId,
    task_index: 0,
    prompt: 'cut this clip',
    work_dir: workDir,
  });
  return { sessionId, taskId };
}

function completedResult(
  artifactPath: string,
  overrides: Partial<SkillOperationResult> = {},
): SkillOperationResult {
  return {
    status: 'completed',
    tool: 'cut',
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

mediaDescribe('repeat publication', () => {
  it('publishes two distinct outputs and changes neither the source nor the first output', async () => {
    const workDir = await makeTempDir('neumar-ffmpeg-publish-');
    const source = await makeSource(workDir);
    const sourceHash = sha256Of(source);
    const { sessionId, taskId } = await bindTask(workDir);
    const context = { workDir, sessionId, taskId };

    const runOnce = () =>
      runWithSessionContext(context, async () => {
        const result = await executeSkillOperation({
          tool: 'cut',
          args: { input: source, start: '0', duration: '1' },
        });
        return publishFfmpegSkillArtifact(result, 'cut');
      });

    const first = await runOnce();
    expect(first.status).toBe('completed');
    const firstPath = first.artifact?.path;
    expect(firstPath).toBeTruthy();
    expect(existsSync(firstPath!)).toBe(true);
    const firstHash = sha256Of(firstPath!);

    const second = await runOnce();
    expect(second.status).toBe('completed');
    const secondPath = second.artifact?.path;
    expect(secondPath).toBeTruthy();

    // A repeat run is a new deliverable, not a replacement of the earlier one.
    expect(secondPath).not.toBe(firstPath);
    expect(existsSync(secondPath!)).toBe(true);
    expect((await stat(secondPath!)).size).toBeGreaterThan(0);

    // Neither the source nor the previously published output moved.
    expect(sha256Of(source)).toBe(sourceHash);
    expect(existsSync(firstPath!)).toBe(true);
    expect(sha256Of(firstPath!)).toBe(firstHash);

    const rows = getDatabase()
      .prepare('SELECT path FROM files WHERE task_id = ? ORDER BY path')
      .all(taskId) as Array<{ path: string }>;
    expect(rows.map((row) => row.path).sort()).toEqual(
      [firstPath, secondPath].sort(),
    );
  });
});

describe('publication destination policy', () => {
  it('keeps the workspace spelling of the published path', async () => {
    // Containment is checked on the resolved parent, but the path handed back
    // must stay under the workspace as the workspace spells it. On macOS a
    // workspace under /var resolves to /private/var, and a stored path outside
    // the workspace is one the task can no longer open. `makeTempDir` resolves
    // its directory, so this case builds an unresolved one on purpose.
    const workDir = await mkdtemp(
      path.join(tmpdir(), 'neumar-ffmpeg-spelling-'),
    );
    tempDirs.push(workDir);
    const { sessionId, taskId } = await bindTask(workDir);
    const staging = await makeTempDir('neumar-ffmpeg-skill-');
    const artifactPath = path.join(staging, 'source-cut.mp4');
    await writeFile(artifactPath, 'NEW DELIVERABLE BYTES');

    const published = await runWithSessionContext(
      { workDir, sessionId, taskId },
      () => publishFfmpegSkillArtifact(completedResult(artifactPath), 'cut'),
    );

    expect(published.status).toBe('completed');
    const publishedPath = published.artifact?.path ?? '';
    expect(publishedPath).toBe(path.join(workDir, 'output', 'source-cut.mp4'));
    expect(existsSync(publishedPath)).toBe(true);
  });

  it('allocates distinct files for simultaneous publications with the same name', async () => {
    const workDir = await makeTempDir('neumar-ffmpeg-concurrent-');
    const { sessionId, taskId } = await bindTask(workDir);
    const published = await Promise.all(
      ['FIRST BYTES', 'SECOND BYTES'].map(async (bytes) => {
        const staging = await makeTempDir('neumar-ffmpeg-skill-');
        const artifactPath = path.join(staging, 'source-cut.mp4');
        await writeFile(artifactPath, bytes);
        return runWithSessionContext({ workDir, sessionId, taskId }, () =>
          publishFfmpegSkillArtifact(completedResult(artifactPath), 'cut'),
        );
      }),
    );
    expect(published.map((result) => result.status)).toEqual([
      'completed',
      'completed',
    ]);
    const paths = published.map((result) => result.artifact!.path);
    expect(new Set(paths).size).toBe(2);
    expect(paths.map((file) => readFileSync(file, 'utf8')).sort()).toEqual([
      'FIRST BYTES',
      'SECOND BYTES',
    ]);
    expect(
      getDatabase()
        .prepare('SELECT COUNT(*) AS c FROM files WHERE task_id = ?')
        .get(taskId),
    ).toEqual({ c: 2 });
  });

  it('refuses a destination that is a symlink and writes nothing through it', async () => {
    const workDir = await makeTempDir('neumar-ffmpeg-symlink-');
    const { sessionId, taskId } = await bindTask(workDir);
    const outside = await makeTempDir('neumar-ffmpeg-outside-');
    const victim = path.join(outside, 'victim.mp4');
    await writeFile(victim, 'ORIGINAL BYTES');
    const victimHash = sha256Of(victim);

    const outputDir = path.join(workDir, 'output');
    await mkdir(outputDir, { recursive: true });
    const artifactName = 'source-cut.mp4';
    const linkPath = path.join(outputDir, artifactName);
    await symlink(victim, linkPath);

    const staging = await makeTempDir('neumar-ffmpeg-skill-');
    const artifactPath = path.join(staging, artifactName);
    await writeFile(artifactPath, 'NEW DELIVERABLE BYTES');

    const published = await runWithSessionContext(
      { workDir, sessionId, taskId },
      () => publishFfmpegSkillArtifact(completedResult(artifactPath), 'cut'),
    );

    expect(published.status).toBe('failed');
    expect(published.artifact).toBeNull();
    expect(published.error?.kind).toBe('publication');
    // The link is untouched and nothing was written through it.
    expect(existsSync(victim)).toBe(true);
    expect(sha256Of(victim)).toBe(victimHash);
    expect(readFileSync(victim, 'utf8')).toBe('ORIGINAL BYTES');
    expect(existsSync(path.join(outputDir, artifactName))).toBe(true);
    expect(
      getDatabase()
        .prepare('SELECT COUNT(*) AS c FROM files WHERE task_id = ?')
        .get(taskId),
    ).toEqual({ c: 0 });
  });

  it('refuses a destination whose parent resolves outside the owner root', async () => {
    const workDir = await makeTempDir('neumar-ffmpeg-parent-');
    const { sessionId, taskId } = await bindTask(workDir);
    const outside = await makeTempDir('neumar-ffmpeg-parent-outside-');
    // `workDir/output` is a link to a directory outside the workspace.
    await symlink(outside, path.join(workDir, 'output'));

    const staging = await makeTempDir('neumar-ffmpeg-skill-');
    const artifactPath = path.join(staging, 'source-cut.mp4');
    await writeFile(artifactPath, 'NEW DELIVERABLE BYTES');

    const published = await runWithSessionContext(
      { workDir, sessionId, taskId },
      () => publishFfmpegSkillArtifact(completedResult(artifactPath), 'cut'),
    );

    expect(published.status).toBe('failed');
    expect(published.error?.kind).toBe('publication');
    // Nothing landed outside the workspace.
    expect(await readdir(outside)).toEqual([]);
    expect(
      getDatabase()
        .prepare('SELECT COUNT(*) AS c FROM files WHERE task_id = ?')
        .get(taskId),
    ).toEqual({ c: 0 });
  });

  it('removes the published file when the output record cannot be written', async () => {
    const workDir = await makeTempDir('neumar-ffmpeg-db-failure-');
    const { sessionId, taskId } = await bindTask(workDir);

    const staging = await makeTempDir('neumar-ffmpeg-skill-');
    const artifactPath = path.join(staging, 'source-cut.mp4');
    await writeFile(artifactPath, 'NEW DELIVERABLE BYTES');

    vi.mocked(createFile).mockImplementationOnce(() => {
      throw new Error('database is unavailable');
    });

    const published = await runWithSessionContext(
      { workDir, sessionId, taskId },
      () => publishFfmpegSkillArtifact(completedResult(artifactPath), 'cut'),
    );

    expect(published.status).toBe('failed');
    expect(published.error?.kind).toBe('publication');
    expect(published.artifact).toBeNull();
    // The file the record would have described is gone, not orphaned.
    expect(existsSync(path.join(workDir, 'output', 'source-cut.mp4'))).toBe(
      false,
    );
    expect(
      getDatabase()
        .prepare('SELECT COUNT(*) AS c FROM files WHERE task_id = ?')
        .get(taskId),
    ).toEqual({ c: 0 });
  });
});
