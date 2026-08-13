import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('DesignMode PDF export input', () => {
  let tempHome = '';
  let workDir = '';

  beforeEach(async () => {
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-pdf-home-'));
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-pdf-work-'));
    vi.stubEnv('HOME', tempHome);
    const { saveSetting } = await import('@/shared/db/operations');
    saveSetting('workDir', workDir);
  });

  afterEach(async () => {
    const { closeDatabase } = await import('@/shared/db');
    closeDatabase();
    vi.unstubAllEnvs();
    await fs.rm(tempHome, { recursive: true, force: true });
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('wraps an HTML artifact with base href, print CSS, and a PDF filename', async () => {
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { writeProjectTextFile } =
      await import('@/shared/services/design-mode/fs');
    const { buildArtifactPdfInput } =
      await import('@/shared/services/design-mode/pdf-export/build-input');
    const project = await createDesignProject({
      title: 'Quarterly Deck',
      surface: 'deck',
    });
    await writeProjectTextFile(
      project.id,
      'artifacts/index.html',
      '<main><section data-neuma-deck-counter>1</section><h1>Deck</h1></main>',
    );

    const input = await buildArtifactPdfInput(project.id);

    expect(input.deck).toBe(true);
    expect(input.defaultFilename).toBe('quarterly-deck.pdf');
    expect(input.baseHref).toMatch(/^file:\/\//);
    expect(input.html).toContain('<base href="file://');
    expect(input.html).toContain('[data-neuma-deck-counter]');
    expect(input.html).toContain('neuma:print-ready');
  });

  it('sanitizes PDF document titles and default filenames', async () => {
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { writeProjectTextFile } =
      await import('@/shared/services/design-mode/fs');
    const { buildArtifactPdfInput } =
      await import('@/shared/services/design-mode/pdf-export/build-input');
    const project = await createDesignProject({
      title: ' Q2: Launch / Deck * " <north> | \u0001 ',
      surface: 'prototype',
    });
    await writeProjectTextFile(
      project.id,
      'artifacts/index.html',
      '<!doctype html><html><head><title>Unsafe / Title</title></head><body><main>Ready</main></body></html>',
    );

    const input = await buildArtifactPdfInput(project.id);

    expect(input.title).toBe('Q2 Launch Deck north');
    expect(input.defaultFilename).toBe('q2-launch-deck-north.pdf');
    expect(input.html).toContain('<title>Q2 Launch Deck north</title>');
    expect(input.html).not.toContain('Unsafe / Title');
  });

  it('falls back to a safe filename when the title has no ASCII filename characters', async () => {
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { writeProjectTextFile } =
      await import('@/shared/services/design-mode/fs');
    const { buildArtifactPdfInput } =
      await import('@/shared/services/design-mode/pdf-export/build-input');
    const project = await createDesignProject({
      title: '你好 🚀',
      surface: 'document',
    });
    await writeProjectTextFile(
      project.id,
      'artifacts/index.html',
      '<main><h1>Hello</h1></main>',
    );

    const input = await buildArtifactPdfInput(project.id);

    expect(input.title).toBe('你好 🚀');
    expect(input.defaultFilename).toBe('designmode-export.pdf');
  });

  it('waits for usable content size before posting print readiness', async () => {
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { writeProjectTextFile } =
      await import('@/shared/services/design-mode/fs');
    const { buildArtifactPdfInput } =
      await import('@/shared/services/design-mode/pdf-export/build-input');
    const project = await createDesignProject({
      title: 'Ready Check',
      surface: 'document',
    });
    await writeProjectTextFile(
      project.id,
      'artifacts/index.html',
      '<main><h1>Hello</h1></main>',
    );

    const input = await buildArtifactPdfInput(project.id);

    expect(input.html).toContain('neuma:print-ready');
    expect(input.html).toContain('window.parent.postMessage');
    expect(input.html).toContain('scrollWidth');
    expect(input.html).toContain('requestAnimationFrame');
  });

  it('reports a clear error when no HTML artifact exists', async () => {
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { buildArtifactPdfInput, ArtifactPdfInputUnavailableError } =
      await import('@/shared/services/design-mode/pdf-export/build-input');
    const project = await createDesignProject({
      title: 'No HTML',
      surface: 'document',
    });

    await expect(buildArtifactPdfInput(project.id)).rejects.toBeInstanceOf(
      ArtifactPdfInputUnavailableError,
    );
  });
});
