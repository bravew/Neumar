import { createReadStream } from 'fs';

export interface ChunkerOptions {
  chunkSize: number;
  alignment?: number;
}

export interface AlignedChunk {
  offset: number;
  chunk: Buffer;
  final: boolean;
}

export async function* readAlignedChunks(
  filePath: string,
  options: ChunkerOptions,
): AsyncGenerator<AlignedChunk> {
  validateChunkerOptions(options);

  let offset = 0;
  let pending = Buffer.alloc(0);
  const stream = createReadStream(filePath, {
    highWaterMark: options.chunkSize,
  });

  for await (const part of stream) {
    pending = Buffer.concat([pending, Buffer.from(part)]);
    while (pending.length >= options.chunkSize) {
      const chunk = pending.subarray(0, options.chunkSize);
      pending = pending.subarray(options.chunkSize);
      yield { offset, chunk, final: false };
      offset += chunk.length;
    }
  }

  if (pending.length > 0) {
    yield { offset, chunk: pending, final: true };
  }
}

export function validateChunkerOptions(options: ChunkerOptions): void {
  if (!Number.isInteger(options.chunkSize) || options.chunkSize <= 0) {
    throw new Error(`Invalid chunk size: ${options.chunkSize}`);
  }
  const alignment = options.alignment ?? 1;
  if (!Number.isInteger(alignment) || alignment <= 0) {
    throw new Error(`Invalid chunk alignment: ${alignment}`);
  }
  if (options.chunkSize % alignment !== 0) {
    throw new Error(
      `Chunk size ${options.chunkSize} must align to ${alignment}`,
    );
  }
}
