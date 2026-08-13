import { describe, expect, it, vi } from 'vitest';

// Resolve any project id to a fixed temp root so no real project is needed.
vi.mock('@/shared/services/design-mode/fs', () => ({
  getProjectDir: () => '/tmp/design-editors-test',
  resolveProjectPath: () => ({
    absolutePath: '/tmp/design-editors-test',
    relativePath: '.',
  }),
}));

describe('design editors hand-off', () => {
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
});
