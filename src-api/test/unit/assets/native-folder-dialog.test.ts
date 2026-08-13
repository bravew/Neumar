import { describe, expect, it, vi } from 'vitest';

import {
  buildFolderDialogCommand,
  openNativeFolderDialog,
  parseFolderDialogResult,
} from '@/shared/assets/native-folder-dialog';

describe('buildFolderDialogCommand', () => {
  it('uses osascript choose-folder on macOS', () => {
    const command = buildFolderDialogCommand('darwin');
    expect(command?.command).toBe('osascript');
    expect(command?.args.join(' ')).toContain('choose folder with prompt');
  });

  it('uses zenity directory selection on Linux', () => {
    const command = buildFolderDialogCommand('linux');
    expect(command?.command).toBe('zenity');
    expect(command?.args).toContain('--directory');
  });

  it('uses a PowerShell FolderBrowserDialog on Windows', () => {
    const command = buildFolderDialogCommand('win32');
    expect(command?.command).toBe('powershell.exe');
    expect(command?.args.join(' ')).toContain('FolderBrowserDialog');
  });

  it('returns null for an unsupported platform', () => {
    expect(buildFolderDialogCommand('aix')).toBeNull();
  });
});

describe('parseFolderDialogResult', () => {
  it('returns the trimmed path with trailing separators stripped', () => {
    expect(parseFolderDialogResult(null, '/Users/me/Footage/\n')).toBe(
      '/Users/me/Footage',
    );
  });

  it('treats a non-zero exit (user cancel) as no selection', () => {
    expect(parseFolderDialogResult(new Error('cancelled'), '')).toBeNull();
  });

  it('returns null for empty stdout', () => {
    expect(parseFolderDialogResult(null, '   \n')).toBeNull();
  });
});

describe('openNativeFolderDialog', () => {
  it('returns the chosen path on success', async () => {
    const exec = vi.fn(async () => ({
      error: null,
      stdout: '/Users/me/Clips\n',
    }));
    const result = await openNativeFolderDialog({ platform: 'darwin', exec });
    expect(exec).toHaveBeenCalledOnce();
    expect(result).toEqual({ supported: true, path: '/Users/me/Clips' });
  });

  it('reports a cancelled dialog as supported with no path', async () => {
    // A user cancel exits non-zero with no ENOENT — still a supported dialog.
    const exec = vi.fn(async () => ({
      error: new Error('cancelled'),
      stdout: '',
    }));
    const result = await openNativeFolderDialog({ platform: 'linux', exec });
    expect(result).toEqual({ supported: true, path: null });
  });

  it('reports a missing dialog binary as unsupported (fall back to manual)', async () => {
    const error: NodeJS.ErrnoException = Object.assign(new Error('not found'), {
      code: 'ENOENT',
    });
    const exec = vi.fn(async () => ({ error, stdout: '' }));
    const result = await openNativeFolderDialog({ platform: 'linux', exec });
    expect(result).toEqual({ supported: false, path: null });
  });

  it('never spawns on an unsupported platform', async () => {
    const exec = vi.fn();
    const result = await openNativeFolderDialog({ platform: 'aix', exec });
    expect(exec).not.toHaveBeenCalled();
    expect(result).toEqual({ supported: false, path: null });
  });
});
