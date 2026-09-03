import { spawn } from 'node:child_process';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const API_DIR = join(import.meta.dirname, '../../..');

function runMcp(args: string[]): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', 'src/index.ts', 'mcp', 'server', ...args],
      {
        cwd: API_DIR,
        env: { ...process.env, MCP_STDIO: '1', NODE_ENV: 'test' },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`timed out: stdout=${stdout} stderr=${stderr}`));
    }, 20_000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

describe('inbound MCP stdio entry', () => {
  it('prints usage on --help without writing stdout', async () => {
    const result = await runMcp(['--help']);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe('');
    expect(result.stderr).toMatch(/mcp server/i);
  });

  it('refuses a non-loopback daemon URL without stdout logs', async () => {
    const result = await runMcp(['--daemon-url', 'http://example.com:80']);
    expect(result.code).not.toBe(0);
    expect(result.stdout.trim()).toBe('');
    expect(result.stderr).toMatch(/loopback/i);
  });
});
