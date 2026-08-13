import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { readAlignedChunks } from '@/shared/services/publish/upload/chunker';

describe('publish upload chunker', () => {
  it('streams aligned chunks without loading the whole file', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'publish-chunker-'));
    try {
      const file = path.join(dir, 'fixture.bin');
      writeFileSync(file, Buffer.from('helloworld!'));

      const chunks = [];
      for await (const item of readAlignedChunks(file, {
        chunkSize: 5,
        alignment: 5,
      })) {
        chunks.push({
          offset: item.offset,
          text: item.chunk.toString('utf8'),
          final: item.final,
        });
      }

      expect(chunks).toEqual([
        { offset: 0, text: 'hello', final: false },
        { offset: 5, text: 'world', final: false },
        { offset: 10, text: '!', final: true },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
