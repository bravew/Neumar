import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import { enableTailwind } from '@remotion/tailwind';

import { features } from '../src/data/features';

import fs from 'fs/promises';
import path from 'path';

const OUT_DIR = path.resolve(import.meta.dirname, '../out');
const ENTRY_POINT = path.resolve(import.meta.dirname, '../src/index.ts');

interface RenderJob {
  compositionId: string;
  outputFile: string;
  codec: 'h264' | 'vp9' | 'gif';
  crf?: number;
  scale?: number;
  inputProps?: Record<string, unknown>;
}

// Render preset: check RENDER_PRESET env var
const preset = process.env.RENDER_PRESET ?? 'final';
const presetConfig = {
  preview: { scale: 0.5, crf: 28 },
  draft: { scale: 1, crf: 23 },
  final: { scale: 1, crf: 18 },
}[preset] ?? { scale: 1, crf: 18 };

const jobs: RenderJob[] = [
  // Hero demo
  {
    compositionId: 'HeroDemo',
    outputFile: 'hero-demo-1080p.mp4',
    codec: 'h264',
    crf: presetConfig.crf,
    scale: presetConfig.scale,
  },
  // Feature clips
  ...features.map((f) => ({
    compositionId: 'FeatureClip',
    outputFile: `feature-${f.featureId}.mp4`,
    codec: 'h264' as const,
    crf: presetConfig.crf,
    scale: presetConfig.scale,
    inputProps: f,
  })),
  // Social formats
  {
    compositionId: 'SocialClip-Square',
    outputFile: 'social-square.mp4',
    codec: 'h264',
    crf: 20,
    scale: presetConfig.scale,
  },
  {
    compositionId: 'SocialClip-Vertical',
    outputFile: 'social-vertical.mp4',
    codec: 'h264',
    crf: 20,
    scale: presetConfig.scale,
  },
  {
    compositionId: 'SocialClip-Landscape',
    outputFile: 'social-landscape.mp4',
    codec: 'h264',
    crf: 20,
    scale: presetConfig.scale,
  },
  // GitHub preview (GIF)
  {
    compositionId: 'GithubPreview',
    outputFile: 'github-preview.gif',
    codec: 'gif',
  },
  // Changelog
  {
    compositionId: 'ChangelogVideo',
    outputFile: 'changelog-latest.mp4',
    codec: 'h264',
    crf: presetConfig.crf,
    scale: presetConfig.scale,
  },
];

async function renderAll() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  // Filter by COMPOSITION env var if set
  const targetId = process.env.COMPOSITION;
  const toRender =
    targetId && targetId !== 'all'
      ? jobs.filter((j) => j.compositionId === targetId)
      : jobs;

  if (toRender.length === 0) {
    console.error(`No matching composition: ${targetId}`);
    process.exit(1);
  }

  console.log(`Bundling Remotion project...`);
  const bundleLocation = await bundle({
    entryPoint: ENTRY_POINT,
    webpackOverride: (config) => enableTailwind(config),
  });

  console.log(
    `Rendering ${toRender.length} compositions (preset: ${preset})...\n`,
  );

  for (const job of toRender) {
    const start = Date.now();
    console.log(`  > ${job.compositionId} -> ${job.outputFile}`);

    const composition = await selectComposition({
      serveUrl: bundleLocation,
      id: job.compositionId,
      inputProps: job.inputProps ?? {},
    });

    await renderMedia({
      serveUrl: bundleLocation,
      composition,
      codec: job.codec,
      outputLocation: path.join(OUT_DIR, job.outputFile),
      crf: job.crf,
      scale: job.scale,
      onProgress: ({ progress }) => {
        const pct = Math.round(progress * 100);
        if (pct % 25 === 0) {
          process.stdout.write(`    ${pct}%\r`);
        }
      },
    });

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`    Done in ${elapsed}s`);
  }

  console.log(`\nAll ${toRender.length} videos rendered to ${OUT_DIR}`);
}

renderAll().catch((e) => {
  console.error('Render failed:', e);
  process.exit(1);
});
