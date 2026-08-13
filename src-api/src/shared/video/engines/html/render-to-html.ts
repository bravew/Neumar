import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createLogger } from '@/shared/utils/logger';

import type { HtmlSceneOutput } from '../types';
import { HtmlEngineError } from './errors';

export type { HtmlSceneOutput };

/**
 * Refinement returned by this module — `buildHtmlScene` always populates the
 * `injectionNonce` field, so callers (e.g. the adapter's `inputHash`) can
 * read it without a defensive non-null assertion. Non-html engines that
 * implement `HtmlSceneOutput` may leave the field undefined.
 */
export interface BuiltHtmlScene extends HtmlSceneOutput {
  injectionNonce: string;
}

const logger = createLogger('VideoHtmlRenderToHtml');

// Single-frame HTML scene builder for the HTML render engine.
//
// Reads a template's `source/index.html`, injects two stable globals
// (`window.__NEUMA_VARS__` and `window.__NEUMA_DURATION__`) immediately
// before `</body>` so author code can read them, and writes a
// self-contained file to the scene's working directory.
//
// "Self-contained" here means the output HTML is a single file plus any
// referenced bundle assets the template ships alongside `source/index.html`
// (e.g. fonts, sprites). The capture pipeline file:// loads this and
// nothing reaches the network at render time.
//
// Variable globals are renamed from html-video's `__HV_VARS__` to
// `__NEUMA_VARS__` per dev-doc/html-video/06-05/01-html-render-engine-and-adapter.md
// § 2 — Neuma-rename the injected globals.

export interface RenderToHtmlOptions {
  /** Path to the template's `source/index.html` (or arbitrary entry). */
  templateSourcePath: string;
  /** Variables for `window.__NEUMA_VARS__`. */
  variables?: Record<string, unknown>;
  /** Frame duration in seconds for `window.__NEUMA_DURATION__`. */
  durationSec: number;
  /** Output directory; the scene HTML is written under it. */
  outDir: string;
}

// `HtmlSceneOutput` is defined canonically in `engines/types.ts` and
// re-exported above; both the engine adapter contract and this module's
// callers see the same shape (including the optional `injectionNonce` field
// that this builder populates).

const INJECTION_MARKER = '<!-- neuma:html-engine-injection -->';

export async function buildHtmlScene(
  options: RenderToHtmlOptions,
): Promise<BuiltHtmlScene> {
  const { templateSourcePath, variables, durationSec, outDir } = options;

  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new HtmlEngineError(
      'duration-out-of-range',
      `durationSec must be > 0 (got ${durationSec})`,
    );
  }

  let sourceHtml: string;
  try {
    sourceHtml = await fs.readFile(templateSourcePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new HtmlEngineError(
        'template-source-missing',
        `Template source not found: ${templateSourcePath}`,
        err,
      );
    }
    throw err;
  }

  const nonce = randomBytes(16).toString('hex');
  const injection = buildInjection({ variables, durationSec, nonce });

  // Inject immediately before </body> when present; otherwise append.
  const injected = sourceHtml.includes('</body>')
    ? sourceHtml.replace(/<\/body>/i, `${injection}\n</body>`)
    : `${sourceHtml}\n${injection}`;

  await fs.mkdir(outDir, { recursive: true });

  // Copy sibling asset files so a `file://` load resolves relative refs.
  const referencedAssets: string[] = [];
  const templateDir = path.dirname(templateSourcePath);
  try {
    const entries = await fs.readdir(templateDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (path.basename(templateSourcePath) === entry.name) continue;
      const srcPath = path.join(templateDir, entry.name);
      const dstPath = path.join(outDir, entry.name);
      await fs.copyFile(srcPath, dstPath);
      referencedAssets.push(entry.name);
    }
  } catch (err) {
    // Bundle assets are optional — a template with just an entry HTML is fine,
    // but a real fs error (EACCES, EMFILE, etc.) silently producing a render
    // missing every sibling asset is the harder bug to debug. Log so the cause
    // surfaces in support transcripts even when the render itself "succeeds".
    logger.warn(
      `sibling-asset copy skipped under ${templateDir}: ${(err as Error).message}`,
    );
  }

  const htmlPath = path.join(outDir, 'scene.html');
  await fs.writeFile(htmlPath, injected, 'utf8');

  return { htmlPath, referencedAssets, durationSec, injectionNonce: nonce };
}

function buildInjection(opts: {
  variables?: Record<string, unknown>;
  durationSec: number;
  nonce: string;
}): string {
  const vars = JSON.stringify(opts.variables ?? {});
  // The script body is JSON-serialised content interpolated inside `<script>`
  // tags. JSON.stringify already escapes the inner double-quotes; only
  // `</script` sequences would close the tag prematurely — neutralise them.
  const safeVars = vars.replace(/<\/script/gi, '<\\/script');
  return [
    INJECTION_MARKER,
    `<script nonce="${opts.nonce}">`,
    '(function(){',
    `  try { Object.defineProperty(window, '__NEUMA_VARS__', { value: Object.freeze(${safeVars}), writable: false, configurable: false }); } catch (_) { window.__NEUMA_VARS__ = ${safeVars}; }`,
    `  try { Object.defineProperty(window, '__NEUMA_DURATION__', { value: ${opts.durationSec}, writable: false, configurable: false }); } catch (_) { window.__NEUMA_DURATION__ = ${opts.durationSec}; }`,
    '})();',
    '</script>',
  ].join('\n');
}
