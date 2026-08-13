import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runHeadlessPrompt } from '@/extensions/agent/shared/cli';

const roots: string[] = [];

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'neuma-headless-test-'));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('runHeadlessPrompt', () => {
  it('uses a bounded prompt file and removes it after the run', async () => {
    const cwd = await workspace();
    let promptFile = '';
    const result = await runHeadlessPrompt({
      binaryPath: process.execPath,
      cwd,
      env: process.env,
      prompt: 'hello from prompt file',
      maxTurns: 7,
      buildArgs: (input) => {
        promptFile = input.promptFile;
        return [
          '-e',
          "const fs=require('fs');process.stdout.write(fs.readFileSync(process.argv[1],'utf8')+'|'+process.argv[2])",
          input.promptFile,
          String(input.maxTurns),
        ];
      },
    });

    expect(result).toMatchObject({
      code: 0,
      stdout: 'hello from prompt file|7',
      stderr: '',
      timedOut: false,
      cancelled: false,
    });
    await expect(access(promptFile)).rejects.toThrow();
  });

  it('keeps diagnostics on stderr and preserves non-zero exit codes', async () => {
    const result = await runHeadlessPrompt({
      binaryPath: process.execPath,
      cwd: await workspace(),
      env: process.env,
      prompt: 'prompt',
      maxTurns: 1,
      buildArgs: () => [
        '-e',
        "process.stdout.write('answer');process.stderr.write('diagnostic');process.exit(9)",
      ],
    });

    expect(result).toMatchObject({
      code: 9,
      stdout: 'answer',
      stderr: 'diagnostic',
    });
  });

  it('terminates on timeout and abort', async () => {
    const script = 'setInterval(()=>{},1000)';
    const timedOut = await runHeadlessPrompt({
      binaryPath: process.execPath,
      cwd: await workspace(),
      env: process.env,
      prompt: 'prompt',
      maxTurns: 1,
      timeoutMs: 30,
      buildArgs: () => ['-e', script],
    });
    expect(timedOut.timedOut).toBe(true);

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 30);
    const cancelled = await runHeadlessPrompt({
      binaryPath: process.execPath,
      cwd: await workspace(),
      env: process.env,
      prompt: 'prompt',
      maxTurns: 1,
      abortSignal: controller.signal,
      buildArgs: () => ['-e', script],
    });
    expect(cancelled.cancelled).toBe(true);
  });

  it('rejects oversized prompts, turn counts, and output', async () => {
    const cwd = await workspace();
    await expect(
      runHeadlessPrompt({
        binaryPath: process.execPath,
        cwd,
        env: process.env,
        prompt: 'too large',
        maxPromptBytes: 2,
        maxTurns: 1,
        buildArgs: () => [],
      }),
    ).rejects.toThrow('Prompt exceeds');
    await expect(
      runHeadlessPrompt({
        binaryPath: process.execPath,
        cwd,
        env: process.env,
        prompt: 'ok',
        maxTurns: 101,
        buildArgs: () => [],
      }),
    ).rejects.toThrow('maxTurns');
    await expect(
      runHeadlessPrompt({
        binaryPath: process.execPath,
        cwd,
        env: process.env,
        prompt: 'ok',
        maxTurns: 1,
        maxStdoutBytes: 4,
        buildArgs: () => ['-e', "process.stdout.write('123456789')"],
      }),
    ).rejects.toThrow('output exceeded');
  });
});
