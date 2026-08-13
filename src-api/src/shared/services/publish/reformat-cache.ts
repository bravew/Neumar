import crypto from 'crypto';
import { existsSync } from 'fs';
import { mkdir } from 'fs/promises';
import path from 'path';

import type { ReformatSpec, SourceArtifact } from './types';

export interface ReformatCacheOptions {
  rootDir: string;
}

export class ReformatCache {
  private readonly rootDir: string;

  constructor(options: ReformatCacheOptions) {
    this.rootDir = options.rootDir;
  }

  async get(input: {
    source: SourceArtifact;
    spec: ReformatSpec;
  }): Promise<string | null> {
    const target = await this.pathFor(input);
    return existsSync(target) ? target : null;
  }

  async pathFor(input: {
    source: SourceArtifact;
    spec: ReformatSpec;
  }): Promise<string> {
    const key = reformatCacheKey(input.source.sha256, input.spec);
    const dir = path.join(this.rootDir, key.slice(0, 2), key.slice(2, 10));
    await mkdir(dir, { recursive: true });
    const extension = input.spec.container ?? extensionFor(input.source.path);
    return path.join(dir, `derivative.${extension}`);
  }
}

export function reformatCacheKey(
  sourceSha256: string,
  spec: ReformatSpec,
): string {
  return crypto
    .createHash('sha256')
    .update(sourceSha256)
    .update('\0')
    .update(canonicalizeSpec(spec))
    .digest('hex');
}

export function canonicalizeSpec(spec: ReformatSpec): string {
  return JSON.stringify(sortObject(spec));
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObject);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, sortObject(nested)]),
  );
}

function extensionFor(filePath: string): string {
  const ext = path.extname(filePath).replace(/^\./, '');
  return ext || 'bin';
}
