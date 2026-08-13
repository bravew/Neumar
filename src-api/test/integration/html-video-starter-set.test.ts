import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import {
  _resetVideoEngineRegistry,
  ensureBuiltinVideoEnginesRegistered,
} from '@/shared/video/engines';
import { schemaToFormSpec } from '@/shared/video/templates/form-mapper';
import {
  _resetTemplateGalleryCache,
  loadTemplateGallery,
} from '@/shared/video/templates/gallery-loader';
import { lintTemplateProvenance } from '@/shared/video/templates/provenance-lint';
import {
  inspectTemplate,
  searchTemplates,
} from '@/shared/video/templates/search';

// Phase 3 M5 — end-to-end smoke on the curated starter templates that
// ship under branding/default/video-templates/. Loads them via the real
// gallery loader, verifies the provenance lint, the form mapper, the
// search filters, and the inspect tool.

const REPO_ROOT = path.resolve(
  fileURLToPath(import.meta.url),
  '..',
  '..',
  '..',
  '..',
);
const BRANDING_ROOT = path.join(
  REPO_ROOT,
  'branding',
  'default',
  'video-templates',
);

const EXPECTED_STARTERS = [
  'frame-bold-poster',
  'frame-bold-signal',
  'frame-build-minimal',
  'frame-bullet-list',
  'frame-clean-title',
  'frame-creative-voltage',
  'frame-data-bars',
  'frame-data-rollup',
  'frame-electric-studio',
  'frame-quote-card',
  'frame-radial-node-map',
  'frame-swiss-stat',
].sort();

let gallery: Awaited<ReturnType<typeof loadTemplateGallery>>;

beforeAll(async () => {
  _resetVideoEngineRegistry();
  ensureBuiltinVideoEnginesRegistered();
  _resetTemplateGalleryCache();
  // Single filesystem scan shared across the suite — every `it` block in
  // the previous version called loadTemplateGallery() with `ttlMs: 0`,
  // producing one scan per test for the same content (bot review #236).
  gallery = await loadTemplateGallery({
    userRoot: '/tmp/__no_such_user_root__',
    brandingRoot: BRANDING_ROOT,
    ttlMs: 0,
  });
});

describe('starter template set', () => {
  it('loads all templates from the branded default root with no issues', () => {
    expect(gallery.issues).toEqual([]);
    expect(gallery.templates.map((t) => t.id).sort()).toEqual(
      EXPECTED_STARTERS,
    );
  });

  it('each template passes the provenance lint with no errors', () => {
    for (const t of gallery.templates) {
      const lint = lintTemplateProvenance(t.metadata);
      expect(lint.ok, `${t.id}: ${JSON.stringify(lint.issues)}`).toBe(true);
    }
  });

  it('each template produces a non-empty FormSpec', () => {
    for (const t of gallery.templates) {
      const spec = schemaToFormSpec(t.metadata.inputs.schema);
      expect(spec.fields.length, `${t.id} has fields`).toBeGreaterThan(0);
    }
  });

  it('searchTemplates with default filters returns all starters', () => {
    const result = searchTemplates(gallery.templates);
    expect(result.templates.map((t) => t.id).sort()).toEqual(EXPECTED_STARTERS);
    expect(result.filteredOut).toEqual([]);
  });

  it('requireCommercialUse keeps all starters (they are Apache-2.0)', () => {
    const result = searchTemplates(gallery.templates, {
      requireCommercialUse: true,
    });
    expect(result.templates.map((t) => t.id).sort()).toEqual(EXPECTED_STARTERS);
  });

  it('search by category narrows correctly', () => {
    const result = searchTemplates(gallery.templates, { category: 'data-viz' });
    expect(result.templates.map((t) => t.id).sort()).toEqual([
      'frame-data-bars',
      'frame-data-rollup',
      'frame-swiss-stat',
    ]);
  });

  it('inspectTemplate returns metadata + FormSpec + in-house provenance', () => {
    const titleTemplate = gallery.templates.find(
      (t) => t.id === 'frame-clean-title',
    );
    expect(titleTemplate).toBeDefined();
    const inspection = inspectTemplate(titleTemplate!);
    expect(inspection.metadata.id).toBe('frame-clean-title');
    expect(inspection.formSpec.fields.length).toBeGreaterThan(0);
    expect(inspection.examples.length).toBeGreaterThan(0);
    expect(inspection.provenanceStatus).toBe('in-house');
  });
});
