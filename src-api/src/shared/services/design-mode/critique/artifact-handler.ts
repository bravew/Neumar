import fs from 'node:fs/promises';
import path from 'node:path';

import { resolveProjectPath } from '../fs';
import type { DesignJuryRun } from '../types';
import { critiqueArtifactExtensionForMediaType } from './artifact-writer';
import { readPersistedDesignJuryRun } from './design-jury';

const SAFE_PROJECT_ID_RE = /^[\w][\w.-]*$/;
const SAFE_RUN_ID_RE = /^[\w][\w.-]*$/;

export class CritiqueArtifactNotFoundError extends Error {
  constructor() {
    super('Critique artifact not found');
    this.name = 'CritiqueArtifactNotFoundError';
  }
}

export class CritiqueArtifactBadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CritiqueArtifactBadRequestError';
  }
}

export async function buildCritiqueArtifactResponse(
  projectId: string,
  runId: string,
): Promise<Response> {
  if (!SAFE_PROJECT_ID_RE.test(projectId) || !SAFE_RUN_ID_RE.test(runId)) {
    throw new CritiqueArtifactBadRequestError('Invalid critique artifact id');
  }

  const run = await readPersistedDesignJuryRun(projectId, runId);
  if (!run || run.projectId !== projectId || !run.artifactRef) {
    throw new CritiqueArtifactNotFoundError();
  }

  const relativePath = critiqueArtifactPath(run);
  const resolved = resolveProjectPath(projectId, relativePath);
  const stat = await fs.stat(resolved.absolutePath).catch(() => null);
  if (!stat?.isFile()) throw new CritiqueArtifactNotFoundError();

  const data = await fs.readFile(resolved.absolutePath);
  const filename = path.basename(resolved.relativePath).replace(/"/g, '');
  return new Response(data, {
    headers: {
      'Content-Type': run.artifactRef.mediaType,
      'Content-Length': String(stat.size),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `inline; filename="${filename}"`,
    },
  });
}

function critiqueArtifactPath(run: DesignJuryRun): string {
  if (!run.artifactRef) throw new CritiqueArtifactNotFoundError();
  return `critique/${run.id}/artifact.${critiqueArtifactExtensionForMediaType(
    run.artifactRef.mediaType,
  )}`;
}
