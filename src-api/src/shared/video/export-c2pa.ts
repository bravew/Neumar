import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

import { getSetting } from '@/shared/db/operations';
import { validatePath } from '@/shared/services/ffmpeg';
import {
  buildNeumaManifest,
  type C2paSignRunner,
  resolveC2paSignerConfig,
  SdkOrToolC2paRunner,
} from '@/shared/services/publish/provenance';
import { createLogger } from '@/shared/utils/logger';
import {
  AI_DISCLOSURE,
  type ExportMetadata,
} from '@/shared/video/export-metadata';

// Phase 7 governance — C2PA Content Credentials on the exported MP4. Reuses the
// publish C2PA subsystem (`@contentauth/c2pa-node` + c2patool fallback) and the
// shared signer-config resolver, so video export honours the same signer keys as
// image publishing. Best-effort: a render must never fail because signing is
// unavailable (SDK/native addon absent, no c2patool, cert misconfigured) — those
// surface as a warning and an unsigned-but-disclosed MP4.

const logger = createLogger('VideoExportC2pa');

export interface ExportC2paResult {
  /** Relative path to the detached manifest sidecar. */
  manifestPath: string;
  signerMode: string;
  /** True when credentials were embedded into the MP4 itself. */
  embedded: boolean;
  /** True for the bundled `local-test` dev signer (manifests are untrusted). */
  untrusted: boolean;
}

async function hashFile(
  filePath: string,
): Promise<{ sha256: string; size: number }> {
  // Stream the hash so a multi-GB export never lands fully in the heap.
  const [stat, sha256] = await Promise.all([
    fs.stat(filePath),
    (async () => {
      const hash = crypto.createHash('sha256');
      await pipeline(createReadStream(filePath), hash);
      return hash.digest('hex');
    })(),
  ]);
  return { sha256, size: stat.size };
}

/**
 * Sign the exported MP4 with C2PA Content Credentials. Returns the manifest
 * result, or `undefined` when signing is disabled or unavailable. Honours the
 * `video.c2paSigning` opt-out (default on).
 */
export async function signExportedMp4(input: {
  root: string;
  outputPath: string;
  metadata: ExportMetadata;
  runner?: C2paSignRunner;
  readSetting?: (key: string) => string | null;
  now?: () => Date;
  signal?: AbortSignal;
}): Promise<ExportC2paResult | undefined> {
  const readSetting = input.readSetting ?? getSetting;
  if (readSetting('video.c2paSigning') === 'false') return undefined;

  const outputPath = validatePath(input.outputPath, input.root, 'write');
  const parsed = path.parse(outputPath);
  const tempSigned = validatePath(
    path.join(
      parsed.dir,
      `${parsed.name}.c2pa-${crypto.randomUUID()}${parsed.ext}`,
    ),
    input.root,
    'write',
  );
  const manifestPath = validatePath(
    `${outputPath}.c2pa.json`,
    input.root,
    'write',
  );

  try {
    const signer = resolveC2paSignerConfig(readSetting);
    const { sha256, size } = await hashFile(outputPath);
    const manifest = buildNeumaManifest({
      source: {
        path: outputPath,
        sha256,
        sizeBytes: size,
        mime: 'video/mp4',
        provenance: { aiGenerated: true, summary: AI_DISCLOSURE },
      },
      metadata: {
        title: input.metadata.title,
        aiGenerated: true,
        generatedByNeumaAgent: true,
        ...(input.metadata.artist
          ? { creativeWork: { author: input.metadata.artist } }
          : {}),
      },
      appVersion:
        process.env.NEUMAR_VERSION ?? process.env.npm_package_version ?? 'dev',
      signerMode: signer.mode,
      inboundManifest: { present: false },
      trainingMiningOptOut:
        readSetting('publish.c2pa.trainingMiningOptOut') !== 'false',
      ...(input.now ? { now: input.now() } : {}),
    });

    const runner = input.runner ?? new SdkOrToolC2paRunner();
    const result = await runner.sign({
      sourcePath: outputPath,
      outputPath: tempSigned,
      manifestPath,
      manifest,
      mode: signer.mode,
      signer,
      ...(input.signal ? { signal: input.signal } : {}),
    });

    if (result.embedded) {
      await fs.rename(tempSigned, outputPath);
    } else {
      await fs.rm(tempSigned, { force: true }).catch(() => undefined);
    }
    const untrusted = signer.mode === 'local-test';
    logger.info(
      `C2PA signed export (${signer.mode}${untrusted ? ', untrusted dev signer' : ''})`,
    );
    return {
      manifestPath: path.relative(input.root, manifestPath),
      signerMode: signer.mode,
      embedded: result.embedded,
      untrusted,
    };
  } catch (error) {
    await fs.rm(tempSigned, { force: true }).catch(() => undefined);
    logger.warn('video.export.c2pa_sign_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}
