import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { clearBinaryCache, detectBinaries } from '@/shared/services/ffmpeg';
import { clearFfmpegContractCache } from '@/shared/services/ffmpeg-skill/contract';
import { executeSkillOperation } from '@/shared/services/ffmpeg-skill/runner';
import {
  clearSkillRuntimeCache,
  resolveSkillRuntime,
} from '@/shared/services/ffmpeg-skill/runtime';
import { runSupervised } from '@/shared/services/ffmpeg-skill/supervisor';
import { runWithSessionContext } from '@/shared/services/session-context';

vi.mock('@/shared/services/ffmpeg', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/shared/services/ffmpeg')>();
  return {
    ...original,
    detectBinaries: vi.fn(original.detectBinaries),
  };
});

const tempDirs: string[] = [];

function makeDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  clearFfmpegContractCache();
  clearSkillRuntimeCache();
  clearBinaryCache();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('skill process supervisor', () => {
  it('caps retained output', async () => {
    await expect(
      runSupervised({
        command: process.execPath,
        args: ['-e', 'process.stdout.write("x".repeat(50_000))'],
        cwd: process.cwd(),
        env: process.env,
        maxOutputBytes: 1024,
        killGraceMs: 200,
      }),
    ).rejects.toMatchObject({ kind: 'output_limit' });
  });

  it('stops a silent hang at the deadline', async () => {
    const started = Date.now();
    await expect(
      runSupervised({
        command: process.execPath,
        args: ['-e', 'setInterval(() => {}, 1000)'],
        cwd: process.cwd(),
        env: process.env,
        timeoutMs: 400,
        killGraceMs: 200,
      }),
    ).rejects.toMatchObject({ kind: 'timeout' });
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('kills a grandchild when the run is aborted', async () => {
    const marker = path.join(makeDir('neuma-skill-tree-'), 'alive');
    const controller = new AbortController();
    // The grandchild stays in the Python child's process group, like the
    // vendored runner's own ffmpeg subprocesses. A detached grandchild would
    // form its own group and is not what the supervisor has to kill.
    const child = `
      const { spawn } = require('node:child_process');
      const fs = require('node:fs');
      const grand = spawn(process.execPath, ['-e', 'setInterval(() => { fs.writeFileSync(${JSON.stringify(marker)}, String(process.pid)); }, 50)'], { stdio: 'ignore' });
      setInterval(() => {}, 1000);
    `;
    const pending = runSupervised({
      command: process.execPath,
      args: ['-e', child],
      cwd: process.cwd(),
      env: process.env,
      signal: controller.signal,
      killGraceMs: 300,
    });
    await waitFor(() => statSync(marker).isFile());
    const grandchildPid = Number(readFileSync(marker, 'utf8'));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ kind: 'aborted' });
    await waitFor(() => !processAlive(grandchildPid));
    expect(processAlive(grandchildPid)).toBe(false);
  });

  it('escalates to SIGKILL when the child ignores SIGTERM', async () => {
    const started = Date.now();
    await expect(
      runSupervised({
        command: process.execPath,
        args: [
          '-e',
          'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);',
        ],
        cwd: process.cwd(),
        env: process.env,
        timeoutMs: 300,
        killGraceMs: 200,
      }),
    ).rejects.toMatchObject({ kind: 'timeout' });
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('returns a non-zero exit instead of throwing', async () => {
    const result = await runSupervised({
      command: process.execPath,
      args: ['-e', 'console.error("boom"); process.exit(3)'],
      cwd: process.cwd(),
      env: process.env,
    });
    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain('boom');
  });

  it('does not report success after cancellation', async () => {
    const controller = new AbortController();
    const script = `
      setTimeout(() => { process.stdout.write('{"status":"completed","verified":true}'); process.exit(0); }, 300);
    `;
    const pending = runSupervised({
      command: process.execPath,
      args: ['-e', script],
      cwd: process.cwd(),
      env: process.env,
      signal: controller.signal,
      killGraceMs: 200,
    });
    setTimeout(() => controller.abort(), 50);
    await expect(pending).rejects.toMatchObject({ kind: 'aborted' });
  });
});

describe('skill runtime resolution', () => {
  it('names the missing tool when ffmpeg is not installed', () => {
    vi.mocked(detectBinaries).mockReturnValueOnce(null);
    expect(() => resolveSkillRuntime('test')).toThrow(
      /FFmpeg is not installed/,
    );
  });
});

describe('managed skill operations on synthetic media', () => {
  it('probes and cuts without changing the source', async () => {
    const workspace = makeDir('neuma-skill-media-');
    const source = path.join(workspace, 'source.mp4');
    const output = path.join(workspace, 'cut.mp4');
    await runChecked('ffmpeg', [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=160x120:rate=25:duration=2',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=2',
      '-shortest',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      source,
    ]);
    const before = createHash('sha256')
      .update(readFileSync(source))
      .digest('hex');

    const probe = await runWithSessionContext({ workDir: workspace }, () =>
      executeSkillOperation({
        tool: 'probe',
        args: { inputs: [source] },
        preview: true,
      }),
    );
    expect(probe.status).toBe('completed');
    expect(probe.artifactCreated).toBe(false);
    expect(probe.verified).toBe(false);
    expect(JSON.stringify(probe.details)).toContain('duration');

    const cut = await runWithSessionContext({ workDir: workspace }, () =>
      executeSkillOperation({
        tool: 'cut',
        args: {
          input: source,
          start: '0',
          duration: '1',
          output,
          accurate: true,
        },
      }),
    );
    expect(cut.status).toBe('completed');
    expect(cut.artifactCreated).toBe(true);
    expect(cut.artifact?.path).not.toBe(output);
    expect(statSync(cut.artifact!.path).isFile()).toBe(true);
    expect(readFileSync(cut.artifact!.path).byteLength).toBeGreaterThan(0);
    const after = createHash('sha256')
      .update(readFileSync(source))
      .digest('hex');
    expect(after).toBe(before);
    // The requested output never lands in the workspace; publication is a
    // later handoff. The staged file is what the host validated and returned.
    expect(statSync(output, { throwIfNoEntry: false })).toBeUndefined();

    const measured = await runChecked('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'csv=p=0',
      cut.artifact!.path,
    ]);
    const duration = Number(measured.trim());
    expect(duration).toBeGreaterThan(0.8);
    expect(duration).toBeLessThan(1.3);
  });

  it('preview does not create a deliverable', async () => {
    const workspace = makeDir('neuma-skill-preview-');
    const source = path.join(workspace, 'source.mp4');
    writeFileSync(source, 'not-a-real-video');
    const before = snapshot(workspace);
    await expect(
      runWithSessionContext({ workDir: workspace }, () =>
        executeSkillOperation({
          tool: 'cut',
          args: { input: source, start: '0', duration: '1' },
          preview: true,
        }),
      ),
    ).rejects.toThrow(/preview of cut would write/);
    expect(snapshot(workspace)).toEqual(before);
  });
});

function snapshot(dir: string): string[] {
  return statSync(dir) && readdir(dir);
}

function readdir(dir: string): string[] {
  const { readdirSync } = require('node:fs') as typeof import('node:fs');
  return readdirSync(dir).sort();
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(check: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (check()) return;
    } catch {
      // Not ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('timed out waiting for condition');
}

function runChecked(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} exited ${code}: ${stderr}`));
    });
  });
}

void mkdirSync;
void writeFileSync;
