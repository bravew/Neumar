import fs from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';

import { z } from 'zod';

import { APP_DATA_DIR } from '@/config/branding';

import { createLogger } from '@/shared/utils/logger';

import { registerExtension } from './registry.js';

const logger = createLogger('ExtensionLoader');

const ManifestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().optional(),
  author: z.string().optional(),
  contributes: z.object({
    skills: z
      .array(
        z.object({
          id: z.string(),
          name: z.string(),
          description: z.string(),
          entryPoint: z.string(),
        }),
      )
      .optional(),
    commands: z
      .array(
        z.object({
          id: z.string(),
          name: z.string(),
          description: z.string(),
          entryPoint: z.string(),
        }),
      )
      .optional(),
    settingsTabs: z
      .array(
        z.object({
          id: z.string(),
          label: z.string(),
          entryPoint: z.string(),
        }),
      )
      .optional(),
  }),
});

export async function scanExtensions(): Promise<void> {
  const extensionsDir = join(homedir(), APP_DATA_DIR, 'extensions');

  let entries: string[];
  try {
    entries = await fs.readdir(extensionsDir);
  } catch {
    logger.info(
      `Extensions directory not found, skipping scan: ${extensionsDir}`,
    );
    return;
  }

  let loaded = 0;
  for (const entry of entries) {
    const extPath = join(extensionsDir, entry);
    const manifestPath = join(extPath, 'manifest.json');

    try {
      const stat = await fs.stat(extPath);
      if (!stat.isDirectory()) continue;

      const content = await fs.readFile(manifestPath, 'utf-8');
      const raw = JSON.parse(content) as unknown;
      const manifest = ManifestSchema.parse(raw);

      registerExtension(manifest, extPath);
      logger.info(`Loaded extension: ${manifest.id} v${manifest.version}`);
      loaded++;
    } catch (err) {
      logger.warn(`Skipping invalid extension at ${extPath}:`, err);
    }
  }

  logger.info(`Extension scan complete: ${loaded} extension(s) loaded`);
}
