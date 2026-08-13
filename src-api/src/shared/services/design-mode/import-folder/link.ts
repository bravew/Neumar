import path from 'node:path';

import { createDesignProject } from '../projects';
import type { DesignSurface } from '../types';
import { validateImportFolder } from './validate';

export async function importDesignFolder(input: {
  path: string;
  title?: string;
  surface?: DesignSurface;
}) {
  const summary = await validateImportFolder(input.path);
  const project = await createDesignProject({
    title: input.title?.trim() || path.basename(summary.path),
    surface: input.surface ?? 'prototype',
    linkedContextDirs: [summary.path],
    brief: {
      importedFolder: summary.path,
      importedFileCount: summary.fileCount,
      importedBytes: summary.totalBytes,
    },
  });
  return { project, summary };
}
