import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { StreamingCommandInput } from '@/shared/process/run-streaming-command';
import {
  HyperframesStudioBridge,
  HyperframesStudioError,
} from '@/shared/video/hyperframes-studio';

let projectDir: string;

beforeEach(async () => {
  projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hf-studio-'));
  await fs.writeFile(path.join(projectDir, 'index.html'), '<html></html>');
});

afterEach(async () => {
  await fs.rm(projectDir, { recursive: true, force: true });
});

describe('HyperframesStudioBridge', () => {
  it('reference-counts acquire/release and stops only the owned project', async () => {
    const run = vi.fn(async (input: StreamingCommandInput) => {
      const port = Number(input.args[input.args.indexOf('--port') + 1]);
      if (input.args.includes('--context')) {
        return {
          stdout: JSON.stringify({
            ok: true,
            server: {
              port,
              projectName: path.basename(projectDir),
              projectDir,
              url: `http://127.0.0.1:${port}`,
            },
          }),
          stderr: '',
        };
      }
      return {
        stdout: JSON.stringify({
          schemaVersion: 1,
          operation: input.args.includes('--stop') ? 'stop' : 'start',
          ok: true,
          result: {
            state: input.args.includes('--stop') ? 'stopped' : 'started',
            projectName: path.basename(projectDir),
            projectDir,
            host: '127.0.0.1',
            port,
            serverUrl: `http://127.0.0.1:${port}`,
            studioUrl: `http://127.0.0.1:${port}/#project/${path.basename(projectDir)}`,
          },
        }),
        stderr: '',
      };
    });
    const bridge = new HyperframesStudioBridge('hyperframes-test', run);
    const first = await bridge.acquire(projectDir, 'subscriber-1');
    const second = await bridge.acquire(projectDir, 'subscriber-2');
    expect(first.port).toBe(second.port);
    expect(second.subscribers).toBe(2);
    expect(await bridge.status(projectDir)).toMatchObject({
      port: first.port,
      subscribers: 2,
    });
    expect(await bridge.release(projectDir, 'subscriber-1')).toBe(false);
    expect(await bridge.release(projectDir, 'subscriber-1')).toBe(false);
    expect(await bridge.release(projectDir, 'subscriber-2')).toBe(true);
    expect(
      run.mock.calls.filter(([input]) => input.args.includes('--stop')),
    ).toHaveLength(1);
  });

  it('returns the stable hfId selection target and Studio hash URL', async () => {
    const run = vi.fn(async (input: StreamingCommandInput) => {
      const port = Number(input.args[input.args.indexOf('--port') + 1]);
      if (input.args.includes('--context')) {
        return {
          stdout: JSON.stringify({
            ok: true,
            server: {
              port,
              projectName: 'demo',
              projectDir,
              url: `http://127.0.0.1:${port}`,
            },
            selection: {
              sourceFile: 'index.html',
              currentTime: 1.5,
              target: { hfId: 'hero-title', selector: '#title' },
              label: 'Hero title',
            },
          }),
          stderr: '',
        };
      }
      return lifecycleResult(input, projectDir, port);
    });
    const bridge = new HyperframesStudioBridge('hyperframes-test', run);
    const session = await bridge.acquire(projectDir, 'subscriber-1');
    const selection = await bridge.getSelection(projectDir);
    expect(selection.stableTarget).toBe('hero-title');
    expect(selection.studioUrl).toBe(session.studioUrl);
    expect(selection.studioUrl).toContain('/#project/');
  });

  it('surfaces no-selection as a typed boundary error', async () => {
    const run = vi.fn(async (input: StreamingCommandInput) => {
      const port = Number(input.args[input.args.indexOf('--port') + 1]);
      if (input.args.includes('--context')) {
        return {
          stdout: JSON.stringify({
            ok: true,
            server: {
              port,
              projectName: 'demo',
              projectDir,
              url: `http://127.0.0.1:${port}`,
            },
            selection: null,
            errors: {
              selection: {
                code: 'no-selection',
                message: 'Select an element in Studio.',
              },
            },
          }),
          stderr: '',
        };
      }
      return lifecycleResult(input, projectDir, port);
    });
    const bridge = new HyperframesStudioBridge('hyperframes-test', run);
    await bridge.acquire(projectDir, 'subscriber-1');
    await expect(bridge.getSelection(projectDir)).rejects.toMatchObject({
      name: 'HyperframesStudioError',
      code: 'no-selection',
    } satisfies Partial<HyperframesStudioError>);
  });
});

function lifecycleResult(
  input: StreamingCommandInput,
  dir: string,
  port: number,
) {
  return Promise.resolve({
    stdout: JSON.stringify(
      input.args.includes('--context')
        ? {
            ok: true,
            server: {
              port,
              projectName: path.basename(dir),
              projectDir: dir,
              url: `http://127.0.0.1:${port}`,
            },
          }
        : {
            schemaVersion: 1,
            operation: 'start',
            ok: true,
            result: {
              state: 'started',
              projectName: path.basename(dir),
              projectDir: dir,
              host: '127.0.0.1',
              port,
              serverUrl: `http://127.0.0.1:${port}`,
              studioUrl: `http://127.0.0.1:${port}/#project/${path.basename(dir)}`,
            },
          },
    ),
    stderr: '',
  });
}
