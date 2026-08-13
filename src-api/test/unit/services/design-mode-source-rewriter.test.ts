import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('DesignMode source rewriter', () => {
  let tempHome = '';
  let workDir = '';

  beforeEach(async () => {
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-edit-home-'));
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-edit-work-'));
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

  it('applies a set-text patch to a leaf annotated element and journals it', async () => {
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { readProjectTextFile, writeProjectTextFile } =
      await import('@/shared/services/design-mode/fs');
    const { applyManualEditPatch } =
      await import('@/shared/services/design-mode/source-rewriter/rewrite');
    const project = await createDesignProject({
      title: 'Manual edit',
      surface: 'prototype',
    });
    await writeProjectTextFile(
      project.id,
      'artifacts/index.html',
      '<main><h1 data-neuma-id="hero-title">Old</h1></main>',
    );

    const result = await applyManualEditPatch(project.id, {
      type: 'set-text',
      sourcePath: 'artifacts/index.html',
      targetId: 'hero-title',
      value: 'New <safe>',
    });
    const next = await readProjectTextFile(project.id, 'artifacts/index.html');
    const journal = await readProjectTextFile(
      project.id,
      '.neuma/patches.ndjson',
    );

    expect(result.patchId).toMatch(/^patch_/);
    expect(next.content).toContain('New &lt;safe&gt;');
    expect(journal.content).toContain('"type":"set-text"');
  });

  it('lists and reverts applied patches from the patch journal', async () => {
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { readProjectTextFile, writeProjectTextFile } =
      await import('@/shared/services/design-mode/fs');
    const {
      applyManualEditPatch,
      listManualEditPatches,
      revertManualEditPatch,
    } = await import('@/shared/services/design-mode/source-rewriter/rewrite');
    const project = await createDesignProject({
      title: 'Manual edit revert',
      surface: 'prototype',
    });
    await writeProjectTextFile(
      project.id,
      'artifacts/index.html',
      '<main><h1 data-neuma-id="hero-title">Old</h1></main>',
    );

    const applied = await applyManualEditPatch(project.id, {
      type: 'set-text',
      patchId: 'patch_known',
      sourcePath: 'artifacts/index.html',
      targetId: 'hero-title',
      value: 'New',
    });
    const patches = await listManualEditPatches(project.id);
    const reverted = await revertManualEditPatch(project.id, applied.patchId);
    const next = await readProjectTextFile(project.id, 'artifacts/index.html');

    expect(patches).toHaveLength(1);
    expect(reverted.revertedPatchId).toBe('patch_known');
    expect(next.content).toContain('>Old<');
  });

  it('rejects unsafe links and event handler attributes', async () => {
    const { validateManualEditPatch } =
      await import('@/shared/services/design-mode/source-rewriter/validate');

    expect(() =>
      validateManualEditPatch({
        type: 'set-link',
        sourcePath: 'artifacts/index.html',
        targetId: 'cta',
        href: 'javascript:alert(1)',
      }),
    ).toThrow(/Link targets/);
    expect(() =>
      validateManualEditPatch({
        type: 'set-attributes',
        sourcePath: 'artifacts/index.html',
        targetId: 'cta',
        attributes: { onclick: 'alert(1)' },
      }),
    ).toThrow(/Attribute is not allowed/);
  });

  it('writes safe link and attribute patches to annotated elements', async () => {
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { readProjectTextFile, writeProjectTextFile } =
      await import('@/shared/services/design-mode/fs');
    const { applyManualEditPatch } =
      await import('@/shared/services/design-mode/source-rewriter/rewrite');
    const project = await createDesignProject({
      title: 'Manual link edit',
      surface: 'prototype',
    });
    await writeProjectTextFile(
      project.id,
      'artifacts/index.html',
      '<main><a data-neuma-id="cta" href="/old">Start</a><button data-neuma-id="button">Buy</button></main>',
    );

    await applyManualEditPatch(project.id, {
      type: 'set-link',
      sourcePath: 'artifacts/index.html',
      targetId: 'cta',
      href: 'https://example.com/signup?plan=pro&seat=1',
    });
    await applyManualEditPatch(project.id, {
      type: 'set-attributes',
      sourcePath: 'artifacts/index.html',
      targetId: 'button',
      attributes: {
        class: 'primary large',
        'aria-label': 'Buy now',
        'data-state': 'ready',
      },
    });

    const next = await readProjectTextFile(project.id, 'artifacts/index.html');
    expect(next.content).toContain(
      'href="https://example.com/signup?plan=pro&amp;seat=1"',
    );
    expect(next.content).toContain('class="primary large"');
    expect(next.content).toContain('aria-label="Buy now"');
    expect(next.content).toContain('data-state="ready"');
  });

  it('writes safe image patches and rejects active image sources', async () => {
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { readProjectTextFile, writeProjectTextFile } =
      await import('@/shared/services/design-mode/fs');
    const { applyManualEditPatch } =
      await import('@/shared/services/design-mode/source-rewriter/rewrite');
    const { validateManualEditPatch } =
      await import('@/shared/services/design-mode/source-rewriter/validate');
    const project = await createDesignProject({
      title: 'Manual image edit',
      surface: 'prototype',
    });
    await writeProjectTextFile(
      project.id,
      'artifacts/index.html',
      '<main><img data-neuma-id="hero-img" src="./old.png" alt="Old"></main>',
    );

    await applyManualEditPatch(project.id, {
      type: 'set-image',
      sourcePath: 'artifacts/index.html',
      targetId: 'hero-img',
      src: './assets/hero.png',
      alt: 'Updated hero',
    });

    const next = await readProjectTextFile(project.id, 'artifacts/index.html');
    expect(next.content).toContain('src="./assets/hero.png"');
    expect(next.content).toContain('alt="Updated hero"');
    expect(() =>
      validateManualEditPatch({
        type: 'set-image',
        sourcePath: 'artifacts/index.html',
        targetId: 'hero-img',
        src: 'data:image/svg+xml,<svg onload=alert(1)>',
      }),
    ).toThrow(/Image sources/);
  });

  it('writes allowlisted style patches and rejects active style values', async () => {
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { readProjectTextFile, writeProjectTextFile } =
      await import('@/shared/services/design-mode/fs');
    const { applyManualEditPatch } =
      await import('@/shared/services/design-mode/source-rewriter/rewrite');
    const { validateManualEditPatch } =
      await import('@/shared/services/design-mode/source-rewriter/validate');
    const project = await createDesignProject({
      title: 'Manual style edit',
      surface: 'prototype',
    });
    await writeProjectTextFile(
      project.id,
      'artifacts/index.html',
      '<main><h1 data-neuma-id="hero" style="color: #111; margin: 0">Hero</h1></main>',
    );

    await applyManualEditPatch(project.id, {
      type: 'set-style',
      sourcePath: 'artifacts/index.html',
      targetId: 'hero',
      styles: {
        color: '#2244ff',
        fontSize: '32px',
        borderRadius: '8px',
      },
    });

    const next = await readProjectTextFile(project.id, 'artifacts/index.html');
    expect(next.content).toContain(
      'style="color: #2244ff; margin: 0; font-size: 32px; border-radius: 8px"',
    );
    expect(() =>
      validateManualEditPatch({
        type: 'set-style',
        sourcePath: 'artifacts/index.html',
        targetId: 'hero',
        styles: { backgroundColor: 'url(javascript:alert(1))' },
      }),
    ).toThrow(/Style value/);
  });

  it('clears an inline style without losing the annotated target', async () => {
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { readProjectTextFile, writeProjectTextFile } =
      await import('@/shared/services/design-mode/fs');
    const { applyManualEditPatch } =
      await import('@/shared/services/design-mode/source-rewriter/rewrite');
    const project = await createDesignProject({
      title: 'Manual style clear',
      surface: 'prototype',
    });
    await writeProjectTextFile(
      project.id,
      'artifacts/index.html',
      '<h1 data-neuma-id="hero" style="color: red">Hero</h1>',
    );

    await applyManualEditPatch(project.id, {
      type: 'set-style',
      sourcePath: 'artifacts/index.html',
      targetId: 'hero',
      styles: { color: '' },
    });

    const next = await readProjectTextFile(project.id, 'artifacts/index.html');
    expect(next.content).toContain('data-neuma-id="hero"');
    expect(next.content).not.toContain('style=');
  });

  it('writes safe token patches to project-level CSS overrides', async () => {
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { readProjectTextFile, writeProjectTextFile } =
      await import('@/shared/services/design-mode/fs');
    const { applyManualEditPatch } =
      await import('@/shared/services/design-mode/source-rewriter/rewrite');
    const { validateManualEditPatch } =
      await import('@/shared/services/design-mode/source-rewriter/validate');
    const project = await createDesignProject({
      title: 'Manual token edit',
      surface: 'prototype',
    });
    await writeProjectTextFile(
      project.id,
      '.neuma/tokens.css',
      ':root {\n  --brand-primary: #111111;\n}\n',
    );

    await applyManualEditPatch(project.id, {
      type: 'set-token',
      tokenName: '--brand-primary',
      value: '#2244ff',
    });
    await applyManualEditPatch(project.id, {
      type: 'set-token',
      name: '--surface-raised',
      value: 'oklch(0.98 0.02 240)',
    });

    const next = await readProjectTextFile(project.id, '.neuma/tokens.css');
    expect(next.content).toContain('--brand-primary: #2244ff;');
    expect(next.content).toContain('--surface-raised: oklch(0.98 0.02 240);');
    expect(() =>
      validateManualEditPatch({
        type: 'set-token',
        tokenName: '--brand-primary',
        value: 'url(javascript:alert(1))',
      }),
    ).toThrow(/Token values/);
    expect(() =>
      validateManualEditPatch({
        type: 'set-token',
        tokenName: 'brand-primary',
        value: '#2244ff',
      }),
    ).toThrow(/Token names/);
  });

  it('writes safe full-source patches and rejects active HTML', async () => {
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { readProjectTextFile, writeProjectTextFile } =
      await import('@/shared/services/design-mode/fs');
    const { applyManualEditPatch, revertManualEditPatch } =
      await import('@/shared/services/design-mode/source-rewriter/rewrite');
    const { validateManualEditPatch } =
      await import('@/shared/services/design-mode/source-rewriter/validate');
    const project = await createDesignProject({
      title: 'Manual full source edit',
      surface: 'prototype',
    });
    await writeProjectTextFile(
      project.id,
      'artifacts/index.html',
      '<main><h1>Old</h1></main>',
    );

    const applied = await applyManualEditPatch(project.id, {
      type: 'set-full-source',
      patchId: 'patch_full_source',
      sourcePath: 'artifacts/index.html',
      content: '<main><h1>New</h1><p>Safe copy</p></main>',
    });
    const next = await readProjectTextFile(project.id, 'artifacts/index.html');
    await revertManualEditPatch(project.id, applied.patchId);
    const reverted = await readProjectTextFile(
      project.id,
      'artifacts/index.html',
    );

    expect(next.content).toContain('<h1>New</h1>');
    expect(reverted.content).toContain('<h1>Old</h1>');
    expect(() =>
      validateManualEditPatch({
        type: 'set-full-source',
        sourcePath: 'artifacts/index.html',
        content: '<main><img src=x onerror="alert(1)"></main>',
      }),
    ).toThrow(/active HTML/);
    expect(() =>
      validateManualEditPatch({
        type: 'set-full-source',
        sourcePath: 'artifacts/index.html',
        content: '<script>alert(1)</script>',
      }),
    ).toThrow(/active HTML/);
  });

  it('writes safe outer-html patches to annotated elements', async () => {
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { readProjectTextFile, writeProjectTextFile } =
      await import('@/shared/services/design-mode/fs');
    const { applyManualEditPatch } =
      await import('@/shared/services/design-mode/source-rewriter/rewrite');
    const { validateManualEditPatch } =
      await import('@/shared/services/design-mode/source-rewriter/validate');
    const project = await createDesignProject({
      title: 'Manual outer HTML edit',
      surface: 'prototype',
    });
    await writeProjectTextFile(
      project.id,
      'artifacts/index.html',
      '<main><section data-neuma-id="hero"><h1>Old</h1></section><img data-neuma-id="logo" src="./old.png"></main>',
    );

    await applyManualEditPatch(project.id, {
      type: 'set-outer-html',
      sourcePath: 'artifacts/index.html',
      targetId: 'hero',
      content:
        '<section data-neuma-id="hero"><h1>New</h1><p>Copy</p></section>',
    });
    await applyManualEditPatch(project.id, {
      type: 'set-outer-html',
      sourcePath: 'artifacts/index.html',
      targetId: 'logo',
      content:
        '<figure data-neuma-id="logo"><img src="./logo.png" alt="Logo"></figure>',
    });

    const next = await readProjectTextFile(project.id, 'artifacts/index.html');
    expect(next.content).toContain('<h1>New</h1>');
    expect(next.content).toContain('<figure data-neuma-id="logo">');
    expect(() =>
      validateManualEditPatch({
        type: 'set-outer-html',
        sourcePath: 'artifacts/index.html',
        targetId: 'hero',
        content: '<section onclick="alert(1)">Bad</section>',
      }),
    ).toThrow(/active HTML/);
  });
});
