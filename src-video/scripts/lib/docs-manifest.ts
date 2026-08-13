import { z } from 'zod';

import { DOC_MEDIA_LOCALES } from '../../docs.config';
import { pathExists, SITE_PUBLIC_DOCS_DIR } from './docs-media-config';

import fs from 'fs/promises';
import path from 'path';

export const manifestAssetSchema = z.object({
  id: z.string(),
  page: z.string(),
  slot: z.string(),
  kind: z.enum(['image', 'video']),
  priority: z.enum(['required', 'nice-to-have', 'defer']),
  availableLocales: z.array(z.enum(DOC_MEDIA_LOCALES)).min(1),
  surfaces: z.array(z.enum(['docs', 'landing'])),
  owner: z.string(),
  paths: z.object({
    image: z.string().optional(),
    imageAvif: z.string().optional(),
    imageWebp: z.string().optional(),
    imagePng: z.string().optional(),
    image2x: z.string().optional(),
    videoMp4: z.string().optional(),
    videoWebm: z.string().optional(),
    poster: z.string().optional(),
    transcripts: z.record(z.enum(DOC_MEDIA_LOCALES), z.string()).optional(),
    captions: z.record(z.enum(DOC_MEDIA_LOCALES), z.string()).optional(),
  }),
  dimensions: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  durationMs: z.number().int().positive().optional(),
  bytes: z.record(z.string(), z.number().int().nonnegative()),
  hashes: z.record(z.string(), z.string()),
  generatedAt: z.string(),
  capture: z.object({
    id: z.string().optional(),
    kind: z.enum(['image', 'video']).optional(),
    page: z.string().optional(),
    slot: z.string().optional(),
    route: z.string(),
    seed: z.string(),
    viewport: z.object({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    }),
    captureProfile: z
      .object({
        viewport: z.object({
          width: z.number().int().positive(),
          height: z.number().int().positive(),
        }),
        deviceScaleFactor: z.number().positive(),
        colorScheme: z.string(),
        reducedMotion: z.string(),
        forcedColors: z.string(),
        recordVideo: z.object({
          size: z.object({
            width: z.number().int().positive(),
            height: z.number().int().positive(),
          }),
        }),
      })
      .optional(),
    theme: z.string().optional(),
    selectors: z
      .object({
        waitFor: z.string().optional(),
        masks: z.array(z.string()).default([]),
        steps: z.array(z.string()).default([]),
      })
      .optional(),
    capturedAt: z.string().optional(),
    source: z.string().optional(),
  }),
  alt: z.record(z.enum(DOC_MEDIA_LOCALES), z.string()),
  caption: z.record(z.enum(DOC_MEDIA_LOCALES), z.string()),
  hasTranscript: z.boolean(),
  motion: z
    .object({
      posterAtMs: z.number().int().nonnegative().optional(),
      steps: z.array(z.string()).default([]),
      effects: z.array(z.string()).default([]),
    })
    .optional(),
  primaryRenderer: z.enum(['remotion', 'hyperframes']).optional(),
  renderMode: z.enum(['static', 'video']).default('static'),
  render: z
    .object({
      rendererVersions: z.record(z.string(), z.string()).default({}),
      metadataPaths: z.record(z.string(), z.string()).default({}),
      comparisonArtifactPaths: z.array(z.string()).default([]),
    })
    .optional(),
});

export const docsMediaManifestSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string(),
  assets: z.array(manifestAssetSchema),
});

export type DocsMediaManifestAsset = z.infer<typeof manifestAssetSchema>;
export type DocsMediaManifest = z.infer<typeof docsMediaManifestSchema>;

export const MANIFEST_PATH = path.join(SITE_PUBLIC_DOCS_DIR, 'manifest.json');

export async function readManifest(): Promise<DocsMediaManifest> {
  if (!(await pathExists(MANIFEST_PATH))) {
    return {
      schemaVersion: 1,
      generatedAt: new Date(0).toISOString(),
      assets: [],
    };
  }

  const data = JSON.parse(await fs.readFile(MANIFEST_PATH, 'utf8'));
  return docsMediaManifestSchema.parse(data);
}

export async function writeManifest(assets: DocsMediaManifestAsset[]) {
  await fs.mkdir(SITE_PUBLIC_DOCS_DIR, { recursive: true });
  const manifest: DocsMediaManifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    assets: assets.sort((a, b) => a.id.localeCompare(b.id)),
  };

  await fs.writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
