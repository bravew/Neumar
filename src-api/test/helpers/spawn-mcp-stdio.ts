import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { APP_DATA_DIR } from '@/config/branding';

export interface McpStdioChild {
  child: ChildProcess;
  stdout: string;
  stderr: string;
  frames: unknown[];
  label: string;
}

export interface SpawnMcpStdioOptions {
  daemonUrl?: string;
  homeDir: string;
  env?: Record<string, string>;
  extraArgs?: string[];
  commandOverride?: { command: string; args: string[]; label: string };
}

const API_DIR = join(import.meta.dirname, '..', '..');

export function resolveMcpStdioLaunch(): {
  command: string;
  args: string[];
  label: string;
} {
  const bin = process.env.NEUMAR_MCP_BIN?.trim();
  if (bin) {
    return { command: bin, args: ['mcp', 'server'], label: 'NEUMAR_MCP_BIN' };
  }
  if (process.env.NEUMAR_MCP_USE_BUNDLE === '1') {
    const bundle = join(API_DIR, 'dist', 'bundle.cjs');
    if (existsSync(bundle)) {
      return {
        command: process.execPath,
        args: [bundle, 'mcp', 'server'],
        label: 'bundle',
      };
    }
  }
  const dist = join(API_DIR, 'dist', 'index.js');
  if (process.env.NEUMAR_MCP_USE_DIST === '1' && existsSync(dist)) {
    return {
      command: process.execPath,
      args: [dist, 'mcp', 'server'],
      label: 'dist',
    };
  }
  return {
    command: process.execPath,
    args: ['--import', 'tsx', 'src/index.ts', 'mcp', 'server'],
    label: 'tsx',
  };
}

export function packagedSidecarPath(): string | null {
  const candidates = [
    join(API_DIR, 'dist', 'neumar-api-aarch64-apple-darwin'),
    join(API_DIR, 'dist', 'neumar-api-x86_64-apple-darwin'),
    join(API_DIR, 'dist', 'neumar-api-x86_64-unknown-linux-gnu'),
    join(API_DIR, 'dist', 'neumar-api-x86_64-pc-windows-msvc.exe'),
  ];
  return candidates.find((path) => existsSync(path)) ?? null;
}

export function encodeRpc(message: unknown): string {
  return `${JSON.stringify(message)}\n`;
}

function takeFrames(buffer: { text: string; frames: unknown[] }): void {
  let newline = buffer.text.indexOf('\n');
  while (newline !== -1) {
    const line = buffer.text.slice(0, newline).trim();
    buffer.text = buffer.text.slice(newline + 1);
    if (line.length > 0) {
      buffer.frames.push(JSON.parse(line) as unknown);
    }
    newline = buffer.text.indexOf('\n');
  }
}

export function spawnMcpStdio(options: SpawnMcpStdioOptions): McpStdioChild {
  const launch = options.commandOverride ?? resolveMcpStdioLaunch();
  const args = [
    ...launch.args,
    ...(options.daemonUrl ? ['--daemon-url', options.daemonUrl] : []),
    ...(options.extraArgs ?? []),
  ];
  const appDataDir = join(options.homeDir, APP_DATA_DIR);
  const child = spawn(launch.command, args, {
    cwd: API_DIR,
    env: {
      ...process.env,
      HOME: options.homeDir,
      NEUMAR_APP_DATA_DIR: appDataDir,
      MCP_STDIO: '1',
      NODE_ENV: 'test',
      ...options.env,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const session: McpStdioChild = {
    child,
    stdout: '',
    stderr: '',
    frames: [],
    label: launch.label,
  };
  const pending = { text: '', frames: session.frames };

  child.stdout?.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8');
    session.stdout += text;
    pending.text += text;
    try {
      takeFrames(pending);
    } catch {
      // Keep raw stdout for the purity assertion; frame waiters time out.
    }
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    session.stderr += chunk.toString('utf8');
  });

  return session;
}

export async function waitForRpc(
  session: McpStdioChild,
  id: number,
  timeoutMs = 15_000,
): Promise<{ result?: unknown; error?: unknown }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const index = session.frames.findIndex(
      (frame) => (frame as { id?: number }).id === id,
    );
    if (index !== -1) {
      return session.frames.splice(index, 1)[0] as {
        result?: unknown;
        error?: unknown;
      };
    }
    if (session.child.exitCode !== null) {
      throw new Error(
        `MCP child exited ${session.child.exitCode} before RPC id ${id}. stdout=${session.stdout} stderr=${session.stderr}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(
    `Timed out waiting for JSON-RPC id ${id} (${session.label}). stdout=${session.stdout} stderr=${session.stderr}`,
  );
}

export async function stopMcpStdio(
  session: McpStdioChild,
): Promise<number | null> {
  if (session.child.exitCode !== null) return session.child.exitCode;
  session.child.stdin?.end();
  const exited = await Promise.race([
    new Promise<number | null>((resolve) => {
      session.child.once('exit', (code) => resolve(code));
    }),
    new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), 3_000);
    }),
  ]);
  if (exited === null && session.child.exitCode === null) {
    session.child.kill('SIGKILL');
    await new Promise((resolve) => session.child.once('exit', resolve));
  }
  return session.child.exitCode;
}

export function assertStdoutIsJsonRpc(stdout: string): void {
  const lines = stdout.split(/\r?\n/).filter((line) => line.trim().length > 0);
  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(`stdout contained non-JSON: ${line}`);
    }
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      (parsed as { jsonrpc?: string }).jsonrpc !== '2.0'
    ) {
      throw new Error(`stdout contained a non-JSON-RPC line: ${line}`);
    }
  }
}

export async function initializeMcp(session: McpStdioChild): Promise<unknown> {
  session.child.stdin?.write(
    encodeRpc({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'external-mcp-e2e', version: '0.0.0' },
      },
    }),
  );
  const init = await waitForRpc(session, 1);
  session.child.stdin?.write(
    encodeRpc({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  );
  return init.result;
}
