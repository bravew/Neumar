import { beforeEach, describe, expect, it, vi } from 'vitest';

// Resolve any project id to a fixed temp root so no real project is needed.
vi.mock('@/shared/services/design-mode/fs', () => ({
  getProjectDir: () => '/tmp/design-editors-test',
  resolveProjectPath: () => ({
    absolutePath: '/tmp/design-editors-test',
    relativePath: '.',
  }),
}));

const openPathInEditor = vi.fn().mockResolvedValue(undefined);
const launchDetached = vi.fn().mockResolvedValue(undefined);
const isEditorCommandAvailable = vi.fn().mockResolvedValue(true);
const macAppInstalled = vi.fn().mockReturnValue(false);

vi.mock('@/shared/utils/launch-editor', () => ({
  openPathInEditor: (...args: unknown[]) => openPathInEditor(...args),
  launchDetached: (...args: unknown[]) => launchDetached(...args),
  isEditorCommandAvailable: (...args: unknown[]) =>
    isEditorCommandAvailable(...args),
  macAppInstalled: (...args: unknown[]) => macAppInstalled(...args),
}));

describe('design editors hand-off', () => {
  beforeEach(() => {
    openPathInEditor.mockClear();
    launchDetached.mockClear();
    isEditorCommandAvailable.mockResolvedValue(true);
    macAppInstalled.mockReturnValue(false);
  });

  it('lists known editors plus the file manager', async () => {
    const { detectDesignEditors } =
      await import('@/shared/services/design-mode/editors');
    const editors = await detectDesignEditors();
    const ids = editors.map((e) => e.id);
    expect(ids).toEqual(
      expect.arrayContaining(['cursor', 'vscode', 'zed', 'reveal']),
    );
    // The file manager is always available.
    expect(editors.find((e) => e.id === 'reveal')?.available).toBe(true);
  });

  it('rejects an editor id outside the allow-list', async () => {
    const { openDesignProjectInEditor } =
      await import('@/shared/services/design-mode/editors');
    await expect(openDesignProjectInEditor('p1', 'rm -rf /')).rejects.toThrow(
      /unknown editor/i,
    );
    await expect(
      openDesignProjectInEditor('p1', '../../bin/sh'),
    ).rejects.toThrow(/unknown editor/i);
  });

  it('opens Cursor through the detached launcher, not exec()', async () => {
    const { openDesignProjectInEditor } =
      await import('@/shared/services/design-mode/editors');
    await openDesignProjectInEditor('p1', 'cursor');
    expect(openPathInEditor).toHaveBeenCalledWith(
      'cursor',
      '/tmp/design-editors-test',
    );
    expect(launchDetached).not.toHaveBeenCalled();
  });

  it('refuses an editor that is not installed', async () => {
    isEditorCommandAvailable.mockResolvedValue(false);
    const { openDesignProjectInEditor } =
      await import('@/shared/services/design-mode/editors');
    await expect(
      openDesignProjectInEditor('p1', 'cursor'),
    ).rejects.toMatchObject({ code: 'EDITOR_NOT_AVAILABLE' });
  });
});
