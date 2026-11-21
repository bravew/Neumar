import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type {
  DownloadActivity,
  DownloadAsset,
  DownloadMediaOperation,
} from '@neumar/video-ir';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  downloadArgv,
  MAX_FILE_BYTES,
  runDownloadMedia,
} from '@/shared/services/media-download/runner';
import { directRuntime } from '@/shared/services/media-download/runtime';

/**
 * A stand-in for yt-dlp: it speaks the same stdout protocol (progress lines,
 * a postprocess marker, an after_move file line) and writes one file into the
 * stage folder. Failure modes are selected by the URL, not by argv, so the
 * runner's real argv is exercised unchanged.
 */
const FAKE_YTDLP = `#!/bin/sh
stage=""
while [ $# -gt 0 ]; do
  case "$1" in
    -P) stage="$2"; shift 2 ;;
    --) shift; url="$1"; shift ;;
    *) shift ;;
  esac
done
name="clip [abc].mp4"
case "$url" in
  *fail*) echo "ERROR: unable to download video data: HTTP Error 404" >&2; exit 1 ;;
  *slow*) sleep 5; exit 0 ;;
  *big*) echo 'NDPROGRESS:{"stream":"137","bytes":4096,"total":8192,"estimate":null,"speed":1024,"eta":4}'; name="big.mp4" ;;
esac
printf '%s\\n' 'NDPROGRESS:{"stream":"137","bytes":1024,"total":4096,"estimate":null,"speed":512,"eta":6}'
printf '%s\\n' 'NDPROGRESS:{"stream":"140","bytes":512,"total":1024,"estimate":null,"speed":256,"eta":2}'
printf '%s\\n' 'NDFINISH'
head -c 32 /dev/zero > "$stage/$name"
printf 'NDFILE:%s\\n' "$stage/$name"
`;

let home = '';
let granted = '';
let binary = '';

const operation = (
  urls: string[],
  overrides: Partial<DownloadMediaOperation> = {},
): DownloadMediaOperation => ({
  version: 1,
  taskId: 'task-1',
  runId: 'run-2',
  toolCallId: 'call-1',
  batchId: 'b7e6f9d2-3c1a-4e5f-9a8b-0c1d2e3f4a5b',
  destinationGrantId: 'a7a51dbe-bdf2-427d-b320-691d6872ef52',
  input: { urls },
  ...overrides,
});

function options(
  overrides: Partial<Parameters<typeof runDownloadMedia>[1]> = {},
) {
  const activities: DownloadActivity[] = [];
  const registered: { itemId: string; file: string }[] = [];
  return {
    activities,
    registered,
    run: (op: DownloadMediaOperation, signal = new AbortController().signal) =>
      runDownloadMedia(op, {
        signal,
        resolveDestination: async () => granted,
        registerAsset: async (
          _op,
          itemId,
          _root,
          file,
        ): Promise<DownloadAsset> => {
          registered.push({ itemId, file });
          return {
            assetId: `asset-${itemId}`,
            name: path.basename(file),
            mime: 'video/mp4',
            size: 32,
          };
        },
        emit: (activity) => activities.push(activity),
        runtime: directRuntime(binary),
        ...overrides,
      }),
  };
}

describe('runDownloadMedia', () => {
  beforeEach(() => {
    home = realpathSync(mkdtempSync(path.join(tmpdir(), 'neumar-runner-')));
    granted = path.join(home, 'output');
    mkdirSync(granted);
    binary = path.join(home, 'fake-yt-dlp');
    writeFileSync(binary, FAKE_YTDLP);
    chmodSync(binary, 0o755);
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('reports progress before the file is saved and registers the post-merge name', async () => {
    const { activities, registered, run } = options();
    const state = await run(operation(['https://example.org/video']));

    const phases = activities.flatMap((activity) =>
      activity.items.map((item) => item.phase),
    );
    expect(phases).toContain('transferring');
    expect(phases.indexOf('transferring')).toBeLessThan(
      phases.lastIndexOf('saved'),
    );
    expect(state.items).toEqual([
      expect.objectContaining({ itemId: '1', phase: 'saved' }),
    ]);
    expect(registered).toEqual([
      { itemId: '1', file: path.join(granted, 'clip [abc].mp4') },
    ]);
    expect(existsSync(path.join(granted, 'clip [abc].mp4'))).toBe(true);
  });

  it('keeps a saved sibling when another item fails', async () => {
    const { registered, run } = options();
    const state = await run(
      operation(['https://example.org/ok', 'https://example.org/fail']),
    );

    expect(state.items).toEqual([
      expect.objectContaining({ itemId: '1', phase: 'saved' }),
      expect.objectContaining({
        itemId: '2',
        phase: 'failed',
        reason: 'unavailable',
      }),
    ]);
    expect(registered).toHaveLength(1);
    expect(existsSync(path.join(granted, 'clip [abc].mp4'))).toBe(true);
  });

  it('cancels the process tree and publishes nothing when the batch is aborted', async () => {
    const { registered, run } = options();
    const controller = new AbortController();
    const pending = run(
      operation(['https://example.org/slow']),
      controller.signal,
    );
    controller.abort();
    const state = await pending;

    expect(state.items[0]).toMatchObject({ phase: 'cancelled' });
    expect(registered).toEqual([]);
    expect(existsSync(path.join(granted, 'clip [abc].mp4'))).toBe(false);
  });

  it('never overwrites a file that already has the download name', async () => {
    writeFileSync(path.join(granted, 'clip [abc].mp4'), 'existing');
    const { run } = options();
    const state = await run(operation(['https://example.org/video']));

    expect(state.items[0]).toMatchObject({
      phase: 'failed',
      reason: 'collision',
    });
    expect(existsSync(path.join(granted, 'clip [abc].mp4'))).toBe(true);
  });

  it('fails the item when the grant is no longer the same folder', async () => {
    let calls = 0;
    const { registered, run } = options({
      resolveDestination: async () => {
        calls += 1;
        return calls === 1 ? granted : path.join(home, 'other');
      },
    });
    const state = await run(operation(['https://example.org/video']));

    expect(state.items[0]).toMatchObject({ phase: 'failed', reason: 'denied' });
    expect(registered).toEqual([]);
  });

  it('builds fixed argv with a structured progress template and a URL terminator', () => {
    const argv = downloadArgv({
      url: 'https://example.org/watch?v=1',
      stage: '/tmp/stage',
      proxy: 'http://media:token@127.0.0.1:9',
      maxFileBytes: MAX_FILE_BYTES,
    });
    expect(argv[argv.length - 2]).toBe('--');
    expect(argv[argv.length - 1]).toBe('https://example.org/watch?v=1');
    expect(argv).toContain('--progress-template');
    expect(argv).toContain('--no-playlist');
    expect(argv).toContain('--no-overwrites');
    expect(argv.join(' ')).toContain('NDPROGRESS:');
  });
});
