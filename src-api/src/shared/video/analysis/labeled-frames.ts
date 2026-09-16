import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';

import {
  runFFmpeg,
  validateInputFile,
  validatePath,
} from '@/shared/services/ffmpeg';

export const DEFAULT_LABEL_HEIGHT = 28;

export interface LabeledFrameSample {
  atMs: number;
  wordLabel?: string;
}

export interface LabeledGridResult {
  paths: string[];
  columns: number;
  rows: number;
  cellWidth: number;
  pages: number;
  sampledAtMs: number[];
}

export async function buildLabeledGrid(input: {
  mediaPath: string;
  workDir: string;
  destinationDir: string;
  filePrefix: string;
  samples: LabeledFrameSample[];
  columns: number;
  rows?: number;
  cellWidth: number;
  labelHeight?: number;
}): Promise<LabeledGridResult> {
  const mediaPath = validateInputFile(input.mediaPath, input.workDir, {
    allowExternalMedia: true,
  });
  const destinationDir = validatePath(
    input.destinationDir,
    input.workDir,
    'write',
  );
  const columns = Math.max(1, Math.floor(input.columns));
  const cellWidth = Math.max(32, Math.floor(input.cellWidth));
  const labelHeight = input.labelHeight ?? DEFAULT_LABEL_HEIGHT;
  const samples = [...input.samples].sort(
    (left, right) => left.atMs - right.atMs,
  );
  if (samples.length === 0) {
    throw new Error('Labeled grid requires at least one sample.');
  }
  const rows = Math.max(
    1,
    Math.floor(input.rows ?? Math.ceil(samples.length / columns)),
  );
  const pageSize = columns * rows;
  const pages = Math.ceil(samples.length / pageSize);
  await fs.mkdir(destinationDir, { recursive: true });

  const paths: string[] = [];
  for (let page = 0; page < pages; page += 1) {
    const pageSamples = samples.slice(page * pageSize, (page + 1) * pageSize);
    const dest = path.join(
      destinationDir,
      `${input.filePrefix}-p${page + 1}.png`,
    );
    if (existsSync(dest)) {
      throw new Error(`Reference media already exists: ${path.basename(dest)}`);
    }
    const staging = await fs.mkdtemp(path.join(destinationDir, '.stage-'));
    try {
      const cells = await Promise.all(
        pageSamples.map((sample) =>
          renderLabeledCell({
            mediaPath,
            staging,
            sample,
            cellWidth,
            labelHeight,
          }),
        ),
      );
      while (cells.length < pageSize) {
        cells.push(
          await blankCell(
            cellWidth,
            cells[0]?.height ?? cellWidth + labelHeight,
          ),
        );
      }
      const tiled = await tileCells(cells, columns, rows);
      const staged = path.join(staging, path.basename(dest));
      await fs.writeFile(staged, tiled);
      await fs.rename(staged, dest);
      paths.push(dest);
    } catch (error) {
      await fs.rm(staging, { recursive: true, force: true });
      throw error;
    }
    await fs.rm(staging, { recursive: true, force: true });
  }

  return {
    paths,
    columns,
    rows,
    cellWidth,
    pages,
    sampledAtMs: samples.map((sample) => sample.atMs),
  };
}

async function renderLabeledCell(input: {
  mediaPath: string;
  staging: string;
  sample: LabeledFrameSample;
  cellWidth: number;
  labelHeight: number;
}): Promise<{ buffer: Buffer; height: number }> {
  const framePath = path.join(
    input.staging,
    `frame-${input.sample.atMs}-${randomUUID().slice(0, 8)}.png`,
  );
  const result = await runFFmpeg([
    '-i',
    input.mediaPath,
    '-ss',
    (input.sample.atMs / 1000).toFixed(3),
    '-frames:v',
    '1',
    '-vf',
    `scale=${input.cellWidth}:-2`,
    '-an',
    framePath,
  ]);
  if (result.exitCode !== 0 || !existsSync(framePath)) {
    throw new Error(
      `FFmpeg frame extract failed: ${result.stderr.slice(-300)}`,
    );
  }
  const frame = sharp(framePath).resize({ width: input.cellWidth });
  const meta = await frame.metadata();
  const frameHeight = meta.height ?? input.cellWidth;
  const timeLabel = formatTimecode(input.sample.atMs);
  const word = input.sample.wordLabel?.trim() ?? '';
  const labelText = word ? `${timeLabel}  ${word}` : timeLabel;
  const labelSvg = Buffer.from(
    `<svg width="${input.cellWidth}" height="${input.labelHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#111111"/>
      <text x="8" y="${Math.round(input.labelHeight * 0.7)}" fill="#f5f5f5" font-size="12" font-family="sans-serif">${escapeXml(labelText)}</text>
    </svg>`,
  );
  const composed = await sharp({
    create: {
      width: input.cellWidth,
      height: frameHeight + input.labelHeight,
      channels: 4,
      background: { r: 17, g: 17, b: 17, alpha: 1 },
    },
  })
    .composite([
      { input: await frame.png().toBuffer(), top: 0, left: 0 },
      { input: labelSvg, top: frameHeight, left: 0 },
    ])
    .png()
    .toBuffer();
  return { buffer: composed, height: frameHeight + input.labelHeight };
}

async function blankCell(
  width: number,
  height: number,
): Promise<{ buffer: Buffer; height: number }> {
  const buffer = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
  return { buffer, height };
}

async function tileCells(
  cells: Array<{ buffer: Buffer; height: number }>,
  columns: number,
  rows: number,
): Promise<Buffer> {
  const cellWidth = (await sharp(cells[0]!.buffer).metadata()).width ?? 320;
  const cellHeight = Math.max(...cells.map((cell) => cell.height));
  const composites = cells.map((cell, index) => ({
    input: cell.buffer,
    left: (index % columns) * cellWidth,
    top: Math.floor(index / columns) * cellHeight,
  }));
  return sharp({
    create: {
      width: cellWidth * columns,
      height: cellHeight * rows,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 1 },
    },
  })
    .composite(composites)
    .png()
    .toBuffer();
}

function formatTimecode(atMs: number): string {
  const clamped = Math.max(0, Math.round(atMs));
  const minutes = Math.floor(clamped / 60000);
  const seconds = Math.floor((clamped % 60000) / 1000);
  const millis = clamped % 1000;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
