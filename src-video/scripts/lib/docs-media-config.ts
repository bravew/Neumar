import { DOC_MEDIA_LOCALES, docMedia, docMediaSchema } from '../../docs.config';
import type {
  DocMediaEntry,
  DocMediaLocale,
  DocMediaLocaleText,
} from '../../docs.config';

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

export const VIDEO_ROOT = path.resolve(import.meta.dirname, '../..');
export const RAW_DOCS_DIR = path.join(VIDEO_ROOT, 'public/docs/raw');
export const DOCS_OUT_DIR = path.join(VIDEO_ROOT, 'out/docs');
export const SITE_PUBLIC_DOCS_DIR = path.resolve(
  VIDEO_ROOT,
  '../src-site/apps/web/public/docs',
);
export const SITE_DOCS_CONTENT_DIR = path.resolve(
  VIDEO_ROOT,
  '../src-site/apps/web/content/documentation',
);

export const DEFAULT_DOCS_VIEWPORT = { width: 1440, height: 900 } as const;
export const DEFAULT_LANDING_VIEWPORT = {
  width: 1920,
  height: 1080,
} as const;
export const DEFAULT_VIDEO_MAX_DURATION_MS = 15_000;
export const DESKTOP_DOC_PAGES = [
  'desktop-app',
  'projects',
  'automations',
  'agent-system',
  'design-mode',
  'linear-pipeline',
  'mcp-and-skills',
  'media-generation',
  'memory-system',
  'slash-commands',
  'workspace-security',
  'cloud-storage',
] as const;
export const REQUIRED_DEMO_PAGES = [
  'desktop-app',
  'projects',
  'linear-pipeline',
  'mcp-and-skills',
  'agent-system',
  'design-mode',
  'media-generation',
  'memory-system',
  'slash-commands',
  'workspace-security',
  'cloud-storage',
  'automations',
] as const;

export interface NormalizedCaptureProfile {
  viewport: { width: number; height: number };
  deviceScaleFactor: number;
  colorScheme: 'dark' | 'light' | 'no-preference';
  reducedMotion: 'reduce' | 'no-preference';
  forcedColors: 'active' | 'none';
  recordVideo: {
    size: { width: number; height: number };
  };
}

export interface DocsMediaCliOptions {
  only?: string;
  dryRun: boolean;
  ci: boolean;
}

type NormalizedBase = {
  viewport: { width: number; height: number };
  theme: 'dark' | 'light';
  captureProfile: NormalizedCaptureProfile;
};

export type NormalizedDocMediaEntry =
  | (Extract<DocMediaEntry, { kind: 'image' }> & NormalizedBase)
  | (Extract<DocMediaEntry, { kind: 'video' }> & NormalizedBase);

export type NormalizedDocMediaVideoEntry = Extract<
  NormalizedDocMediaEntry,
  { kind: 'video' }
>;

export function parseDocsMediaCliArgs(
  argv = process.argv.slice(2),
): DocsMediaCliOptions {
  const options: DocsMediaCliOptions = {
    dryRun: false,
    ci: false,
  };

  for (const arg of argv) {
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--ci') {
      options.ci = true;
    } else if (arg.startsWith('--only=')) {
      options.only = arg.slice('--only='.length);
    }
  }

  return options;
}

export function normalizeDocMediaEntry(
  entry: DocMediaEntry,
): NormalizedDocMediaEntry {
  const defaultViewport =
    entry.viewport ??
    (entry.surfaces.includes('landing')
      ? DEFAULT_LANDING_VIEWPORT
      : DEFAULT_DOCS_VIEWPORT);
  const viewport = entry.captureProfile.viewport ?? defaultViewport;
  const deviceScaleFactor = entry.captureProfile.deviceScaleFactor ?? 2;
  const captureProfile: NormalizedCaptureProfile = {
    viewport,
    deviceScaleFactor,
    colorScheme: entry.captureProfile.colorScheme ?? entry.theme,
    reducedMotion: entry.captureProfile.reducedMotion ?? 'reduce',
    forcedColors: entry.captureProfile.forcedColors ?? 'none',
    recordVideo: {
      size: entry.captureProfile.recordVideo?.size ?? {
        width: viewport.width,
        height: viewport.height,
      },
    },
  };
  const theme = captureProfile.colorScheme === 'light' ? 'light' : 'dark';

  if (entry.kind === 'video') {
    return {
      ...entry,
      viewport,
      theme,
      captureProfile,
      renderer: entry.renderer,
      camera: entry.camera,
      budgets: {
        ...entry.budgets,
        maxDurationMs:
          entry.budgets.maxDurationMs ?? DEFAULT_VIDEO_MAX_DURATION_MS,
      },
    };
  }

  return {
    ...entry,
    viewport,
    theme,
    captureProfile,
  };
}

export function localizedText(
  entry: NormalizedDocMediaEntry,
  field: 'alt' | 'caption',
  locale: DocMediaLocale,
) {
  return entry.localized[field]?.[locale] ?? entry[field];
}

export function localizedTranscript(
  entry: NormalizedDocMediaVideoEntry,
  locale: DocMediaLocale,
) {
  return entry.localized.transcript?.[locale] ?? entry.transcript;
}

export function localeTextFromFallback(
  entry: NormalizedDocMediaEntry,
  field: 'alt' | 'caption',
): DocMediaLocaleText {
  return Object.fromEntries(
    DOC_MEDIA_LOCALES.map((locale) => [
      locale,
      localizedText(entry, field, locale),
    ]),
  ) as DocMediaLocaleText;
}

export function transcriptTextFromFallback(
  entry: NormalizedDocMediaVideoEntry,
): DocMediaLocaleText {
  return Object.fromEntries(
    DOC_MEDIA_LOCALES.map((locale) => [
      locale,
      localizedTranscript(entry, locale),
    ]),
  ) as DocMediaLocaleText;
}

export function getDocMediaEntries(
  options: { only?: string } = {},
): NormalizedDocMediaEntry[] {
  const parsed = docMediaSchema.safeParse(docMedia);
  if (!parsed.success) {
    throw new Error(parsed.error.message);
  }

  const normalized = parsed.data.map(normalizeDocMediaEntry);
  validateDocMediaEntries(normalized);

  if (!options.only) {
    return normalized;
  }

  return normalized.filter(
    (entry) =>
      entry.id === options.only ||
      entry.page === options.only ||
      entry.slot === options.only ||
      `${entry.page}.${entry.slot}` === options.only,
  );
}

export function validateDocMediaEntries(entries: NormalizedDocMediaEntry[]) {
  const errors: string[] = [];
  const ids = new Set<string>();
  const slots = new Set<string>();
  const pagesWithImage = new Set<string>();
  const pagesWithRequiredVideo = new Set<string>();

  for (const entry of entries) {
    if (ids.has(entry.id)) {
      errors.push(`Duplicate media id: ${entry.id}`);
    }
    ids.add(entry.id);

    const pageSlot = `${entry.page}/${entry.slot}`;
    if (slots.has(pageSlot)) {
      errors.push(`Duplicate page/slot: ${pageSlot}`);
    }
    slots.add(pageSlot);

    if (entry.kind === 'image' && entry.alt.trim().length === 0) {
      errors.push(`${entry.id}: image entries require alt text`);
    }
    if (entry.kind === 'image') {
      pagesWithImage.add(entry.page);
    }
    if (entry.kind === 'video' && entry.priority === 'required') {
      pagesWithRequiredVideo.add(entry.page);
    }
    if (entry.captureProfile.deviceScaleFactor < 2) {
      errors.push(`${entry.id}: captureProfile.deviceScaleFactor must be >= 2`);
    }
    if (
      entry.captureProfile.recordVideo.size.width !==
        entry.captureProfile.viewport.width ||
      entry.captureProfile.recordVideo.size.height !==
        entry.captureProfile.viewport.height
    ) {
      errors.push(
        `${entry.id}: captureProfile.recordVideo.size must match captureProfile.viewport`,
      );
    }

    for (const step of entry.steps) {
      if (['click', 'fill', 'type'].includes(step.action) && !step.selector) {
        errors.push(`${entry.id}: ${step.label} requires a selector`);
      }
      if (['fill', 'type'].includes(step.action) && !step.value) {
        errors.push(`${entry.id}: ${step.label} requires a value`);
      }
      if (step.action === 'navigate' && !step.url) {
        errors.push(`${entry.id}: ${step.label} requires a url`);
      }
    }

    if (entry.kind === 'video') {
      if (entry.steps.length < 3) {
        errors.push(`${entry.id}: video entries require at least three steps`);
      }
      if (entry.priority === 'required' && entry.camera.zooms.length < 3) {
        errors.push(
          `${entry.id}: required video entries require at least three camera zooms`,
        );
      }

      if (!entry.transcript) {
        errors.push(`${entry.id}: video entries require a transcript`);
      }
      if (!entry.poster) {
        errors.push(`${entry.id}: video entries require a poster`);
      }
      if (!entry.budgets.maxDurationMs) {
        errors.push(`${entry.id}: video entries require a max duration budget`);
      }
      if (!['remotion', 'hyperframes'].includes(entry.renderer.primary)) {
        errors.push(`${entry.id}: invalid primary renderer`);
      }
      if (
        entry.renderer.primary === 'hyperframes' &&
        !entry.renderer.hyperframes?.projectDir &&
        !entry.renderer.hyperframes?.generatedProject
      ) {
        errors.push(
          `${entry.id}: HyperFrames primary entries need projectDir or generatedProject`,
        );
      }
      if (
        entry.renderer.primary === 'hyperframes' &&
        (entry.renderer.hyperframes?.snapshotAtMs.length ?? 0) === 0
      ) {
        errors.push(
          `${entry.id}: HyperFrames primary entries require snapshotAtMs`,
        );
      }
      if (
        entry.renderer.primary === 'hyperframes' &&
        entry.renderer.hyperframes?.docker !== true
      ) {
        errors.push(
          `${entry.id}: HyperFrames primary entries require docker: true`,
        );
      }
    }
  }

  for (const page of DESKTOP_DOC_PAGES) {
    if (!pagesWithImage.has(page)) {
      errors.push(`${page}: missing required desktop-app still image`);
    }
  }

  for (const page of REQUIRED_DEMO_PAGES) {
    if (!pagesWithRequiredVideo.has(page)) {
      errors.push(`${page}: missing required desktop-app demo video`);
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.join('\n'));
  }
}

export function rawEntryDir(entry: Pick<DocMediaEntry, 'page' | 'slot'>) {
  return path.join(RAW_DOCS_DIR, entry.page, entry.slot);
}

export function renderEntryDir(
  renderer: string,
  entry: Pick<DocMediaEntry, 'page' | 'slot'>,
) {
  return path.join(DOCS_OUT_DIR, renderer, entry.page, entry.slot);
}

export function publicEntryDir(entry: Pick<DocMediaEntry, 'page' | 'slot'>) {
  return path.join(SITE_PUBLIC_DOCS_DIR, entry.page, entry.slot);
}

export function publicPathFor(filePath: string) {
  return `/${path.relative(path.dirname(SITE_PUBLIC_DOCS_DIR), filePath).replaceAll(path.sep, '/')}`;
}

export function repoRelativePathFor(filePath: string) {
  return path
    .relative(path.resolve(VIDEO_ROOT, '..'), filePath)
    .replaceAll(path.sep, '/');
}

export async function readJsonFile<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, 'utf8')) as T;
}

export async function pathExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isMainModule() {
  return (
    process.argv[1] &&
    path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  );
}

async function main() {
  const options = parseDocsMediaCliArgs();
  const entries = getDocMediaEntries({ only: options.only });
  if (options.only && entries.length === 0) {
    throw new Error(`No docs media entries match --only=${options.only}`);
  }

  console.log(`Validated ${entries.length} docs media entrie(s).`);
  for (const entry of entries) {
    console.log(`  - ${entry.id} (${entry.kind})`);
  }
}

if (isMainModule()) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
