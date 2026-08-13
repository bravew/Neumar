import { readManifest, writeManifest } from './lib/docs-manifest';
import {
  getDocMediaEntries,
  parseDocsMediaCliArgs,
  publicEntryDir,
  SITE_PUBLIC_DOCS_DIR,
} from './lib/docs-media-config';
import { optimizeImage, optimizeVideo } from './lib/media-optimizer';

import fs from 'fs/promises';
import path from 'path';

async function pruneManagedPublicDocs(configuredSlots: Set<string>) {
  try {
    const pages = await fs.readdir(SITE_PUBLIC_DOCS_DIR, {
      withFileTypes: true,
    });
    for (const page of pages) {
      if (!page.isDirectory()) continue;
      const pageDir = path.join(SITE_PUBLIC_DOCS_DIR, page.name);
      const slots = await fs.readdir(pageDir, { withFileTypes: true });
      for (const slot of slots) {
        if (!slot.isDirectory()) continue;
        const key = `${page.name}/${slot.name}`;
        if (!configuredSlots.has(key)) {
          await fs.rm(path.join(pageDir, slot.name), {
            recursive: true,
            force: true,
          });
        }
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

async function main() {
  const options = parseDocsMediaCliArgs();
  const entries = getDocMediaEntries({ only: options.only });
  if (options.only && entries.length === 0) {
    throw new Error(`No docs media entries match --only=${options.only}`);
  }

  const configuredSlots = new Set(
    getDocMediaEntries().map((entry) => `${entry.page}/${entry.slot}`),
  );

  if (options.dryRun) {
    console.log(`Planned docs optimization (${entries.length}):`);
    for (const entry of entries) {
      console.log(`  - ${entry.id} -> ${publicEntryDir(entry)}`);
    }
    return;
  }

  const existing = await readManifest();
  const replacingIds = new Set(entries.map((entry) => entry.id));
  const nextAssets = existing.assets.filter(
    (asset) => !replacingIds.has(asset.id),
  );

  for (const entry of entries) {
    const asset =
      entry.kind === 'image'
        ? await optimizeImage(entry)
        : await optimizeVideo(entry);
    nextAssets.push(asset);
    console.log(`Optimized ${entry.id}`);
  }

  await pruneManagedPublicDocs(configuredSlots);
  await writeManifest(nextAssets);
  console.log(`Wrote docs media manifest with ${nextAssets.length} asset(s).`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
