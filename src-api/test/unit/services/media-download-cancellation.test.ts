import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

// Run in a child so a microtask loop cannot starve Vitest's own timeout.
// A real downloader needs an event-loop turn after abort to reap its process.
const apiRoot = resolve(import.meta.dirname, '../../..');
const moduleUrl = pathToFileURL(
  resolve(apiRoot, 'src/shared/services/media-download/run-batch.ts'),
).href;

describe('download stream cancellation', () => {
  it('lets asynchronous process cleanup settle before emitting its terminal state', () => {
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        `
import { withDownloadBatch } from ${JSON.stringify(moduleUrl)};
const controller = new AbortController();
const operation = {
  version: 1, taskId: 'task', runId: 'run', toolCallId: 'call',
  batchId: 'batch', destinationGrantId: 'grant',
  input: { urls: ['https://example.org/video'] },
};
async function* source() { yield { type: 'done' }; }
const start = (_operation, { signal, emit }) => new Promise((resolve) => {
  signal.addEventListener('abort', () => {
    process.stdout.write('abort-received\\n');
    setTimeout(() => {
      const activity = {
        version: 1, taskId: 'task', runId: 'run', toolCallId: 'call',
        batchId: 'batch', items: [{ itemId: '1', sequence: 1, phase: 'cancelled' }],
      };
      emit(activity);
      resolve(activity);
    }, 10);
  }, { once: true });
  setTimeout(() => controller.abort(), 10);
});
for await (const message of withDownloadBatch(source(), operation, start, controller.signal)) {
  if (message.type === 'media_download_activity') {
    process.stdout.write(message.downloadActivity.items[0].phase + '\\n');
  } else process.stdout.write(message.type + '\\n');
}
`,
      ],
      { cwd: apiRoot, encoding: 'utf8', timeout: 5_000 },
    );
    expect(result.stdout, result.stderr).toContain('abort-received');
    expect(result.error?.message).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim().split('\n')).toEqual([
      'abort-received',
      'cancelled',
      'done',
    ]);
  });
});
