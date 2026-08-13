import { DOC_MEDIA_LOCALES } from '../docs.config';
import { readManifest } from './lib/docs-manifest';
import type { DocsMediaManifestAsset } from './lib/docs-manifest';
import {
  DESKTOP_DOC_PAGES,
  getDocMediaEntries,
  parseDocsMediaCliArgs,
  SITE_DOCS_CONTENT_DIR,
  SITE_PUBLIC_DOCS_DIR,
} from './lib/docs-media-config';

import fs from 'fs/promises';
import path from 'path';

function publicFilePath(publicPath: string) {
  return path.join(
    path.dirname(SITE_PUBLIC_DOCS_DIR),
    publicPath.replace(/^\//, ''),
  );
}

function publicPathsForAsset(asset: DocsMediaManifestAsset) {
  const paths: string[] = [];
  for (const value of Object.values(asset.paths)) {
    if (!value) continue;
    if (typeof value === 'string') {
      paths.push(value);
    } else {
      paths.push(...Object.values(value));
    }
  }
  return paths;
}

async function pathExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function collectFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = await Promise.all(
      entries.map(async (entry) => {
        const filePath = path.join(dir, entry.name);
        return entry.isDirectory() ? collectFiles(filePath) : [filePath];
      }),
    );
    return files.flat();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function readMarkdocReferences(locale: string, page: string) {
  const docsPath = path.join(
    SITE_DOCS_CONTENT_DIR,
    `${locale}/desktop-app`,
    `${page}.mdoc`,
  );
  if (!(await pathExists(docsPath))) return [];

  const source = await fs.readFile(docsPath, 'utf8');
  return [...source.matchAll(/{%\s*(figure|demo)\s+[^%]*id=["']([^"']+)["']/g)]
    .map((match) => ({
      tag: match[1] ?? '',
      id: match[2] ?? '',
      file: docsPath,
    }))
    .filter((reference) => reference.id.length > 0);
}

async function validateAssetFiles(
  asset: DocsMediaManifestAsset,
  errors: string[],
) {
  for (const [name, value] of Object.entries(asset.paths)) {
    const paths = typeof value === 'string' ? { [name]: value } : value;
    if (!paths) continue;
    for (const [localeOrName, publicPath] of Object.entries(paths)) {
      if (!publicPath) continue;
      const filePath = publicFilePath(publicPath);
      if (!(await pathExists(filePath))) {
        errors.push(
          `${asset.id}: missing ${name}.${localeOrName} at ${publicPath}`,
        );
      }
    }
  }

  for (const locale of DOC_MEDIA_LOCALES) {
    if (!asset.availableLocales.includes(locale)) {
      errors.push(`${asset.id}: missing locale ${locale}`);
    }
    if (!asset.alt[locale]) {
      errors.push(`${asset.id}: missing localized alt for ${locale}`);
    }
    if (!asset.caption[locale]) {
      errors.push(`${asset.id}: missing localized caption for ${locale}`);
    }
  }

  if (asset.kind === 'video') {
    if (!asset.paths.poster) {
      errors.push(`${asset.id}: video asset requires a poster`);
    }
    if (!asset.paths.captions) {
      errors.push(`${asset.id}: video asset requires captions`);
    }
    if (!asset.paths.transcripts || !asset.hasTranscript) {
      errors.push(`${asset.id}: video asset requires transcripts`);
    }
    for (const locale of DOC_MEDIA_LOCALES) {
      if (asset.kind === 'video' && !asset.paths.captions?.[locale]) {
        errors.push(`${asset.id}: missing caption track for ${locale}`);
      }
      if (asset.kind === 'video' && !asset.paths.transcripts?.[locale]) {
        errors.push(`${asset.id}: missing transcript for ${locale}`);
      }
    }
  }
}

async function main() {
  const options = parseDocsMediaCliArgs();
  const configEntries = getDocMediaEntries({ only: options.only });
  const allConfigEntries = getDocMediaEntries();
  const manifest = await readManifest();
  const errors: string[] = [];
  const configuredIds = new Set(configEntries.map((entry) => entry.id));
  const manifestById = new Map(
    manifest.assets.map((asset) => [asset.id, asset]),
  );

  for (const entry of configEntries) {
    const asset = manifestById.get(entry.id);
    if (!asset) {
      errors.push(`${entry.id}: missing manifest asset`);
      continue;
    }

    await validateAssetFiles(asset, errors);

    const oversized = Object.entries(asset.bytes).filter(
      ([, bytes]) => bytes > entry.budgets.maxBytes,
    );
    if (oversized.length > 0) {
      errors.push(
        `${entry.id}: asset file exceeds budget ${entry.budgets.maxBytes}: ${oversized
          .map(([name, bytes]) => `${name}=${bytes}`)
          .join(', ')}`,
      );
    }

    if (
      entry.kind === 'video' &&
      asset.durationMs &&
      asset.durationMs > (entry.budgets.maxDurationMs ?? 15_000)
    ) {
      errors.push(`${entry.id}: duration exceeds configured max duration`);
    }

    if (
      entry.kind === 'video' &&
      entry.renderer.primary === 'hyperframes' &&
      (!asset.render?.metadataPaths.hyperframes ||
        asset.render.comparisonArtifactPaths.length === 0)
    ) {
      errors.push(
        `${entry.id}: HyperFrames primary asset needs metadata and snapshots`,
      );
    }
  }

  for (const page of new Set(configEntries.map((entry) => entry.page))) {
    const referencesByLocale = (
      await Promise.all(
        DOC_MEDIA_LOCALES.map((locale) => readMarkdocReferences(locale, page)),
      )
    ).flat();
    for (const reference of referencesByLocale) {
      if (!manifestById.has(reference.id)) {
        errors.push(
          `${reference.file}: ${reference.tag} references stale media id ${reference.id}`,
        );
      }
      if (options.only && !configuredIds.has(reference.id)) {
        errors.push(
          `${reference.file}: ${reference.tag} references ${reference.id}, outside --only=${options.only}`,
        );
      }
    }
  }

  const coveragePages = options.only
    ? [...new Set(configEntries.map((entry) => entry.page))]
    : DESKTOP_DOC_PAGES;
  for (const page of coveragePages) {
    const englishReferences = await readMarkdocReferences('en', page);
    const englishIds = englishReferences
      .filter((reference) => manifestById.has(reference.id))
      .map((reference) => `${reference.tag}:${reference.id}`)
      .sort();

    for (const locale of DOC_MEDIA_LOCALES) {
      const references = await readMarkdocReferences(locale, page);
      const hasManifestBackedFigure = references.some(
        (reference) =>
          reference.tag === 'figure' && manifestById.has(reference.id),
      );
      if (!hasManifestBackedFigure) {
        errors.push(
          `${path.join(SITE_DOCS_CONTENT_DIR, `${locale}/desktop-app`, `${page}.mdoc`)}: missing manifest-backed figure`,
        );
      }

      const localeIds = references
        .filter((reference) => manifestById.has(reference.id))
        .map((reference) => `${reference.tag}:${reference.id}`)
        .sort();
      if (locale !== 'en' && localeIds.join('|') !== englishIds.join('|')) {
        errors.push(
          `${page}: ${locale} media references differ from en (${localeIds.join(
            ', ',
          )} !== ${englishIds.join(', ')})`,
        );
      }
    }
  }

  const configuredSlots = new Set(
    allConfigEntries.map((entry) => `${entry.page}/${entry.slot}`),
  );
  const referencedPublicPaths = new Set(
    manifest.assets.flatMap((asset) => publicPathsForAsset(asset)),
  );
  for (const file of await collectFiles(SITE_PUBLIC_DOCS_DIR)) {
    if (file === path.join(SITE_PUBLIC_DOCS_DIR, 'manifest.json')) continue;
    const relative = path.relative(SITE_PUBLIC_DOCS_DIR, file);
    const [page, slot] = relative.split(path.sep);
    if (!page || !slot) continue;
    if (!configuredSlots.has(`${page}/${slot}`)) {
      errors.push(`orphaned managed docs media file: ${relative}`);
      continue;
    }
    const publicPath = `/docs/${relative.replaceAll(path.sep, '/')}`;
    if (!referencedPublicPaths.has(publicPath)) {
      errors.push(`unreferenced managed docs media file: ${relative}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.join('\n'));
  }

  console.log(`Docs media check passed for ${configEntries.length} entrie(s).`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
