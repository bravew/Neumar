import { EventEmitter } from 'node:events';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const spawn = vi.fn();
const execFile = vi.fn();

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawn(...args),
  execFile: (...args: unknown[]) => execFile(...args),
}));

function fakeChild(emitSpawn = true, emitError?: Error) {
  const child = new EventEmitter() as EventEmitter & { unref: () => void };
  child.unref = vi.fn();
  queueMicrotask(() => {
    if (emitError) {
      child.emit('error', emitError);
    } else if (emitSpawn) {
      child.emit('spawn');
    }
  });
  return child;
}

describe('editorLaunchEnv', () => {
  it('strips Electron, VS Code, and Cursor IPC variables', async () => {
    const { editorLaunchEnv } = await import('@/shared/utils/launch-editor');
    const env = editorLaunchEnv({
      PATH: '/usr/bin',
      HOME: '/home/user',
      ELECTRON_RUN_AS_NODE: '1',
      ELECTRON_NO_ASAR: '1',
      VSCODE_IPC_HOOK: '/tmp/vscode.sock',
      VSCODE_IPC_HOOK_CLI: '/tmp/vscode-cli.sock',
      VSCODE_PID: '123',
      CURSOR_TRACE_ID: 'abc',
      KEEP_ME: 'yes',
    });
    expect(env.PATH).toBe('/usr/bin');
    expect(env.HOME).toBe('/home/user');
    expect(env.KEEP_ME).toBe('yes');
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(env.ELECTRON_NO_ASAR).toBeUndefined();
    expect(env.VSCODE_IPC_HOOK).toBeUndefined();
    expect(env.VSCODE_IPC_HOOK_CLI).toBeUndefined();
    expect(env.VSCODE_PID).toBeUndefined();
    expect(env.CURSOR_TRACE_ID).toBeUndefined();
  });
});

describe('resolveEditorLaunch', () => {
  it('uses Launch Services on macOS for Cursor so the CLI shim is skipped', async () => {
    const { resolveEditorLaunch } =
      await import('@/shared/utils/launch-editor');
    expect(resolveEditorLaunch('cursor', '/tmp/proj', 'darwin')).toEqual({
      command: 'open',
      args: ['-a', 'Cursor', '/tmp/proj'],
    });
    expect(resolveEditorLaunch('code', '/tmp/file.ts', 'darwin')).toEqual({
      command: 'open',
      args: ['-a', 'Visual Studio Code', '/tmp/file.ts'],
    });
  });

  it('uses the CLI with a Windows shell for .cmd shims', async () => {
    const { resolveEditorLaunch } =
      await import('@/shared/utils/launch-editor');
    expect(resolveEditorLaunch('cursor', 'C:\\proj', 'win32')).toEqual({
      command: 'cursor',
      args: ['C:\\proj'],
      shell: true,
    });
  });

  it('passes the path as argv on Linux', async () => {
    const { resolveEditorLaunch } =
      await import('@/shared/utils/launch-editor');
    expect(resolveEditorLaunch('cursor', '/tmp/proj', 'linux')).toEqual({
      command: 'cursor',
      args: ['/tmp/proj'],
    });
  });
});

describe('launchDetached', () => {
  beforeEach(() => {
    spawn.mockReset();
    spawn.mockImplementation(() => fakeChild());
  });

  it('spawns detached with ignored stdio and a sanitized env', async () => {
    const { launchDetached } = await import('@/shared/utils/launch-editor');
    vi.stubEnv('ELECTRON_RUN_AS_NODE', '1');
    vi.stubEnv('VSCODE_IPC_HOOK', '/tmp/hook');
    vi.stubEnv('KEEP_EDITOR_TEST', '1');

    await launchDetached('cursor', ['/tmp/proj']);

    expect(spawn).toHaveBeenCalledTimes(1);
    const [command, args, options] = spawn.mock.calls[0] as [
      string,
      string[],
      {
        detached: boolean;
        stdio: string;
        env: NodeJS.ProcessEnv;
        shell: boolean;
      },
    ];
    expect(command).toBe('cursor');
    expect(args).toEqual(['/tmp/proj']);
    expect(options.detached).toBe(true);
    expect(options.stdio).toBe('ignore');
    expect(options.shell).toBe(false);
    expect(options.env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(options.env.VSCODE_IPC_HOOK).toBeUndefined();
    expect(options.env.KEEP_EDITOR_TEST).toBe('1');
  });

  it('rejects when spawn fails', async () => {
    spawn.mockImplementation(() =>
      fakeChild(false, Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
    );
    const { launchDetached } = await import('@/shared/utils/launch-editor');
    await expect(launchDetached('missing-editor', ['/tmp/x'])).rejects.toThrow(
      /ENOENT/,
    );
  });
});

describe('openPathInEditor', () => {
  beforeEach(() => {
    spawn.mockReset();
    spawn.mockImplementation(() => fakeChild());
  });

  it('opens Cursor via open -a on macOS', async () => {
    const { openPathInEditor, resolveEditorLaunch } =
      await import('@/shared/utils/launch-editor');
    const spec = resolveEditorLaunch('cursor', '/tmp/proj', 'darwin');
    if (process.platform === 'darwin') {
      await openPathInEditor('cursor', '/tmp/proj');
      expect(spawn.mock.calls[0]?.[0]).toBe('open');
      expect(spawn.mock.calls[0]?.[1]).toEqual(['-a', 'Cursor', '/tmp/proj']);
    } else {
      expect(spec).toEqual({
        command: 'open',
        args: ['-a', 'Cursor', '/tmp/proj'],
      });
    }
  });
});
