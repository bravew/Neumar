import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  canAttachLocalPaths,
  checkLocalFile,
  normalizePathInput,
  parsePastedPaths,
} from '@/shared/lib/local-path';
import { isTauriRuntime } from '@/shared/utils/tauri';

vi.mock('@/config', () => ({ API_BASE_URL: 'http://localhost:5126' }));
vi.mock('@/shared/utils/tauri', () => ({ isTauriRuntime: vi.fn() }));

beforeEach(() => {
  vi.mocked(isTauriRuntime).mockReturnValue(false);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('normalizePathInput', () => {
  it.each([
    ['/Users/me/Movies/clip.mp4', '/Users/me/Movies/clip.mp4'],
    ['  "/Users/me/My Movies/clip.mp4"  ', '/Users/me/My Movies/clip.mp4'],
    ["'/Users/me/clip.mp4'", '/Users/me/clip.mp4'],
    ['/Users/me/My\\ Movies/clip.mp4', '/Users/me/My Movies/clip.mp4'],
    ['file:///Users/me/My%20Movies/clip.mp4', '/Users/me/My Movies/clip.mp4'],
    ['file:///C:/Videos/clip.mp4', 'C:/Videos/clip.mp4'],
    ['~/Movies/clip.mp4', '~/Movies/clip.mp4'],
    ['C:\\Videos\\clip.mp4', 'C:\\Videos\\clip.mp4'],
    [
      '/Users/me/2025排球俱乐部颁奖典礼.mp4',
      '/Users/me/2025排球俱乐部颁奖典礼.mp4',
    ],
  ])('accepts %s', (input, expected) => {
    expect(normalizePathInput(input)).toBe(expected);
  });

  it.each([
    ['/help', 'a slash command'],
    ['/clear', 'a slash command'],
    ['clip.mp4', 'a bare file name'],
    ['./clip.mp4', 'a relative path'],
    ['transcode /Users/me/clip.mp4 to mov', 'prose that contains a path'],
    ['https://example.com/a/b.mp4', 'a URL'],
    ['', 'empty text'],
    ['/Users/me/a\tb.mp4', 'a tab-separated line'],
  ])('rejects %s (%s)', (input) => {
    expect(normalizePathInput(input)).toBeNull();
  });
});

describe('parsePastedPaths', () => {
  it('returns every line when the whole paste is paths', () => {
    expect(
      parsePastedPaths('/Users/me/a.mp4\r\n\n"/Users/me/b c.mp4"\n'),
    ).toEqual(['/Users/me/a.mp4', '/Users/me/b c.mp4']);
  });

  it('returns null when any line is prose so ordinary text is never captured', () => {
    expect(parsePastedPaths('/Users/me/a.mp4\nconvert this')).toBeNull();
    expect(parsePastedPaths('   \n')).toBeNull();
  });

  it('returns null for an unreasonable number of lines', () => {
    const many = Array.from({ length: 21 }, (_, i) => `/Users/me/${i}.mp4`);
    expect(parsePastedPaths(many.join('\n'))).toBeNull();
  });
});

describe('canAttachLocalPaths', () => {
  it('is true on a loopback page', () => {
    expect(canAttachLocalPaths()).toBe(true);
  });

  it('is false when the page is served from another machine', () => {
    vi.spyOn(window, 'location', 'get').mockReturnValue({
      hostname: 'workstation.lan',
    } as Location);
    expect(canAttachLocalPaths()).toBe(false);
  });

  it('is true in the desktop shell regardless of hostname', () => {
    vi.mocked(isTauriRuntime).mockReturnValue(true);
    vi.spyOn(window, 'location', 'get').mockReturnValue({
      hostname: 'tauri.localhost.example',
    } as Location);
    expect(canAttachLocalPaths()).toBe(true);
  });
});

describe('checkLocalFile', () => {
  function stubStat(body: unknown, ok = true) {
    const fetchMock = vi.fn().mockResolvedValue({
      ok,
      json: () => Promise.resolve(body),
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('returns the server-resolved path and size for a readable file', async () => {
    const fetchMock = stubStat({
      exists: true,
      isFile: true,
      resolvedPath: '/Users/me/Movies/clip.mp4',
      size: 5_000_000_000,
    });

    await expect(checkLocalFile('~/Movies/clip.mp4')).resolves.toEqual({
      ok: true,
      path: '/Users/me/Movies/clip.mp4',
      size: 5_000_000_000,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:5126/files/stat',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ path: '~/Movies/clip.mp4' }),
      }),
    );
  });

  it.each([
    [{ exists: false }, 'not_found'],
    [{ exists: false, denied: true }, 'denied'],
    [{ exists: true, isFile: false, isDirectory: true }, 'not_file'],
  ])('maps %j to %s', async (body, reason) => {
    stubStat(body);
    await expect(checkLocalFile('/Users/me/x')).resolves.toEqual({
      ok: false,
      reason,
    });
  });

  it('reports an unreachable API for a failed response or a network error', async () => {
    stubStat({}, false);
    await expect(checkLocalFile('/Users/me/x')).resolves.toEqual({
      ok: false,
      reason: 'unreachable',
    });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(checkLocalFile('/Users/me/x')).resolves.toEqual({
      ok: false,
      reason: 'unreachable',
    });
  });
});
