import crypto from 'crypto';
import { readFile } from 'fs/promises';

import type { SourceProvenance } from '../types';
import {
  CONTENT_CREDENTIALS_SDK_PACKAGE,
  CONTENT_CREDENTIALS_SDK_VERSION,
  C2PA_TECHNICAL_SPEC_VERSION,
  type InboundManifestInfo,
} from './types';

export interface ManifestDetectorReader {
  readManifest(input: {
    sourcePath: string;
    mime: string;
    signal?: AbortSignal;
  }): Promise<InboundManifestInfo | null>;
}

export class CorruptC2paManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CorruptC2paManifestError';
  }
}

export async function detectInboundManifest(input: {
  sourcePath: string;
  mime: string;
  sourceProvenance?: SourceProvenance;
  reader?: ManifestDetectorReader;
  signal?: AbortSignal;
}): Promise<InboundManifestInfo> {
  const reader = input.reader ?? new SdkManifestReader();
  try {
    const detected = await reader.readManifest({
      sourcePath: input.sourcePath,
      mime: input.mime,
      signal: input.signal,
    });
    if (detected) {
      return normalizeManifestInfo(detected, input.sourceProvenance);
    }
  } catch (error) {
    return {
      present: true,
      invalid: true,
      reason: error instanceof Error ? error.message : String(error),
      aiGenerated: Boolean(input.sourceProvenance?.aiGenerated),
      sdkVersion: CONTENT_CREDENTIALS_SDK_VERSION,
      specVersion: C2PA_TECHNICAL_SPEC_VERSION,
    };
  }

  return {
    present: false,
    aiGenerated: Boolean(input.sourceProvenance?.aiGenerated),
    sdkVersion: CONTENT_CREDENTIALS_SDK_VERSION,
    specVersion: C2PA_TECHNICAL_SPEC_VERSION,
  };
}

export function summarizeManifestStore(
  store: unknown,
  sourceProvenance?: SourceProvenance,
): InboundManifestInfo {
  const active = activeManifestFromStore(store);
  const rawText = JSON.stringify(active ?? store ?? {});
  const generator = stringField(active, [
    'claim_generator',
    'claimGenerator',
    'claim_generator_info.0.name',
  ]);
  const model =
    stringField(active, ['model', 'ai.model', 'generator.model']) ??
    sourceProvenance?.model;
  const prompt = stringField(active, [
    'prompt',
    'ai.prompt',
    'generator.prompt',
  ]);
  const claimId = stringField(active, ['claim_id', 'claimId', 'instance_id']);
  const validationText = JSON.stringify(
    getPath(store, ['validation_results']) ??
      getPath(store, ['validationResults']) ??
      {},
  ).toLowerCase();

  return {
    present: true,
    generator: generator ?? sourceProvenance?.claimGenerator,
    model,
    prompt,
    signedBy: signedByFromManifest(active),
    valid:
      validationText.length === 2
        ? true
        : !validationText.includes('invalid') &&
          !validationText.includes('failure'),
    claimId,
    manifestDigest: digestJson(active ?? store ?? {}),
    aiGenerated:
      sourceProvenance?.aiGenerated === true || containsAiSignal(rawText),
    sdkVersion: CONTENT_CREDENTIALS_SDK_VERSION,
    specVersion: C2PA_TECHNICAL_SPEC_VERSION,
    raw: store,
  };
}

class SdkManifestReader implements ManifestDetectorReader {
  async readManifest(input: {
    sourcePath: string;
    mime: string;
  }): Promise<InboundManifestInfo | null> {
    const sdk = await loadContentCredentialsSdk();
    const readerFactory = sdk?.Reader as
      | {
          fromAsset?: (
            asset: Record<string, unknown>,
            settings?: Record<string, unknown>,
          ) => Promise<{ json: () => unknown }>;
        }
      | undefined;
    if (!readerFactory?.fromAsset) return null;

    const reader = await readerFactory.fromAsset(
      { path: input.sourcePath, mimeType: input.mime },
      { verify: { verify_after_reading: false, verify_trust: true } },
    );
    const store = reader.json();
    if (!store) return null;
    return summarizeManifestStore(store);
  }
}

export async function loadContentCredentialsSdk(): Promise<Record<
  string,
  unknown
> | null> {
  try {
    const packageName = CONTENT_CREDENTIALS_SDK_PACKAGE;
    return (await import(packageName)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function maybeCorruptJumbf(path: string): Promise<boolean> {
  const bytes = await readFile(path);
  const haystack = bytes.toString('latin1');
  return haystack.includes('jumb') || haystack.includes('c2pa');
}

function normalizeManifestInfo(
  detected: InboundManifestInfo,
  sourceProvenance?: SourceProvenance,
): InboundManifestInfo {
  return {
    ...detected,
    present: detected.present,
    model: detected.model ?? sourceProvenance?.model,
    generator: detected.generator ?? sourceProvenance?.claimGenerator,
    aiGenerated:
      detected.aiGenerated === true || sourceProvenance?.aiGenerated === true,
    sdkVersion: detected.sdkVersion ?? CONTENT_CREDENTIALS_SDK_VERSION,
    specVersion: detected.specVersion ?? C2PA_TECHNICAL_SPEC_VERSION,
  };
}

function activeManifestFromStore(store: unknown): unknown {
  if (!isRecord(store)) return store;
  const activeId =
    getPath(store, ['active_manifest']) ?? getPath(store, ['activeManifest']);
  if (typeof activeId === 'string') {
    const manifests = getPath(store, ['manifests']);
    if (isRecord(manifests) && activeId in manifests) {
      return manifests[activeId];
    }
  }
  return (
    getPath(store, ['active_manifest']) ??
    getPath(store, ['activeManifest']) ??
    getPath(store, ['manifest']) ??
    store
  );
}

function signedByFromManifest(manifest: unknown): string | undefined {
  return (
    stringField(manifest, ['signature_info.issuer']) ??
    stringField(manifest, ['signatureInfo.issuer']) ??
    stringField(manifest, ['certificate.issuer']) ??
    stringField(manifest, ['claim_signature.signer'])
  );
}

function stringField(source: unknown, paths: string[]): string | undefined {
  for (const path of paths) {
    const value = getPath(source, path.split('.'));
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

function getPath(source: unknown, path: string[]): unknown {
  let current = source;
  for (const part of path) {
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return current;
}

function containsAiSignal(text: string): boolean {
  const normalized = text.toLowerCase();
  return (
    normalized.includes('ai_generated') ||
    normalized.includes('synthetic') ||
    normalized.includes('generative') ||
    normalized.includes('aigc')
  );
}

function digestJson(value: unknown): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(value))
    .digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export async function detectCorruptJumbfHint(path: string): Promise<boolean> {
  try {
    return await maybeCorruptJumbf(path);
  } catch {
    return false;
  }
}
