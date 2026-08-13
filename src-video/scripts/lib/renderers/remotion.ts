import { bundle } from '@remotion/bundler';
import {
  renderMedia,
  renderStill,
  selectComposition,
} from '@remotion/renderer';
import { enableTailwind } from '@remotion/tailwind';

import {
  pathExists,
  rawEntryDir,
  renderEntryDir,
  type NormalizedDocMediaVideoEntry,
  VIDEO_ROOT,
} from '../docs-media-config';

import fs from 'fs/promises';
import { createRequire } from 'module';
import path from 'path';

const REMOTION_ENTRY = path.join(VIDEO_ROOT, 'src/index.ts');
const DOC_DEMO_COMPOSITION = 'DocDemo';
const require = createRequire(import.meta.url);
const remotionRendererPackage = require('@remotion/renderer/package.json') as {
  version: string;
};

export type DocsRenderQuality = 'draft' | 'standard' | 'high';

export interface RendererResult {
  renderer: 'remotion' | 'hyperframes';
  entryId: string;
  outputPath: string;
  metadataPath: string;
}

export interface RendererOptions {
  dryRun: boolean;
  quality: DocsRenderQuality;
  ci: boolean;
}

const QUALITY_SETTINGS: Record<
  DocsRenderQuality,
  { crf: number; scale: number }
> = {
  draft: { crf: 28, scale: 0.75 },
  standard: { crf: 22, scale: 1 },
  high: { crf: 18, scale: 1 },
};

function snapshotFileName(index: number, ms: number) {
  return `frame-${String(index).padStart(2, '0')}-at-${ms / 1000}s.png`;
}

function frameForTimestamp(ms: number, fps: number, durationMs: number) {
  const frame = Math.round((ms / 1000) * fps);
  const maxFrame = Math.max(0, Math.round((durationMs / 1000) * fps) - 1);
  return Math.min(frame, maxFrame);
}

export async function renderWithRemotion(
  entry: NormalizedDocMediaVideoEntry,
  options: RendererOptions,
): Promise<RendererResult> {
  const outputDir = renderEntryDir('remotion', entry);
  const outputPath = path.join(outputDir, 'source.mp4');
  const metadataPath = path.join(outputDir, 'render.json');
  const snapshotDir = path.join(outputDir, 'snapshots');
  const rawPath = path.join(rawEntryDir(entry), 'source.webm');
  const recordingPath = `docs/raw/${entry.page}/${entry.slot}/source.webm`;
  const durationMs =
    entry.camera.durationMs ?? entry.budgets.maxDurationMs ?? 15_000;
  const fps = entry.camera.fps;
  const settings = QUALITY_SETTINGS[options.quality];
  const snapshotAtMs = entry.renderer.hyperframes?.snapshotAtMs ?? [];

  if (options.dryRun) {
    console.log(
      `  remotion ${entry.id}: render ${DOC_DEMO_COMPOSITION} -> ${outputPath}`,
    );
    for (const ms of snapshotAtMs) {
      console.log(`  remotion ${entry.id}: snapshot ${ms}ms`);
    }
    return {
      renderer: 'remotion',
      entryId: entry.id,
      outputPath,
      metadataPath,
    };
  }

  if (!(await pathExists(rawPath))) {
    throw new Error(
      `${entry.id}: missing raw recording ${rawPath}. Run docs:capture first.`,
    );
  }

  await fs.mkdir(outputDir, { recursive: true });
  await fs.rm(snapshotDir, { recursive: true, force: true });

  const serveUrl = await bundle({
    entryPoint: REMOTION_ENTRY,
    webpackOverride: (config) => enableTailwind(config),
  });
  const inputProps = {
    id: entry.id,
    title: entry.title,
    recordingPath,
    durationMs,
    fps,
    camera: entry.camera,
    steps: entry.camera.zooms.map((zoom) => zoom.label),
  };
  const composition = await selectComposition({
    serveUrl,
    id: DOC_DEMO_COMPOSITION,
    inputProps,
  });
  const snapshotPaths: string[] = [];

  if (snapshotAtMs.length > 0) {
    await fs.mkdir(snapshotDir, { recursive: true });
    for (const [index, ms] of snapshotAtMs.entries()) {
      const snapshotPath = path.join(snapshotDir, snapshotFileName(index, ms));
      await renderStill({
        serveUrl,
        composition,
        frame: frameForTimestamp(ms, fps, durationMs),
        imageFormat: 'png',
        inputProps,
        output: snapshotPath,
        overwrite: true,
        scale: 1,
      });
      snapshotPaths.push(snapshotPath);
    }
  }

  await renderMedia({
    serveUrl,
    composition,
    codec: 'h264',
    crf: settings.crf,
    frameRange: [0, Math.round((durationMs / 1000) * fps) - 1],
    scale: settings.scale,
    outputLocation: outputPath,
    inputProps,
  });

  await fs.writeFile(
    metadataPath,
    `${JSON.stringify(
      {
        command: `remotion render ${DOC_DEMO_COMPOSITION}`,
        renderer: 'remotion',
        rendererVersion: remotionRendererPackage.version,
        sourceCompositionPath: 'src-video/src/compositions/DocDemo/index.tsx',
        sourceRecordingPath: rawPath,
        durationMs,
        fps,
        outputPath,
        snapshotPaths,
        lintResult: null,
        ci: options.ci,
        docker: false,
        quality: options.quality,
      },
      null,
      2,
    )}\n`,
  );

  return { renderer: 'remotion', entryId: entry.id, outputPath, metadataPath };
}
