import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { readFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

import { LocalSigner } from '@contentauth/c2pa-node';
import { describe, expect, it, vi } from 'vitest';

const sdkMocks = vi.hoisted(() => ({
  sign: vi.fn(),
  newSigner: vi.fn(),
  loadContentCredentialsSdk: vi.fn(),
}));

vi.mock('@/shared/services/publish/provenance/manifest-detector', () => ({
  detectInboundManifest: vi.fn(),
  loadContentCredentialsSdk: sdkMocks.loadContentCredentialsSdk,
  summarizeManifestStore: vi.fn(),
}));

import { SdkOrToolC2paRunner } from '@/shared/services/publish/provenance';
import type { NeumaManifest } from '@/shared/services/publish/provenance';
import {
  TEST_SIGNER_CERT_PEM,
  TEST_SIGNER_PRIVATE_KEY_PEM,
} from '@/shared/services/publish/provenance/test-cert';

describe('C2PA SDK runner', () => {
  it('treats a null SDK reader as no inbound manifest', async () => {
    const fromAsset = vi.fn(async () => null);
    sdkMocks.loadContentCredentialsSdk.mockResolvedValue({
      Reader: { fromAsset },
    });

    const result = await new SdkOrToolC2paRunner().readManifest({
      sourcePath: 'source.jpg',
      mime: 'image/jpeg',
    });

    expect(result).toBeNull();
    expect(fromAsset).toHaveBeenCalledWith(
      { path: 'source.jpg', mimeType: 'image/jpeg' },
      { verify: { verify_after_reading: false, verify_trust: true } },
    );
    vi.clearAllMocks();
  });

  it('passes local signer certificates as Buffers to c2pa-node', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'c2pa-sdk-runner-'));
    try {
      const sourcePath = path.join(dir, 'source.jpg');
      const outputPath = path.join(dir, 'source.signed.jpg');
      const manifestPath = path.join(dir, 'manifest.c2pa.json');
      writeFileSync(sourcePath, Buffer.from('fake image bytes'));

      sdkMocks.newSigner.mockImplementation((cert, key, alg) => {
        expect(Buffer.isBuffer(cert)).toBe(true);
        expect(Buffer.isBuffer(key)).toBe(true);
        expect(cert.toString('utf8')).toBe('workspace-cert');
        expect(key.toString('utf8')).toBe('workspace-key');
        expect(alg).toBe('es256');
        return { signer: true };
      });
      sdkMocks.sign.mockImplementation((_signer, input, output) => {
        expect(input).toEqual({ path: sourcePath });
        expect(output).toEqual({ path: outputPath });
        writeFileSync(outputPath, Buffer.from('signed image bytes'));
        return Buffer.from('manifest bytes');
      });
      sdkMocks.loadContentCredentialsSdk.mockResolvedValue({
        Builder: {
          withJson: vi.fn(() => ({
            sign: sdkMocks.sign,
          })),
        },
        LocalSigner: {
          newSigner: sdkMocks.newSigner,
        },
      });

      const result = await new SdkOrToolC2paRunner().sign({
        sourcePath,
        outputPath,
        manifestPath,
        manifest: manifestFixture(),
        mode: 'workspace',
        signer: {
          mode: 'workspace',
          certificatePem: 'workspace-cert',
          privateKeyPem: 'workspace-key',
        },
      });

      expect(result.signedArtifactPath).toBe(outputPath);
      expect(await readFile(outputPath, 'utf8')).toBe('signed image bytes');
      expect(sdkMocks.newSigner).toHaveBeenCalledOnce();
      expect(sdkMocks.sign).toHaveBeenCalledOnce();
    } finally {
      rmSync(dir, { recursive: true, force: true });
      vi.clearAllMocks();
    }
  });

  it('keeps the bundled local test signer parseable by c2pa-node', () => {
    const signer = LocalSigner.newSigner(
      Buffer.from(TEST_SIGNER_CERT_PEM, 'utf8'),
      Buffer.from(TEST_SIGNER_PRIVATE_KEY_PEM, 'utf8'),
      'es256',
    );

    expect(signer.alg()).toBe('es256');
    expect(signer.certs()).toHaveLength(1);
    expect(signer.sign(Buffer.from('neuma local test signer'))).toHaveLength(
      64,
    );
  });
});

function manifestFixture(): NeumaManifest {
  return {
    claimGenerator: 'Neuma/26.5.10',
    claimGeneratorInfo: [{ name: 'Neuma', version: '26.5.10' }],
    contentSha256: 'a'.repeat(64),
    source: {
      path: 'source.jpg',
      sha256: 'a'.repeat(64),
      sizeBytes: 16,
      mime: 'image/jpeg',
    },
    createdAt: '2026-05-07T00:00:00.000Z',
    signerMode: 'workspace',
    aiGenerated: false,
    ingredients: [],
    assertions: {
      actions: { actions: [] },
      creativeWork: { title: 'source.jpg' },
      trainingMining: {
        dataMining: 'notAllowed',
        aiTraining: 'notAllowed',
      },
      schemaOrgCreativeWork: {
        '@context': 'https://schema.org',
        '@type': 'CreativeWork',
        title: 'source.jpg',
      },
    },
    tool: {
      packageName: '@contentauth/c2pa-node',
      packageVersion: '0.5.5',
      specVersion: '2.4',
    },
  };
}
