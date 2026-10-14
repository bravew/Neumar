import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { jsonReq } from '../../helpers/request-factory';

// ---- Mock heavy dependencies ----

vi.mock('path', async (importOriginal) => {
  const actual = await importOriginal<typeof import('path')>();
  return {
    ...actual,
    resolve: (...parts: string[]) =>
      process.platform === 'win32'
        ? actual.win32.resolve('C:\\workspace', ...parts)
        : actual.resolve(...parts),
  };
});

function resolvedPath(input: string): string {
  return process.platform === 'win32'
    ? path.win32.resolve('C:\\workspace', input)
    : path.resolve(input);
}

vi.mock('@/shared/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const mockGetSetting = vi.fn().mockReturnValue('/tmp/test-workspace');
const mockCreateFileSnapshot = vi.fn().mockReturnValue({
  id: 'snap-001',
  task_id: 'task-1',
  file_path: '/tmp/test.txt',
  content_before: 'old content',
});
const mockGetFileSnapshotsByTask = vi.fn().mockReturnValue([]);
const mockGetFileSnapshot = vi.fn();
const mockUpdateFileSnapshotAfter = vi.fn();
const mockCountFileSnapshotsByTask = vi.fn().mockReturnValue(0);
const mockGetTask = vi.fn();
const mockGetMessagesByTaskId = vi.fn().mockReturnValue([]);

vi.mock('@/shared/db/operations', () => ({
  getSetting: (...args: unknown[]) => mockGetSetting(...args),
  createFileSnapshot: (...args: unknown[]) => mockCreateFileSnapshot(...args),
  getFileSnapshotsByTask: (...args: unknown[]) =>
    mockGetFileSnapshotsByTask(...args),
  getFileSnapshot: (...args: unknown[]) => mockGetFileSnapshot(...args),
  updateFileSnapshotAfter: (...args: unknown[]) =>
    mockUpdateFileSnapshotAfter(...args),
  countFileSnapshotsByTask: (...args: unknown[]) =>
    mockCountFileSnapshotsByTask(...args),
  getTask: (...args: unknown[]) => mockGetTask(...args),
  getMessagesByTaskId: (...args: unknown[]) => mockGetMessagesByTaskId(...args),
}));

const mockStat = vi.fn().mockResolvedValue({
  isFile: () => true,
  isDirectory: () => false,
  size: 100,
  mtimeMs: Date.now(),
  mtime: new Date(),
});
const mockReadFile = vi.fn().mockResolvedValue(Buffer.from('test content'));
const mockReaddir = vi.fn().mockResolvedValue([]);
const mockRm = vi.fn().mockResolvedValue(undefined);
const mockWriteFile = vi.fn().mockResolvedValue(undefined);
const mockMkdir = vi.fn().mockResolvedValue(undefined);
const mockCp = vi.fn().mockResolvedValue(undefined);
const mockRename = vi.fn().mockResolvedValue(undefined);
const mockAccess = vi.fn().mockResolvedValue(undefined);

vi.mock('fs/promises', () => ({
  default: {
    stat: (...args: unknown[]) => mockStat(...args),
    readFile: (...args: unknown[]) => mockReadFile(...args),
    readdir: (...args: unknown[]) => mockReaddir(...args),
    rm: (...args: unknown[]) => mockRm(...args),
    writeFile: (...args: unknown[]) => mockWriteFile(...args),
    mkdir: (...args: unknown[]) => mockMkdir(...args),
    cp: (...args: unknown[]) => mockCp(...args),
    rename: (...args: unknown[]) => mockRename(...args),
    access: (...args: unknown[]) => mockAccess(...args),
  },
  stat: (...args: unknown[]) => mockStat(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
  readdir: (...args: unknown[]) => mockReaddir(...args),
  rm: (...args: unknown[]) => mockRm(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  cp: (...args: unknown[]) => mockCp(...args),
  rename: (...args: unknown[]) => mockRename(...args),
  access: (...args: unknown[]) => mockAccess(...args),
}));

// Partial: the route's containment check calls `lstatSync` and `realpathSync`
// through the `fs` specifier, which this mock also replaces. Dropping them
// would make every containment check fail closed and hide the behavior under
// test, so the real implementations stay.
vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  createReadStream: vi.fn(),
  statSync: vi.fn().mockReturnValue({
    isFile: () => true,
    isDirectory: () => false,
    size: 100,
  }),
}));

/**
 * Containment is decided by resolving real paths. The block below simulates
 * win32 by rewriting `process.platform` and building `C:\workspace\...`
 * strings, but the filesystem underneath is the host's, so those paths cannot
 * be resolved and every request would be refused before the argv under test is
 * built.
 *
 * This seam exists only for that block: it is enabled in the win32
 * `beforeEach` and cleared in its `afterEach`, and it is never enabled for the
 * darwin or linux blocks, which use real `/tmp` paths. Containment itself is
 * covered against a real tree in `test/unit/security/path-containment.test.ts`.
 */
const simulatedPlatform = vi.hoisted(() => ({ active: false }));

vi.mock('@/shared/utils/path-validator', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/shared/utils/path-validator')>();
  return {
    ...actual,
    isPathInsideAnyRoot: (roots: readonly string[], target: string) =>
      simulatedPlatform.active || actual.isPathInsideAnyRoot(roots, target),
    isPathInsideRoot: (root: string, target: string) =>
      simulatedPlatform.active || actual.isPathInsideRoot(root, target),
  };
});

const { mockExec, mockExecFile } = vi.hoisted(() => ({
  mockExec: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
  mockExecFile: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
}));

vi.mock('child_process', () => ({
  exec: Object.assign(vi.fn(), {
    [Symbol.for('nodejs.util.promisify.custom')]: mockExec,
  }),
  execFile: Object.assign(vi.fn(), {
    [Symbol.for('nodejs.util.promisify.custom')]: mockExecFile,
  }),
}));

vi.mock('@/config/constants', () => ({
  APP_DIR_NAME: 'neuma-test',
  getAllSkillsDirs: vi.fn().mockReturnValue([
    { name: 'app', path: '/tmp/skills' },
    { name: 'claude', path: '/tmp/.claude/skills' },
  ]),
  getBundledSkillsDir: vi.fn().mockReturnValue('/tmp/bundled-skills'),
  getClaudeSkillsDir: vi.fn().mockReturnValue('/tmp/.claude/skills'),
  getAppDir: vi.fn().mockReturnValue('/tmp/neuma-test'),
  getHomeDir: vi.fn().mockReturnValue('/tmp'),
}));

vi.mock('@/shared/services/ffmpeg', () => ({
  detectBinaries: vi.fn().mockResolvedValue({ ffmpeg: null, ffprobe: null }),
}));

vi.mock('@/shared/skills/loader', () => ({
  loadSkillFromDir: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/shared/utils/paths', () => ({
  expandPath: (p: string) => p,
}));

vi.mock('@/shared/utils/url-validator', () => ({
  safeFetch: vi.fn(),
  validateBaseUrl: vi.fn().mockReturnValue({ valid: true }),
  validateBaseUrlForFetch: vi.fn().mockResolvedValue({ valid: true }),
}));

// ============================================================================
// POST /readdir
// ============================================================================

describe('Files API', () => {
  describe('POST /readdir', () => {
    it('returns files for a valid directory', async () => {
      mockStat.mockResolvedValueOnce({
        isFile: () => false,
        isDirectory: () => true,
        size: 0,
        mtime: new Date(),
      });
      mockReaddir.mockResolvedValueOnce([]);

      const { filesRoutes } = await import('@/app/api/files');
      const res = await filesRoutes.request(
        jsonReq('/readdir', { path: '/tmp' }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('success', true);
      expect(body).toHaveProperty('files');
      expect(Array.isArray(body.files)).toBe(true);
    });

    it('rejects empty path', async () => {
      const { filesRoutes } = await import('@/app/api/files');
      const res = await filesRoutes.request(jsonReq('/readdir', { path: '' }));
      expect(res.status).toBe(400);
    });
  });

  // ============================================================================
  // POST /stat
  // ============================================================================

  describe('POST /stat', () => {
    it('returns stat info for an existing path', async () => {
      mockStat.mockResolvedValueOnce({
        isFile: () => true,
        isDirectory: () => false,
        size: 256,
        mtime: new Date('2026-01-01'),
      });

      const { filesRoutes } = await import('@/app/api/files');
      const res = await filesRoutes.request(
        jsonReq('/stat', { path: '/tmp/test.txt' }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('exists', true);
      expect(body).toHaveProperty('isFile', true);
    });

    it('returns exists=false for non-existent path', async () => {
      mockStat.mockRejectedValueOnce(new Error('ENOENT'));

      const { filesRoutes } = await import('@/app/api/files');
      const res = await filesRoutes.request(
        jsonReq('/stat', { path: '/tmp/no-such-file.txt' }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('exists', false);
    });

    it('rejects missing path', async () => {
      const { filesRoutes } = await import('@/app/api/files');
      const res = await filesRoutes.request(jsonReq('/stat', {}));
      expect(res.status).toBe(400);
    });
  });

  // ============================================================================
  // POST /read
  // ============================================================================

  describe('POST /read', () => {
    it('reads file content', async () => {
      mockReadFile.mockResolvedValueOnce('hello world');

      const { filesRoutes } = await import('@/app/api/files');
      const res = await filesRoutes.request(
        jsonReq('/read', { path: '/tmp/test.txt' }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('success', true);
      expect(body).toHaveProperty('content', 'hello world');
    });

    it('rejects missing path', async () => {
      const { filesRoutes } = await import('@/app/api/files');
      const res = await filesRoutes.request(jsonReq('/read', {}));
      expect(res.status).toBe(400);
    });
  });

  // ============================================================================
  // GET /skills-dir
  // ============================================================================

  describe('GET /skills-dir', () => {
    it('returns skills directories', async () => {
      mockStat.mockResolvedValueOnce({
        isFile: () => false,
        isDirectory: () => true,
        size: 0,
        mtime: new Date(),
      });
      // Second dir: not found
      mockStat.mockRejectedValueOnce(new Error('ENOENT'));

      const { filesRoutes } = await import('@/app/api/files');
      const res = await filesRoutes.request('/skills-dir');
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('exists');
      expect(body).toHaveProperty('path');
    });
  });

  // ============================================================================
  // GET /list-skills
  // ============================================================================

  describe('GET /list-skills', () => {
    it('returns empty skills array when none installed', async () => {
      mockReaddir.mockRejectedValueOnce(new Error('ENOENT'));
      mockReaddir.mockRejectedValueOnce(new Error('ENOENT'));

      const { filesRoutes } = await import('@/app/api/files');
      const res = await filesRoutes.request('/list-skills');
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('success', true);
      expect(body).toHaveProperty('skills');
      expect(Array.isArray(body.skills)).toBe(true);
    });
  });

  // ============================================================================
  // GET /detect-editor
  // ============================================================================

  describe('shell-free file opening', () => {
    beforeEach(() => {
      mockExec.mockClear();
      mockExecFile.mockReset();
      mockStat.mockResolvedValue({ isDirectory: () => false });
      mockAccess.mockResolvedValue(undefined);
    });

    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
    });

    const names = [
      '"; touch pwned; "',
      '`touch pwned`',
      '$(touch pwned)',
      '-leading dash with spaces.txt',
      'résumé 中文 & %PATH% ! ^.txt',
    ];

    for (const platform of ['darwin', 'linux', 'win32'] as const) {
      describe(platform, () => {
        beforeEach(() => {
          vi.spyOn(process, 'platform', 'get').mockReturnValue(platform);
          // Exercise Windows path rules on any host without touching its filesystem.
          if (platform === 'win32') {
            mockGetSetting.mockReturnValue('C:\\workspace');
            vi.stubEnv('SystemRoot', 'C:\\Windows');
            simulatedPlatform.active = true;
          }
          mockExecFile.mockImplementation(async (binary: string) => {
            if (binary === 'which' || binary.endsWith('where.exe')) {
              throw new Error('Editor not installed');
            }
            return { stdout: '', stderr: '' };
          });
        });

        afterEach(() => {
          simulatedPlatform.active = false;
          mockGetSetting.mockReturnValue('/tmp/test-workspace');
        });

        for (const route of ['/open', '/open-in-editor']) {
          it.each(names)(
            `${route} passes literal filename %s`,
            async (name) => {
              const input =
                platform === 'win32'
                  ? `C:\\workspace\\${name}`
                  : `/tmp/${name}`;
              const resolved = resolvedPath(input);
              const { filesRoutes } = await import('@/app/api/files');
              const res = await filesRoutes.request(
                jsonReq(route, { path: input }),
              );
              expect(res.status).toBe(200);
              expect(mockExec).not.toHaveBeenCalled();
              const call = mockExecFile.mock.calls.at(-1);
              if (platform === 'win32') {
                expect(call).toEqual([
                  'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
                  [
                    '-NoLogo',
                    '-NoProfile',
                    '-NonInteractive',
                    '-Command',
                    '$ErrorActionPreference = "Stop"; Invoke-Item -LiteralPath $env:NEUMAR_OPEN_PATH',
                  ],
                  expect.objectContaining({
                    shell: false,
                    env: expect.objectContaining({
                      NEUMAR_OPEN_PATH: resolved,
                    }),
                  }),
                ]);
              } else {
                expect(call).toEqual([
                  platform === 'darwin' ? 'open' : 'xdg-open',
                  platform === 'darwin'
                    ? [
                        ...(route === '/open-in-editor' ? ['-t'] : []),
                        '--',
                        resolved,
                      ]
                    : [resolved],
                  { shell: false },
                ]);
              }
            },
          );
        }

        it('opens a leading-dash relative path as an absolute operand', async () => {
          if (platform !== 'win32')
            mockGetSetting.mockReturnValue(process.cwd());
          const { filesRoutes } = await import('@/app/api/files');
          const res = await filesRoutes.request(
            jsonReq('/open', { path: '-file.txt' }),
          );
          expect(res.status).toBe(200);
          expect(mockExec).not.toHaveBeenCalled();
          const call = mockExecFile.mock.calls.at(-1);
          expect(
            platform === 'win32'
              ? call?.[2].env.NEUMAR_OPEN_PATH
              : call?.[1].at(-1),
          ).toBe(resolvedPath('-file.txt'));
        });

        it('opens directories without a shell', async () => {
          mockStat.mockResolvedValue({ isDirectory: () => true });
          const { filesRoutes } = await import('@/app/api/files');
          const res = await filesRoutes.request(
            jsonReq('/open', {
              path:
                platform === 'win32'
                  ? 'C:\\workspace\\folder & name'
                  : '/tmp/folder & name',
            }),
          );
          expect(res.status).toBe(200);
          expect(mockExec).not.toHaveBeenCalled();
          expect(mockExecFile.mock.calls.at(-1)?.[2].shell).toBe(false);
        });

        it('discovers editors using a fixed executable and arguments', async () => {
          mockExecFile.mockResolvedValue({
            stdout:
              platform === 'win32'
                ? 'C:\\Apps\\Cursor\\bin\\cursor.cmd\r\n'
                : '/usr/bin/cursor\n',
            stderr: '',
          });
          const { filesRoutes } = await import('@/app/api/files');
          const res = await filesRoutes.request('/detect-editor');
          expect(await res.json()).toMatchObject({
            editor: 'Cursor',
            command: 'cursor',
          });
          expect(mockExec).not.toHaveBeenCalled();
          expect(mockExecFile.mock.calls[0]).toEqual([
            platform === 'win32' ? 'C:\\Windows\\System32\\where.exe' : 'which',
            ['cursor'],
            { shell: false },
          ]);
        });

        it('opens in a discovered editor without executing a Windows cmd shim', async () => {
          mockExecFile.mockResolvedValue({
            stdout:
              platform === 'win32'
                ? 'C:\\Apps\\Cursor\\bin\\cursor.cmd\r\n'
                : '/usr/bin/cursor\n',
            stderr: '',
          });
          const input =
            platform === 'win32'
              ? 'C:\\workspace\\file & %PATH%.txt'
              : '/tmp/file $(touch pwned).txt';
          const { filesRoutes } = await import('@/app/api/files');
          const res = await filesRoutes.request(
            jsonReq('/open-in-editor', { path: input }),
          );
          expect(await res.json()).toMatchObject({
            success: true,
            editor: 'Cursor',
          });
          expect(mockExec).not.toHaveBeenCalled();
          expect(mockExecFile.mock.calls.at(-1)).toEqual([
            platform === 'win32'
              ? 'C:\\Apps\\Cursor\\Cursor.exe'
              : '/usr/bin/cursor',
            ['--', resolvedPath(input)],
            { shell: false },
          ]);
        });

        it('returns 500 if the opener fails', async () => {
          mockExecFile.mockRejectedValue(new Error('Launch failed'));
          mockExec.mockRejectedValueOnce(new Error('Launch failed'));
          const { filesRoutes } = await import('@/app/api/files');
          const res = await filesRoutes.request(
            jsonReq('/open', {
              path:
                platform === 'win32'
                  ? 'C:\\workspace\\file.txt'
                  : '/tmp/file.txt',
            }),
          );
          expect(res.status).toBe(500);
          expect(await res.json()).toMatchObject({ success: false });
        });
      });
    }

    it('rejects missing, denied and nonexistent paths before launching', async () => {
      const { filesRoutes } = await import('@/app/api/files');
      for (const route of ['/open', '/open-in-editor']) {
        expect((await filesRoutes.request(jsonReq(route, {}))).status).toBe(
          400,
        );
        expect(
          (await filesRoutes.request(jsonReq(route, { path: '/etc/secret' })))
            .status,
        ).toBe(403);
        mockStat.mockRejectedValueOnce(new Error('ENOENT'));
        expect(
          (await filesRoutes.request(jsonReq(route, { path: '/tmp/missing' })))
            .status,
        ).toBe(404);
      }
      expect(mockExec).not.toHaveBeenCalled();
      expect(mockExecFile).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // POST /snapshot
  // ============================================================================

  describe('POST /snapshot', () => {
    it('creates a before snapshot', async () => {
      mockStat.mockResolvedValueOnce({
        isFile: () => true,
        isDirectory: () => false,
        size: 50,
        mtime: new Date(),
      });
      mockReadFile.mockResolvedValueOnce('file content before');
      mockCreateFileSnapshot.mockReturnValueOnce({ id: 'snap-new' });

      const { filesRoutes } = await import('@/app/api/files');
      const res = await filesRoutes.request(
        jsonReq('/snapshot', {
          task_id: 'task-1',
          file_path: '/tmp/test.txt',
          phase: 'before',
        }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('snapshot_id', 'snap-new');
    });

    it('captures after snapshot', async () => {
      mockStat.mockResolvedValueOnce({
        isFile: () => true,
        isDirectory: () => false,
        size: 50,
        mtime: new Date(),
      });
      mockReadFile.mockResolvedValueOnce('file content after');

      const { filesRoutes } = await import('@/app/api/files');
      const res = await filesRoutes.request(
        jsonReq('/snapshot', {
          task_id: 'task-1',
          file_path: '/tmp/test.txt',
          phase: 'after',
          snapshot_id: 'snap-001',
        }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('success', true);
    });

    it('rejects invalid phase (missing required fields)', async () => {
      const { filesRoutes } = await import('@/app/api/files');
      const res = await filesRoutes.request(
        jsonReq('/snapshot', {
          task_id: 'task-1',
          file_path: '/tmp/test.txt',
        }),
      );
      // Zod validation fails
      expect(res.status).toBe(400);
    });
  });

  // ============================================================================
  // GET /snapshots/:taskId
  // ============================================================================

  describe('GET /snapshots/:taskId', () => {
    it('returns snapshots for a task', async () => {
      mockGetFileSnapshotsByTask.mockReturnValueOnce([
        {
          id: 'snap-1',
          file_path: '/tmp/a.txt',
          content_before: 'old',
          content_after: 'new',
          created_at: '2026-01-01',
        },
      ]);

      const { filesRoutes } = await import('@/app/api/files');
      const res = await filesRoutes.request('/snapshots/task-1');
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('snapshots');
      const snapshots = body.snapshots as unknown[];
      expect(snapshots.length).toBe(1);
    });

    it('returns empty array for task with no snapshots', async () => {
      mockGetFileSnapshotsByTask.mockReturnValueOnce([]);

      const { filesRoutes } = await import('@/app/api/files');
      const res = await filesRoutes.request('/snapshots/task-no-snaps');
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('snapshots');
      const snapshots = body.snapshots as unknown[];
      expect(snapshots.length).toBe(0);
    });
  });

  // ============================================================================
  // GET /proxy-download (SSRF validation)
  // ============================================================================

  describe('GET /proxy-download', () => {
    it('blocks private IP URLs', async () => {
      const { validateBaseUrlForFetch } =
        await import('@/shared/utils/url-validator');
      vi.mocked(validateBaseUrlForFetch).mockResolvedValueOnce({
        valid: false,
        reason: 'Private IP',
      });

      const { filesRoutes } = await import('@/app/api/files');
      const res = await filesRoutes.request(
        '/proxy-download?url=http://192.168.1.1/secret',
      );
      expect(res.status).toBe(400);
    });

    it('rejects missing url parameter', async () => {
      const { filesRoutes } = await import('@/app/api/files');
      const res = await filesRoutes.request('/proxy-download');
      expect(res.status).toBe(400);
    });

    it('rejects invalid url format', async () => {
      const { filesRoutes } = await import('@/app/api/files');
      const res = await filesRoutes.request('/proxy-download?url=not-a-url');
      expect(res.status).toBe(400);
    });
  });
});
