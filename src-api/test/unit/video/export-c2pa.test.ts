import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { C2paSignRunner } from '@/shared/services/publish/provenance';
import { signExportedMp4 } from '@/shared/video/export-c2pa';
import type { ExportMetadata } from '@/shared/video/export-metadata';

// Phase 7 — C2PA signing of the exported MP4. The real SDK/c2patool is not
// exercised here; a fake runner stands in so we can assert the best-effort
// contract (embed-and-replace, opt-out, never throw).

let root: string;
let outputPath: string;

const metadata: ExportMetadata = {
  title: 'Clip',
  artist: 'Credits: Jane',
  comment: 'AI-generated with Neuma. Credits: Jane',
  credits: [],
  aiGenerated: true,
};

function fakeRunner(over: Partial<C2paSignRunner> = {}): C2paSignRunner {
  return {
    readManifest: vi.fn().mockResolvedValue(null),
    supportedFormats: vi.fn(),
    sign: vi.fn(async ({ outputPath: signedOut, manifestPath }) => {
      writeFileSync(signedOut, 'SIGNED');
      writeFileSync(manifestPath, '{}');
      return {
        signedArtifactPath: signedOut,
        manifestPath,
        manifestSha256: 'm',
        contentSha256: 'c',
        embedded: true,
        signerMode: 'local-test' as const,
        runner: {
          sdkPackage: '@contentauth/c2pa-node',
          sdkVersion: '0.5.5',
          specVersion: '2.4',
        },
      };
    }),
    ...over,
  } as C2paSignRunner;
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'export-c2pa-'));
  outputPath = path.join(root, 'out.mp4');
  writeFileSync(outputPath, 'ORIGINAL');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('signExportedMp4', () => {
  it('embeds credentials and replaces the original with the signed file', async () => {
    const result = await signExportedMp4({
      root,
      outputPath,
      metadata,
      runner: fakeRunner(),
      readSetting: () => null, // default → local-test signer
    });

    expect(result).toMatchObject({
      signerMode: 'local-test',
      embedded: true,
      untrusted: true,
      manifestPath: 'out.mp4.c2pa.json',
    });
    expect(readFileSync(outputPath, 'utf8')).toBe('SIGNED');
  });

  it('is a no-op when video.c2paSigning is disabled', async () => {
    const runner = fakeRunner();
    const result = await signExportedMp4({
      root,
      outputPath,
      metadata,
      runner,
      readSetting: (key) => (key === 'video.c2paSigning' ? 'false' : null),
    });
    expect(result).toBeUndefined();
    expect(runner.sign).not.toHaveBeenCalled();
    expect(readFileSync(outputPath, 'utf8')).toBe('ORIGINAL');
  });

  it('keeps the original and cleans up the temp file when not embedded', async () => {
    const runner = fakeRunner({
      sign: vi.fn(async ({ outputPath: signedOut, manifestPath }) => {
        writeFileSync(signedOut, 'DETACHED');
        writeFileSync(manifestPath, '{}');
        return {
          signedArtifactPath: signedOut,
          manifestPath,
          manifestSha256: 'm',
          contentSha256: 'c',
          embedded: false,
          signerMode: 'local-test' as const,
          runner: {
            sdkPackage: '@contentauth/c2pa-node',
            sdkVersion: '0.5.5',
            specVersion: '2.4',
          },
        };
      }),
    });
    const result = await signExportedMp4({
      root,
      outputPath,
      metadata,
      runner,
      readSetting: () => null,
    });
    expect(result).toMatchObject({ embedded: false });
    // Original MP4 untouched; the detached temp signed file is cleaned up.
    expect(readFileSync(outputPath, 'utf8')).toBe('ORIGINAL');
    const leftoverTemp = readdirSync(root).filter((f) => f.includes('.c2pa-'));
    expect(leftoverTemp).toEqual([]);
  });

  it('never throws when the signer fails — returns undefined, keeps the MP4', async () => {
    const result = await signExportedMp4({
      root,
      outputPath,
      metadata,
      runner: fakeRunner({
        sign: vi.fn().mockRejectedValue(new Error('no signer available')),
      }),
      readSetting: () => null,
    });
    expect(result).toBeUndefined();
    expect(readFileSync(outputPath, 'utf8')).toBe('ORIGINAL');
  });
});
