import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setSetting } from '@/shared/db/operations';
import {
  writeContentGraph,
  writeFrameHtml,
} from '@/shared/video/content-graph/persistence';
import { createProject } from '@/shared/video/store';
import {
  loadTemplateGallery,
  resolveDefaultTemplateGalleryRoots,
} from '@/shared/video/templates/gallery-loader';
import { buildHtmlTemplateFolder } from '@/shared/video/templates/html-template-snapshot';

describe('html template snapshot', () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-html-template-'));
    vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
    setSetting('workDir', workDir);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('writes a reusable folder-based gallery template from a content graph draft', async () => {
    const project = await createProject({
      name: 'HTML market recap',
      template: 'custom',
    });
    await writeContentGraph(project.id, {
      schemaVersion: 1,
      intent: 'single-frame',
      synopsis: 'A reusable HTML market recap frame',
      nodes: [
        {
          id: 'intro',
          kind: 'text',
          text: 'Market recap',
          durationSec: 5,
        },
      ],
      edges: [],
    });
    await writeFrameHtml(
      project.id,
      'intro',
      '<!doctype html><html><body><h1 data-hv-text="headline">Market recap</h1></body></html>',
    );

    const result = await buildHtmlTemplateFolder(project, {
      displayName: 'HTML market recap',
      category: 'custom',
      license: 'CC-BY',
    });

    const templateRoot = path.join(
      resolveDefaultTemplateGalleryRoots(workDir).userRoot,
      result.templateId,
    );
    await expect(
      fs.readFile(path.join(templateRoot, 'template.video.yaml'), 'utf8'),
    ).resolves.toContain(`id: ${result.templateId}`);
    await expect(
      fs.readFile(path.join(templateRoot, 'source', 'intro.html'), 'utf8'),
    ).resolves.toContain('Market recap');
    await expect(
      fs.readFile(path.join(templateRoot, 'content-graph.json'), 'utf8'),
    ).resolves.toContain('"intro"');

    const gallery = await loadTemplateGallery({
      ...resolveDefaultTemplateGalleryRoots(workDir),
      ttlMs: 0,
    });
    expect(gallery.templates.map((template) => template.id)).toContain(
      result.templateId,
    );
    expect(
      gallery.templates.find((template) => template.id === result.templateId)
        ?.rootKind,
    ).toBe('user');
  });

  it('requires a content graph before writing an HTML gallery template', async () => {
    const project = await createProject({
      name: 'Empty',
      template: 'custom',
    });

    await expect(
      buildHtmlTemplateFolder(project, {
        displayName: 'Empty',
        category: 'custom',
        license: 'proprietary',
      }),
    ).rejects.toThrow(/content graph/i);
  });
});
