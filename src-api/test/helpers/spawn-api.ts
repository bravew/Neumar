import { spawn, type ChildProcess } from 'child_process';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { getFreePort } from './free-port';
import { pollUntil } from './poll';

export interface ApiInstance {
  port: number;
  child: ChildProcess;
  homeDir: string;
  baseUrl: string;
  stdout: string[];
  stderr: string[];
}

const API_START_TIMEOUT_MS = 30_000;
const GRACEFUL_SHUTDOWN_MS = 5_000;

export async function spawnApiInstance(
  name: string = 'default',
  options: { env?: Record<string, string> } = {},
): Promise<ApiInstance> {
  const port = await getFreePort();
  const homeDir = await mkdtemp(join(tmpdir(), `neumar-e2e-${name}-`));

  const stdout: string[] = [];
  const stderr: string[] = [];

  const apiDir = join(import.meta.dirname, '..', '..');

  const child = spawn('npx', ['tsx', 'src/index.ts'], {
    cwd: apiDir,
    env: {
      ...process.env,
      HOME: homeDir,
      PORT: String(port),
      NODE_ENV: 'test',
      ...options.env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout!.on('data', (chunk: Buffer) => {
    stdout.push(chunk.toString());
  });

  child.stderr!.on('data', (chunk: Buffer) => {
    stderr.push(chunk.toString());
  });

  const baseUrl = `http://127.0.0.1:${port}`;

  const ready = await pollUntil(
    async () => {
      try {
        const res = await fetch(`${baseUrl}/health`);
        return res.ok ? true : null;
      } catch {
        return null;
      }
    },
    { timeoutMs: API_START_TIMEOUT_MS, intervalMs: 200 },
  );

  if (!ready) {
    child.kill('SIGKILL');
    throw new Error(
      `API server failed to start within ${API_START_TIMEOUT_MS}ms.\n` +
        `stdout: ${stdout.join('')}\nstderr: ${stderr.join('')}`,
    );
  }

  return { port, child, homeDir, baseUrl, stdout, stderr };
}

export async function stopApiInstance(inst: ApiInstance): Promise<void> {
  if (inst.child.exitCode !== null) {
    await rm(inst.homeDir, { recursive: true, force: true });
    return;
  }

  inst.child.kill('SIGTERM');

  let timer: ReturnType<typeof setTimeout> | undefined;

  const exited = await Promise.race([
    new Promise<boolean>((resolve) => {
      inst.child.once('exit', () => resolve(true));
    }),
    new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), GRACEFUL_SHUTDOWN_MS);
    }),
  ]);

  clearTimeout(timer);

  if (!exited) inst.child.kill('SIGKILL');
  await rm(inst.homeDir, { recursive: true, force: true });
}
