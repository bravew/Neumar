import sharp from 'sharp';

import { DOC_MEDIA_LOCALES } from '../../docs.config';
import type { DocsMediaManifestAsset } from './docs-manifest';
import {
  localizedText,
  localizedTranscript,
  pathExists,
  publicEntryDir,
  publicPathFor,
  rawEntryDir,
  readJsonFile,
  repoRelativePathFor,
  renderEntryDir,
  transcriptTextFromFallback,
  localeTextFromFallback,
} from './docs-media-config';
import type { NormalizedDocMediaEntry } from './docs-media-config';

import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import fs from 'fs/promises';
import path from 'path';

interface CaptureMetadata {
  id?: string;
  kind?: 'image' | 'video';
  page?: string;
  slot?: string;
  route: string;
  seed: string;
  viewport: { width: number; height: number };
  theme?: string;
  selectors?: {
    waitFor?: string;
    masks: string[];
    steps: string[];
  };
  capturedAt?: string;
  source?: string;
}

interface RenderMetadata {
  renderer: 'remotion' | 'hyperframes';
  rendererVersion?: string;
  outputPath?: string;
  snapshotPaths?: string[];
  docker?: boolean;
}

async function hashFile(filePath: string) {
  const hash = createHash('sha256');
  hash.update(await fs.readFile(filePath));
  return hash.digest('hex');
}

async function fileBytes(filePath: string) {
  return (await fs.stat(filePath)).size;
}

async function readCapture(entry: NormalizedDocMediaEntry) {
  const capturePath = path.join(rawEntryDir(entry), 'capture.json');
  if (!(await pathExists(capturePath))) {
    return {
      route: entry.route,
      seed: entry.seed,
      viewport: entry.viewport,
    } satisfies CaptureMetadata;
  }

  return readJsonFile<CaptureMetadata>(capturePath);
}

function formatVttTime(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const millis = String(ms % 1000).padStart(3, '0');
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(
    2,
    '0',
  )}:${String(seconds).padStart(2, '0')}.${millis}`;
}

function captionTextFromTranscript(text: string) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 140) return normalized;
  return `${normalized.slice(0, 137).trim()}...`;
}

function buildVtt(text: string, durationMs: number) {
  return `WEBVTT

00:00:00.000 --> ${formatVttTime(Math.max(1000, durationMs - 250))}
${captionTextFromTranscript(text)}
`;
}

function transcriptMarkdown(
  entry: Extract<NormalizedDocMediaEntry, { kind: 'video' }>,
  locale: (typeof DOC_MEDIA_LOCALES)[number],
) {
  const transcript = localizedTranscript(entry, locale);
  const steps = entry.steps
    .map((step, index) => `${index + 1}. ${step.label}`)
    .join('\n');
  return `# ${localizedText(entry, 'caption', locale)}

${transcript}

## Steps

${steps}
`;
}

function assertFfmpeg() {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
  } catch {
    throw new Error(
      'ffmpeg and ffprobe are required for docs video optimization. Install FFmpeg and rerun docs:optimize.',
    );
  }
}

function probeDurationMs(filePath: string) {
  const output = execFileSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      filePath,
    ],
    { encoding: 'utf8' },
  );
  const ms = Math.round(Number(output.trim()) * 1000);
  if (!Number.isFinite(ms)) {
    throw new Error(
      `ffprobe returned non-numeric duration for ${filePath}: ${JSON.stringify(output.trim())}`,
    );
  }
  return ms;
}

async function readRenderMetadata(
  entry: Extract<NormalizedDocMediaEntry, { kind: 'video' }>,
) {
  const metadata: Record<string, RenderMetadata> = {};
  for (const renderer of ['remotion', 'hyperframes'] as const) {
    const metadataPath = path.join(
      renderEntryDir(renderer, entry),
      'render.json',
    );
    if (await pathExists(metadataPath)) {
      metadata[renderer] = await readJsonFile<RenderMetadata>(metadataPath);
    }
  }
  return metadata;
}

async function primaryVideoSource(
  entry: Extract<NormalizedDocMediaEntry, { kind: 'video' }>,
) {
  const renderedPath = path.join(
    renderEntryDir(entry.renderer.primary, entry),
    'source.mp4',
  );
  if (await pathExists(renderedPath)) {
    return renderedPath;
  }

  return path.join(rawEntryDir(entry), 'source.webm');
}

export async function optimizeImage(
  entry: Extract<NormalizedDocMediaEntry, { kind: 'image' }>,
): Promise<DocsMediaManifestAsset> {
  const sourcePath = path.join(rawEntryDir(entry), 'source.png');
  if (!(await pathExists(sourcePath))) {
    throw new Error(`${entry.id}: missing raw image ${sourcePath}`);
  }

  const outputDir = publicEntryDir(entry);
  await fs.mkdir(outputDir, { recursive: true });
  const avifPath = path.join(outputDir, 'image.avif');
  const webpPath = path.join(outputDir, 'image.webp');
  const pngPath = path.join(outputDir, 'image.png');

  await sharp(sourcePath).avif({ quality: 50, effort: 6 }).toFile(avifPath);
  await sharp(sourcePath).webp({ quality: 76 }).toFile(webpPath);
  await sharp(sourcePath).png({ compressionLevel: 9 }).toFile(pngPath);
  const metadata = await sharp(webpPath).metadata();
  const capture = await readCapture(entry);

  return {
    id: entry.id,
    page: entry.page,
    slot: entry.slot,
    kind: 'image',
    priority: entry.priority,
    availableLocales: [...DOC_MEDIA_LOCALES],
    surfaces: entry.surfaces,
    owner: entry.owner,
    paths: {
      image: publicPathFor(avifPath),
      imageAvif: publicPathFor(avifPath),
      imageWebp: publicPathFor(webpPath),
      imagePng: publicPathFor(pngPath),
    },
    dimensions: {
      width: metadata.width ?? entry.viewport.width,
      height: metadata.height ?? entry.viewport.height,
    },
    bytes: {
      imageAvif: await fileBytes(avifPath),
      imageWebp: await fileBytes(webpPath),
      imagePng: await fileBytes(pngPath),
    },
    hashes: {
      imageAvif: await hashFile(avifPath),
      imageWebp: await hashFile(webpPath),
      imagePng: await hashFile(pngPath),
    },
    generatedAt: new Date().toISOString(),
    capture,
    alt: localeTextFromFallback(entry, 'alt'),
    caption: localeTextFromFallback(entry, 'caption'),
    hasTranscript: false,
    renderMode: 'static',
  };
}

export async function optimizeVideo(
  entry: Extract<NormalizedDocMediaEntry, { kind: 'video' }>,
): Promise<DocsMediaManifestAsset> {
  assertFfmpeg();

  const rawPath = path.join(rawEntryDir(entry), 'source.webm');
  if (!(await pathExists(rawPath))) {
    throw new Error(`${entry.id}: missing raw recording ${rawPath}`);
  }
  const sourcePath = await primaryVideoSource(entry);
  if (!(await pathExists(sourcePath))) {
    throw new Error(`${entry.id}: missing video source ${sourcePath}`);
  }

  const outputDir = publicEntryDir(entry);
  await fs.mkdir(outputDir, { recursive: true });

  const mp4Path = path.join(outputDir, 'demo.mp4');
  const webmPath = path.join(outputDir, 'demo.webm');
  const posterPngPath = path.join(outputDir, 'poster.png');
  const posterPath = path.join(outputDir, 'poster.jpg');
  const captionsDir = path.join(outputDir, 'captions');
  const transcriptsDir = path.join(outputDir, 'transcripts');
  await fs.mkdir(captionsDir, { recursive: true });
  await fs.mkdir(transcriptsDir, { recursive: true });

  execFileSync('ffmpeg', [
    '-y',
    '-i',
    sourcePath,
    '-movflags',
    '+faststart',
    '-pix_fmt',
    'yuv420p',
    '-c:v',
    'libx264',
    '-crf',
    '28',
    '-preset',
    'medium',
    '-an',
    mp4Path,
  ]);
  execFileSync('ffmpeg', [
    '-y',
    '-i',
    sourcePath,
    '-c:v',
    'libvpx-vp9',
    '-b:v',
    '0',
    '-crf',
    '36',
    '-an',
    webmPath,
  ]);
  execFileSync('ffmpeg', [
    '-y',
    '-ss',
    String(entry.poster.atMs / 1000),
    '-i',
    sourcePath,
    '-frames:v',
    '1',
    '-update',
    '1',
    posterPngPath,
  ]);
  await sharp(posterPngPath)
    .jpeg({ quality: 82, mozjpeg: true })
    .toFile(posterPath);
  await fs.rm(posterPngPath, { force: true });
  const durationMs = probeDurationMs(sourcePath);
  const captions: Record<string, string> = {};
  const transcripts: Record<string, string> = {};
  const transcriptText = transcriptTextFromFallback(entry);
  for (const locale of DOC_MEDIA_LOCALES) {
    const captionsPath = path.join(captionsDir, `${locale}.vtt`);
    const transcriptPath = path.join(transcriptsDir, `${locale}.md`);
    await fs.writeFile(
      captionsPath,
      buildVtt(transcriptText[locale], durationMs),
    );
    await fs.writeFile(transcriptPath, transcriptMarkdown(entry, locale));
    captions[locale] = publicPathFor(captionsPath);
    transcripts[locale] = publicPathFor(transcriptPath);
  }

  const posterMetadata = await sharp(posterPath).metadata();
  const capture = await readCapture(entry);
  const renderMetadata = await readRenderMetadata(entry);

  return {
    id: entry.id,
    page: entry.page,
    slot: entry.slot,
    kind: 'video',
    priority: entry.priority,
    availableLocales: [...DOC_MEDIA_LOCALES],
    surfaces: entry.surfaces,
    owner: entry.owner,
    paths: {
      videoMp4: publicPathFor(mp4Path),
      videoWebm: publicPathFor(webmPath),
      poster: publicPathFor(posterPath),
      captions,
      transcripts,
    },
    dimensions: {
      width: posterMetadata.width ?? entry.viewport.width,
      height: posterMetadata.height ?? entry.viewport.height,
    },
    durationMs,
    bytes: {
      videoMp4: await fileBytes(mp4Path),
      videoWebm: await fileBytes(webmPath),
      poster: await fileBytes(posterPath),
      ...Object.fromEntries(
        await Promise.all(
          DOC_MEDIA_LOCALES.map(async (locale) => [
            `caption:${locale}`,
            await fileBytes(path.join(captionsDir, `${locale}.vtt`)),
          ]),
        ),
      ),
      ...Object.fromEntries(
        await Promise.all(
          DOC_MEDIA_LOCALES.map(async (locale) => [
            `transcript:${locale}`,
            await fileBytes(path.join(transcriptsDir, `${locale}.md`)),
          ]),
        ),
      ),
    },
    hashes: {
      videoMp4: await hashFile(mp4Path),
      videoWebm: await hashFile(webmPath),
      poster: await hashFile(posterPath),
      ...Object.fromEntries(
        await Promise.all(
          DOC_MEDIA_LOCALES.map(async (locale) => [
            `caption:${locale}`,
            await hashFile(path.join(captionsDir, `${locale}.vtt`)),
          ]),
        ),
      ),
      ...Object.fromEntries(
        await Promise.all(
          DOC_MEDIA_LOCALES.map(async (locale) => [
            `transcript:${locale}`,
            await hashFile(path.join(transcriptsDir, `${locale}.md`)),
          ]),
        ),
      ),
    },
    generatedAt: new Date().toISOString(),
    capture,
    alt: localeTextFromFallback(entry, 'alt'),
    caption: localeTextFromFallback(entry, 'caption'),
    hasTranscript: true,
    motion: {
      posterAtMs: entry.poster.atMs,
      steps: entry.steps.map((step) => step.label),
      effects: entry.effects,
    },
    primaryRenderer: entry.renderer.primary,
    renderMode: 'video',
    render: {
      rendererVersions: Object.fromEntries(
        Object.entries(renderMetadata).map(([renderer, metadata]) => [
          renderer,
          metadata.rendererVersion ?? 'unknown',
        ]),
      ),
      metadataPaths: Object.fromEntries(
        Object.keys(renderMetadata).map((renderer) => [
          renderer,
          repoRelativePathFor(
            path.join(renderEntryDir(renderer, entry), 'render.json'),
          ),
        ]),
      ),
      comparisonArtifactPaths: Object.values(renderMetadata).flatMap(
        (metadata) =>
          (metadata.snapshotPaths ?? []).map((snapshotPath) =>
            repoRelativePathFor(snapshotPath),
          ),
      ),
    },
  };
}
