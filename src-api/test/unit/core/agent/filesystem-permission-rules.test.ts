import { describe, expect, it } from 'vitest';

import {
  evaluateFilesystemPermission,
  filterPermittedFilesystemPaths,
} from '@/core/agent/permission-rules';

const workspaceRoot = '/workspace/project';

describe('filesystem permission rules', () => {
  it('uses first-match-wins rules inside the workspace', () => {
    const result = evaluateFilesystemPermission({
      workspaceRoot,
      targetPath: '/workspace/project/secrets/token.txt',
      operation: 'read',
      rules: [
        { pattern: 'secrets/**', effect: 'deny' },
        { pattern: '**/*.txt', effect: 'allow' },
      ],
    });

    expect(result.allowed).toBe(false);
    expect(result.matchedRule?.pattern).toBe('secrets/**');
  });

  it('applies operation filters', () => {
    expect(
      evaluateFilesystemPermission({
        workspaceRoot,
        targetPath: '/workspace/project/generated/report.md',
        operation: 'read',
        rules: [{ pattern: 'generated/**', effect: 'deny', ops: ['write'] }],
      }).allowed,
    ).toBe(true);

    expect(
      evaluateFilesystemPermission({
        workspaceRoot,
        targetPath: '/workspace/project/generated/report.md',
        operation: 'write',
        rules: [{ pattern: 'generated/**', effect: 'deny', ops: ['write'] }],
      }).allowed,
    ).toBe(false);
  });

  it('denies paths outside the workspace boundary', () => {
    const result = evaluateFilesystemPermission({
      workspaceRoot,
      targetPath: '/workspace/project-other/readme.md',
      operation: 'read',
      rules: [],
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/outside/);
  });

  it('post-filters forbidden paths', () => {
    const allowed = filterPermittedFilesystemPaths(
      [
        '/workspace/project/src/index.ts',
        '/workspace/project/.env',
        '/workspace/project/secrets/token.txt',
      ],
      {
        workspaceRoot,
        operation: 'grep',
        rules: [
          { pattern: '.env', effect: 'deny' },
          { pattern: 'secrets/**', effect: 'deny' },
        ],
      },
    );

    expect(allowed).toEqual(['/workspace/project/src/index.ts']);
  });
});
