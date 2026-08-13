import fs from 'node:fs/promises';
import path from 'node:path';

import {
  getProject,
  getVideoProjectDir,
  getVideoProjectRoot,
  writeProject,
} from '../store';
import type { AspectRatio, RenderOutput, VideoProject } from '../types';
import { smoothSaliency } from './tracker';

export async function reframeProject(
  projectId: string,
  aspectRatio: Extract<AspectRatio, '9:16' | '1:1' | '4:5'>,
): Promise<{ project: VideoProject; output: RenderOutput }> {
  const project = await getProject(projectId);
  const master = project.outputs?.find(
    (output) => output.aspectRatio === '16:9',
  );
  if (!master) throw new Error('16:9 master render required before reframe');
  const projectRoot = getVideoProjectRoot(projectId);
  const projectDir = getVideoProjectDir(projectId);
  await fs.mkdir(projectDir, { recursive: true });
  const outPath = path.join(
    projectDir,
    `reframe-${aspectRatio.replace(':', 'x')}.json`,
  );
  const saliency = smoothSaliency([
    { x: 0.5, y: 0.5, score: 1 },
    { x: aspectRatio === '9:16' ? 0.45 : 0.5, y: 0.5, score: 0.9 },
  ]);
  await fs.writeFile(
    outPath,
    `${JSON.stringify({ source: master.path, aspectRatio, saliency }, null, 2)}\n`,
  );
  const output: RenderOutput = {
    aspectRatio,
    path: path.relative(projectRoot, outPath),
    durationSec: master.durationSec,
    fileSize: (await fs.stat(outPath)).size,
    codec: 'json-reframe-plan',
  };
  const next = {
    ...project,
    outputs: [
      ...(project.outputs ?? []).filter(
        (item) => item.aspectRatio !== aspectRatio,
      ),
      output,
    ],
    updatedAt: new Date().toISOString(),
  };
  await writeProject(next);
  return { project: next, output };
}
