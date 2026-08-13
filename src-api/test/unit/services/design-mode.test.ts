import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';

import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  listCraft,
  listDesignSkills,
  listDesignSystems,
  listPromptTemplates,
} from '@/shared/services/design-mode/catalogs';
import { normalizeProjectRelativePath } from '@/shared/services/design-mode/fs';
import { lintDesignArtifact } from '@/shared/services/design-mode/lint';
import { designProjectSchema } from '@/shared/services/design-mode/types';

describe('DesignMode path guard', () => {
  it('rejects traversal, absolute, and nul paths', () => {
    expect(() => normalizeProjectRelativePath('../x')).toThrow();
    expect(() => normalizeProjectRelativePath('/tmp/x')).toThrow();
    expect(() => normalizeProjectRelativePath('a\0b')).toThrow();
    expect(normalizeProjectRelativePath('artifacts/index.html')).toBe(
      'artifacts/index.html',
    );
  });
});

describe('DesignMode catalogs', () => {
  it('ships the required seed catalogs', async () => {
    await expect(
      listDesignSystems().then((items) => items.length),
    ).resolves.toBeGreaterThanOrEqual(12);
    await expect(
      listCraft().then((items) => items.length),
    ).resolves.toBeGreaterThanOrEqual(6);
    await expect(
      listPromptTemplates('image').then((items) => items.length),
    ).resolves.toBeGreaterThanOrEqual(20);
    await expect(
      listPromptTemplates('video').then((items) => items.length),
    ).resolves.toBeGreaterThanOrEqual(12);
  });

  it('loads state and animation craft refs and matching skill opt-ins', async () => {
    const [craft, skills, systems] = await Promise.all([
      listCraft(),
      listDesignSkills(),
      listDesignSystems(),
    ]);
    expect(craft.map((item) => item.id)).toEqual(
      expect.arrayContaining(['state-coverage', 'animation-discipline']),
    );
    expect(systems.map((item) => item.id)).toContain('atelier-zero');

    const bySlug = new Map(skills.map((skill) => [skill.slug, skill]));
    const requirementsFor = (slug: string) =>
      bySlug.get(slug)?.od?.craft?.requires ?? [];
    expect(requirementsFor('dashboard')).toEqual(
      expect.arrayContaining(['state-coverage']),
    );
    expect(requirementsFor('kanban-board')).toEqual(
      expect.arrayContaining(['state-coverage']),
    );
    for (const slug of ['mobile-app', 'mobile-onboarding', 'gamified-app']) {
      expect(requirementsFor(slug)).toEqual(
        expect.arrayContaining(['state-coverage', 'animation-discipline']),
      );
    }
  });
});

describe('DesignMode linter', () => {
  it('flags P0 AI-slop patterns and P1 accessibility guidance', () => {
    const findings = lintDesignArtifact(
      '<h1>#6366f1 10x faster</h1><img src="x.png"><p>lorem ipsum</p>',
      { activeAccent: '#ff0000', path: 'artifacts/index.html' },
    );
    expect(
      findings.some((finding) => finding.id === 'ai-slop.default-indigo'),
    ).toBe(true);
    expect(
      findings.some((finding) => finding.id === 'ai-slop.invented-metrics'),
    ).toBe(true);
    expect(findings.some((finding) => finding.id === 'a11y.missing-alt')).toBe(
      true,
    );
  });
});

describe('DesignMode project persistence', () => {
  let tempHome = '';
  let workDir = '';

  beforeEach(async () => {
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-design-home-'));
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-design-work-'));
    vi.stubEnv('HOME', tempHome);
    const { saveSetting } = await import('@/shared/db/operations');
    saveSetting('workDir', workDir);
  });

  afterEach(async () => {
    const { __resetAssetMaterializerForTests } =
      await import('@/shared/assets');
    __resetAssetMaterializerForTests();
    const { closeDatabase } = await import('@/shared/db');
    closeDatabase();
    vi.unstubAllEnvs();
    await fs.rm(tempHome, { recursive: true, force: true });
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('creates a portable manifest, folder scaffold, and sqlite row', async () => {
    const { createDesignProject, listDesignProjects } =
      await import('@/shared/services/design-mode/projects');
    const project = await createDesignProject({
      title: 'Editorial poster',
      surface: 'image',
      brief: { audience: 'designers' },
    });
    const root = path.join(workDir, 'design-projects', project.id);
    await expect(
      fs.stat(path.join(root, 'project.json')),
    ).resolves.toBeTruthy();
    await expect(
      fs.stat(path.join(root, 'provenance/assets.jsonl')),
    ).resolves.toBeTruthy();
    const projects = await listDesignProjects();
    expect(projects.map((item) => item.id)).toContain(project.id);
  });

  it('uses global DesignMode defaults when project create omits them', async () => {
    const { saveSetting } = await import('@/shared/db/operations');
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    saveSetting(
      'designMode',
      JSON.stringify({
        defaultDesignSystemId: 'default-freeform',
        defaultSkillId: 'mobile-app',
      }),
    );

    const defaulted = await createDesignProject({
      title: 'Defaulted prototype',
      surface: 'prototype',
    });
    expect(defaulted.designSystemId).toBe('default-freeform');
    expect(defaulted.skillId).toBe('bundled:mobile-app');

    const explicitEmpty = await createDesignProject({
      title: 'Blank prototype',
      surface: 'prototype',
      designSystemId: null,
      skillId: null,
    });
    expect(explicitEmpty.designSystemId).toBeNull();
    expect(explicitEmpty.skillId).toBeNull();
  });

  it('rejects DesignMode projects with unknown skills', async () => {
    const { createDesignProject, patchDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { designRoutes } = await import('@/app/api/design');

    await expect(
      createDesignProject({
        title: 'Unknown skill',
        surface: 'prototype',
        skillId: 'missing-skill',
      }),
    ).rejects.toThrow(/Unknown DesignMode skill: missing-skill/);

    const project = await createDesignProject({
      title: 'Known skill',
      surface: 'prototype',
      skillId: 'mobile-app',
    });
    await expect(
      patchDesignProject(project.id, { skillId: 'missing-skill' }),
    ).rejects.toThrow(/Unknown DesignMode skill: missing-skill/);

    const response = await designRoutes.request('/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Unknown skill via API',
        surface: 'prototype',
        skillId: 'missing-skill',
      }),
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: 'Unknown DesignMode skill: missing-skill',
    });
  });

  it('validates linked context dirs inside the workspace only', async () => {
    const { validateLinkedContextDirs } =
      await import('@/shared/services/design-mode/linked-context');
    const inside = path.join(workDir, 'reference-app');
    await fs.mkdir(inside, { recursive: true });
    await fs.writeFile(path.join(inside, 'README.md'), '# Reference');
    const insideReal = await fs.realpath(inside);

    const accepted = validateLinkedContextDirs([inside, inside]);
    expect(accepted).toEqual({ dirs: [insideReal] });

    const outside = await fs.mkdtemp(
      path.join(os.tmpdir(), 'neuma-design-outside-'),
    );
    try {
      const rejected = validateLinkedContextDirs([outside]);
      expect(rejected.error).toMatch(/inside the workspace/);
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it('persists user and project custom instructions into prompt snapshots', async () => {
    const { saveSetting } = await import('@/shared/db/operations');
    const { createDesignProject, patchDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { resolveProjectPrompt } =
      await import('@/shared/services/design-mode/prompt-composer');

    saveSetting(
      'designMode',
      JSON.stringify({
        customInstructions: 'Use compact operational layouts.',
      }),
    );
    const created = await createDesignProject({
      title: 'Instruction precedence',
      surface: 'prototype',
      customInstructions: 'Use dense tables for project dashboards.',
    });
    expect(created.customInstructions).toBe(
      'Use dense tables for project dashboards.',
    );

    const patched = await patchDesignProject(created.id, {
      customInstructions: 'Project-level instructions win on conflicts.',
    });
    const resolved = await resolveProjectPrompt(patched, 'Build the screen.');
    const ids = resolved.sections.map((section) => section.id);

    expect(patched.customInstructions).toBe(
      'Project-level instructions win on conflicts.',
    );
    expect(ids.indexOf('custom-instructions-user')).toBeGreaterThan(
      ids.indexOf('brief'),
    );
    expect(ids.indexOf('custom-instructions-project')).toBeGreaterThan(
      ids.indexOf('custom-instructions-user'),
    );
    expect(resolved.system).toContain('Use compact operational layouts.');
    expect(resolved.system).toContain(
      'Project-level instructions win on conflicts.',
    );
  });

  it('suppresses design-system sidecar prompts when the token channel is disabled', async () => {
    const { saveSetting } = await import('@/shared/db/operations');
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { resolveProjectPrompt } =
      await import('@/shared/services/design-mode/prompt-composer');

    saveSetting('designMode', JSON.stringify({ tokenChannelEnabled: false }));
    const project = await createDesignProject({
      title: 'No token sidecars',
      surface: 'prototype',
      designSystemId: 'default',
    });
    const resolved = await resolveProjectPrompt(project, 'Use DESIGN.md only.');

    expect(resolved.sections.map((section) => section.id)).not.toEqual(
      expect.arrayContaining([
        'design-system-tokens',
        'design-system-components',
      ]),
    );
    expect(resolved.system).not.toContain('```css');
    expect(resolved.system).not.toContain('reference components');
  });

  it('injects design-system sidecar prompts by default', async () => {
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { resolveProjectPrompt } =
      await import('@/shared/services/design-mode/prompt-composer');

    const project = await createDesignProject({
      title: 'Default token sidecars',
      surface: 'prototype',
      designSystemId: 'default',
    });
    const resolved = await resolveProjectPrompt(project, 'Use tokens.');

    expect(resolved.sections.map((section) => section.id)).toEqual(
      expect.arrayContaining([
        'design-system-tokens',
        'design-system-components',
      ]),
    );
    expect(resolved.system).toContain('```css');
    expect(resolved.system).toContain('```html');
  });

  it('records prompt-stack metadata for debug replay', async () => {
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { resolveProjectPrompt } =
      await import('@/shared/services/design-mode/prompt-composer');
    const { resolveProjectPath } =
      await import('@/shared/services/design-mode/fs');
    const { designRoutes } = await import('@/app/api/design');

    const project = await createDesignProject({
      title: 'Prompt stack',
      surface: 'prototype',
      intent: 'app-screen',
      designSystemId: 'default',
      brief: { chatLocale: 'fr' },
    });
    const resolved = await resolveProjectPrompt(
      project,
      'Build the dashboard.',
    );

    const stackPath = resolveProjectPath(
      project.id,
      'prompts/prompt-stack.json',
    );
    const stack = JSON.parse(
      await fs.readFile(stackPath.absolutePath, 'utf-8'),
    ) as {
      version: string;
      project: {
        id: string;
        intent: string;
        designSystemId: string | null;
        resolvedDesignSystemId: string | null;
        craftRefs: string[];
      };
      latestMessageHash: string | null;
      systemHash: string;
      userHash: string;
      sections: Array<{
        id: string;
        title: string;
        bodyHash: string;
        bodyBytes: number;
      }>;
    };

    expect(stack.version).toBe('design-prompt-stack.v1');
    expect(stack.project).toMatchObject({
      id: project.id,
      intent: 'app-screen',
      designSystemId: 'default',
      resolvedDesignSystemId: 'default',
    });
    expect(stack.project.craftRefs).toContain('anti-ai-slop');
    expect(stack.latestMessageHash).toHaveLength(64);
    expect(stack.systemHash).toHaveLength(64);
    expect(stack.userHash).toHaveLength(64);
    expect(stack.sections.map((section) => section.id)).toEqual(
      resolved.sections.map((section) => section.id),
    );
    expect(
      stack.sections.find((section) => section.id === 'design-system')
        ?.bodyBytes,
    ).toBeGreaterThan(0);

    const response = await designRoutes.request(
      `/projects/${project.id}/debug`,
    );
    const data = (await response.json()) as {
      snapshot: {
        prompts: {
          stack: typeof stack;
        };
      };
    };
    expect(response.status).toBe(200);
    expect(data.snapshot.prompts.stack.sections[0]).toMatchObject({
      id: 'contract',
      title: 'DesignMode operating contract',
    });
  });

  it('injects Figma and Code Connect context packs into prompt snapshots', async () => {
    const { createDesignProject, patchDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { resolveProjectPath } =
      await import('@/shared/services/design-mode/fs');
    const { resolveProjectPrompt } =
      await import('@/shared/services/design-mode/prompt-composer');
    const { designRoutes } = await import('@/app/api/design');

    const project = await createDesignProject({
      title: 'Figma context',
      surface: 'prototype',
      contextPacks: [
        {
          id: 'figma-checkout',
          source: 'figma-code-connect',
          title: 'Checkout components',
          summary: 'Checkout frame and mapped production controls.',
          figma: {
            url: 'https://www.figma.com/design/AbCdEF123456/Checkout?node-id=12-34',
            nodeName: 'Checkout / Desktop',
          },
          components: [
            {
              name: 'CheckoutButton',
              importPath: '@acme/ui/checkout-button',
              sourcePath: 'src/components/CheckoutButton.tsx',
              props: { variant: 'primary', size: 'lg' },
              tokenUsage: [
                'color.action.primary',
                'radius.button',
                'radius.button',
              ],
              notes: 'Use for primary purchase actions.',
            },
          ],
          notes: [
            'Prefer production button states from Code Connect.',
            'Prefer production button states from Code Connect.',
          ],
        },
      ],
    });

    expect(project.contextPacks?.[0]?.figma).toMatchObject({
      fileKey: 'AbCdEF123456',
      fileName: 'Checkout',
      nodeId: '12-34',
    });
    expect(project.contextPacks?.[0]?.components[0]?.tokenUsage).toEqual([
      'color.action.primary',
      'radius.button',
    ]);
    expect(project.contextPacks?.[0]?.notes).toEqual([
      'Prefer production button states from Code Connect.',
    ]);

    const resolved = await resolveProjectPrompt(project, 'Build checkout.');
    const contextSection = resolved.sections.find(
      (section) => section.id === 'design-context-packs',
    );

    expect(contextSection).toMatchObject({
      title: 'Figma and Code Connect context pack',
      cache_control: { type: 'ephemeral' },
    });
    expect(contextSection?.body).toContain('"fileKey": "AbCdEF123456"');
    expect(contextSection?.body).toContain('"nodeId": "12-34"');
    expect(contextSection?.body).toContain(
      '"importPath": "@acme/ui/checkout-button"',
    );

    const persisted = JSON.parse(
      await fs.readFile(
        resolveProjectPath(project.id, 'prompts/context-packs.json')
          .absolutePath,
        'utf-8',
      ),
    ) as Array<{
      figma?: { fileName?: string };
      components: Array<{ tokenUsage: string[] }>;
    }>;
    expect(persisted[0]?.figma?.fileName).toBe('Checkout');
    expect(persisted[0]?.components[0]?.tokenUsage).toEqual([
      'color.action.primary',
      'radius.button',
    ]);

    const stack = JSON.parse(
      await fs.readFile(
        resolveProjectPath(project.id, 'prompts/prompt-stack.json')
          .absolutePath,
        'utf-8',
      ),
    ) as {
      project: { contextPackIds: string[] };
      sections: Array<{ id: string; cacheControl: string | null }>;
    };
    expect(stack.project.contextPackIds).toEqual(['figma-checkout']);
    expect(
      stack.sections.find((section) => section.id === 'design-context-packs'),
    ).toMatchObject({ cacheControl: 'ephemeral' });

    const debugResponse = await designRoutes.request(
      `/projects/${project.id}/debug`,
    );
    const debug = (await debugResponse.json()) as {
      snapshot: {
        project: { contextPacks: Array<{ id: string }> };
        prompts: { stack: typeof stack };
      };
    };
    expect(debugResponse.status).toBe(200);
    expect(debug.snapshot.project.contextPacks[0]?.id).toBe('figma-checkout');
    expect(debug.snapshot.prompts.stack.project.contextPackIds).toEqual([
      'figma-checkout',
    ]);

    const cleared = await patchDesignProject(project.id, { contextPacks: [] });
    await resolveProjectPrompt(cleared, 'Clear selected sources.');
    await expect(
      fs
        .readFile(
          resolveProjectPath(project.id, 'prompts/context-packs.json')
            .absolutePath,
          'utf-8',
        )
        .then((raw) => JSON.parse(raw)),
    ).resolves.toEqual([]);
    const clearedStack = JSON.parse(
      await fs.readFile(
        resolveProjectPath(project.id, 'prompts/prompt-stack.json')
          .absolutePath,
        'utf-8',
      ),
    ) as {
      project: { contextPackIds: string[] };
      sections: Array<{ id: string }>;
    };
    expect(clearedStack.project.contextPackIds).toEqual([]);
    expect(clearedStack.sections.map((section) => section.id)).not.toContain(
      'design-context-packs',
    );
  });

  it('rejects unsafe Figma and Code Connect context packs', async () => {
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');

    await expect(
      createDesignProject({
        title: 'Bad Figma URL',
        surface: 'prototype',
        contextPacks: [
          {
            id: 'bad-figma',
            source: 'figma',
            title: 'Bad Figma',
            figma: {
              url: 'https://example.com/design/AbCdEF123456/Checkout',
            },
          },
        ],
      }),
    ).rejects.toThrow(/Figma URL must point to a figma\.com/);

    await expect(
      createDesignProject({
        title: 'Bad Code Connect path',
        surface: 'prototype',
        contextPacks: [
          {
            id: 'bad-source-path',
            source: 'code-connect',
            title: 'Bad source path',
            components: [
              {
                name: 'DangerButton',
                sourcePath: '/etc/passwd',
                tokenUsage: [],
              },
            ],
          },
        ],
      }),
    ).rejects.toThrow(/sourcePath must be workspace-relative/);

    await expect(
      createDesignProject({
        title: 'Bad Code Connect source URL',
        surface: 'prototype',
        contextPacks: [
          {
            id: 'bad-source-url',
            source: 'code-connect',
            title: 'Bad source URL',
            components: [
              {
                name: 'LocalOnlyButton',
                sourceUrl: 'http://example.com/LocalOnlyButton.tsx',
                tokenUsage: [],
              },
            ],
          },
        ],
      }),
    ).rejects.toThrow(/sourceUrl must be an HTTPS URL/);

    await expect(
      createDesignProject({
        title: 'Oversized Code Connect props',
        surface: 'prototype',
        contextPacks: [
          {
            id: 'large-props',
            source: 'code-connect',
            title: 'Large props',
            components: [
              {
                name: 'LargePropsButton',
                props: { label: 'x'.repeat(4096) },
                tokenUsage: [],
              },
            ],
          },
        ],
      }),
    ).rejects.toThrow(/props must stay under 4 KB/);
  });

  it('skips discovery when a template prompt is still unmodified', async () => {
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { resolveProjectPrompt } =
      await import('@/shared/services/design-mode/prompt-composer');
    const { resolveProjectPath } =
      await import('@/shared/services/design-mode/fs');
    const template = {
      id: 'editorial-hero',
      surface: 'image' as const,
      title: 'Editorial hero',
      prompt:
        'Create an editorial hero image for a disciplined productivity app.',
      summary: 'A polished app hero image.',
    };
    const project = await createDesignProject({
      title: 'Template project',
      surface: 'image',
      promptTemplate: template,
      brief: {
        prompt: template.prompt,
        createdFromTemplate: true,
      },
    });

    const unchanged = await resolveProjectPrompt(
      project,
      `${template.prompt}\r\n`,
    );
    expect(unchanged.sections.map((section) => section.id)).toContain(
      'discovery-skip',
    );
    expect(unchanged.system).toContain(
      'Do not ask broad discovery or clarifying questions',
    );

    const stackPath = resolveProjectPath(
      project.id,
      'prompts/prompt-stack.json',
    );
    const stack = JSON.parse(
      await fs.readFile(stackPath.absolutePath, 'utf-8'),
    ) as {
      sections: Array<{ id: string }>;
    };
    expect(stack.sections.map((section) => section.id)).toContain(
      'discovery-skip',
    );

    const changed = await resolveProjectPrompt(
      project,
      'Create a black-and-white version with brutalist typography.',
    );
    expect(changed.sections.map((section) => section.id)).not.toContain(
      'discovery-skip',
    );
  });

  it('re-composes prompt stack after a mid-chat design-system switch', async () => {
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { resolveProjectPath } =
      await import('@/shared/services/design-mode/fs');
    const { designRoutes } = await import('@/app/api/design');

    const project = await createDesignProject({
      title: 'Switchable prompt system',
      surface: 'prototype',
      intent: 'app-screen',
      designSystemId: 'default',
      inspirationDesignSystemIds: ['github'],
    });

    const initialResponse = await designRoutes.request(
      `/projects/${project.id}/resolve-prompt`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ latestMessage: 'Use the current system.' }),
      },
    );
    expect(initialResponse.status).toBe(200);

    const initial = (await initialResponse.json()) as {
      sections: Array<{ id: string; title: string }>;
    };
    expect(
      initial.sections.find((section) => section.id === 'design-system'),
    ).toMatchObject({ title: 'Active design system: Neutral Modern' });

    const patchResponse = await designRoutes.request(
      `/projects/${project.id}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          designSystemId: 'github',
          inspirationDesignSystemIds: [],
        }),
      },
    );
    expect(patchResponse.status).toBe(200);

    const switchedResponse = await designRoutes.request(
      `/projects/${project.id}/resolve-prompt`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ latestMessage: 'Now use the switched system.' }),
      },
    );
    expect(switchedResponse.status).toBe(200);

    const switched = (await switchedResponse.json()) as {
      sections: Array<{ id: string; title: string }>;
    };
    expect(
      switched.sections.find((section) => section.id === 'design-system'),
    ).toMatchObject({
      // Title now comes from the system's manifest.json brand name ("GitHub")
      // rather than the DESIGN.md H1 ("Design System Inspired by GitHub").
      title: 'Active design system: GitHub',
    });
    expect(
      switched.sections.some((section) =>
        section.id.startsWith('inspiration-'),
      ),
    ).toBe(false);

    const stackPath = resolveProjectPath(
      project.id,
      'prompts/prompt-stack.json',
    );
    const stack = JSON.parse(
      await fs.readFile(stackPath.absolutePath, 'utf-8'),
    ) as {
      project: {
        designSystemId: string | null;
        resolvedDesignSystemId: string | null;
        inspirationDesignSystemIds: string[];
      };
      sections: Array<{ id: string; title: string }>;
    };

    expect(stack.project).toMatchObject({
      designSystemId: 'github',
      resolvedDesignSystemId: 'github',
      inspirationDesignSystemIds: [],
    });
    expect(
      stack.sections.find((section) => section.id === 'design-system'),
    ).toMatchObject({
      // Brand name from manifest.json (see note above).
      title: 'Active design system: GitHub',
    });
  });

  it('advertises catalog asset tools in Design project prompts', async () => {
    const { AssetRegistry } = await import('@/shared/assets');
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { resolveProjectPrompt } =
      await import('@/shared/services/design-mode/prompt-composer');
    await fs.writeFile(path.join(workDir, 'reference-board.png'), 'pixels');
    const project = await createDesignProject({
      title: 'Catalog-aware design',
      surface: 'prototype',
    });
    const registry = new AssetRegistry();
    const { asset } = await registry.ingest({
      source: 'local_fs',
      storagePath: 'reference-board.png',
      clientRequestId: 'design-prompt-reference-board',
      hint: {
        kind: 'image',
        mime: 'image/png',
        title: 'Reference board',
      },
    });
    registry.attach(
      asset.id,
      { scope: 'design_project', scopeId: project.id },
      'reference',
    );

    const resolved = await resolveProjectPrompt(
      project,
      'Use existing assets first.',
    );
    const catalogSection = resolved.sections.find(
      (section) => section.id === 'asset-catalog',
    );

    expect(catalogSection?.title).toBe('Workspace asset catalog');
    expect(catalogSection?.body).toContain('<!-- catalog-context-v1 -->');
    expect(catalogSection?.body).toContain(
      'Workspace has 1 assets (1 image). This project has 1 attached.',
    );
    expect(catalogSection?.body).toContain('Reference board');
    expect(catalogSection?.body).toContain('Use assets_search');
    expect(catalogSection?.body).toContain(
      'Use assets_attach with scope "design_project"',
    );
    expect(resolved.system).toContain('assets/imports/');
  });

  it('stages selected skill side files and records linked context in prompt snapshots', async () => {
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { resolveProjectPrompt } =
      await import('@/shared/services/design-mode/prompt-composer');
    const { DESIGN_SKILLS_CWD_ALIAS } =
      await import('@/shared/services/design-mode/skill-staging');
    const linked = path.join(workDir, 'linked-reference');
    await fs.mkdir(linked, { recursive: true });
    const linkedReal = await fs.realpath(linked);

    const project = await createDesignProject({
      title: 'Skill stage',
      surface: 'prototype',
      skillId: 'mobile-app',
      linkedContextDirs: [linked],
    });
    const resolved = await resolveProjectPrompt(project, 'Build the screens.');
    const stagedSkill = path.join(
      workDir,
      'design-projects',
      project.id,
      DESIGN_SKILLS_CWD_ALIAS,
      'mobile-app',
    );

    expect(resolved.system).toContain('.neuma-skills/mobile-app');
    expect(resolved.system).toContain(linkedReal);
    expect(resolved.system).toContain('Craft reference: State coverage');
    expect(resolved.system).toContain('Craft reference: Animation discipline');
    expect((await fs.lstat(stagedSkill)).isSymbolicLink()).toBe(false);
    await expect(
      fs.readFile(path.join(stagedSkill, 'example.html'), 'utf-8'),
    ).resolves.toContain('<');
    await expect(
      fs.readFile(
        path.join(
          workDir,
          'design-projects',
          project.id,
          'craft/state-coverage.md',
        ),
        'utf-8',
      ),
    ).resolves.toContain('The five required states');
  });

  it('adds screen-file-first guidance for cross-platform project intents', async () => {
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { resolveProjectPrompt } =
      await import('@/shared/services/design-mode/prompt-composer');
    const project = await createDesignProject({
      title: 'Landing page files',
      surface: 'prototype',
      intent: 'landing-page',
    });

    const resolved = await resolveProjectPrompt(project, 'Build all sizes.');

    expect(resolved.sections.map((section) => section.id)).toContain(
      'screen-file-first',
    );
    expect(resolved.system).toContain('artifacts/mobile.html');
    expect(resolved.system).toContain('artifacts/tablet.html');
    expect(resolved.system).toContain('artifacts/desktop.html');
    expect(resolved.system).toContain('DESIGN-MANIFEST.json');
  });

  it('removes deleted projects from the index and moves their folder to tombstones', async () => {
    const { createDesignProject, deleteDesignProject, listDesignProjects } =
      await import('@/shared/services/design-mode/projects');
    const project = await createDesignProject({
      title: 'Delete me',
      surface: 'prototype',
    });
    const projectRoot = path.join(workDir, 'design-projects', project.id);
    await expect(fs.stat(projectRoot)).resolves.toBeTruthy();

    await deleteDesignProject(project.id);

    await expect(fs.stat(projectRoot)).rejects.toThrow();
    await expect(listDesignProjects()).resolves.not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: project.id })]),
    );
    const tombstoneRoot = path.join(workDir, 'design-projects/.deleted');
    const tombstones = await fs.readdir(tombstoneRoot);
    expect(tombstones.some((name) => name.startsWith(project.id))).toBe(true);
  });

  it('soft deletes selected project files into a project trash folder', async () => {
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { deleteProjectFiles, listProjectFiles, writeProjectTextFile } =
      await import('@/shared/services/design-mode/fs');
    const project = await createDesignProject({
      title: 'Batch delete files',
      surface: 'prototype',
    });
    await writeProjectTextFile(
      project.id,
      'artifacts/one.html',
      '<h1>One</h1>',
    );
    await writeProjectTextFile(
      project.id,
      'artifacts/two.html',
      '<h1>Two</h1>',
    );

    const deleted = await deleteProjectFiles(project.id, [
      'artifacts/one.html',
      'artifacts/two.html',
    ]);

    expect(deleted.map((file) => file.path)).toEqual([
      'artifacts/one.html',
      'artifacts/two.html',
    ]);
    expect(
      deleted.every((file) => file.trashPath.startsWith('.neuma/.trash/')),
    ).toBe(true);
    await expect(
      fs.stat(
        path.join(workDir, 'design-projects', project.id, 'artifacts/one.html'),
      ),
    ).rejects.toThrow();
    await expect(
      fs.stat(
        path.join(
          workDir,
          'design-projects',
          project.id,
          deleted[0]!.trashPath,
        ),
      ),
    ).resolves.toBeTruthy();
    const files = await listProjectFiles(project.id);
    expect(JSON.stringify(files)).not.toContain('.neuma');
  });

  it('skips stale index rows when a manifest is missing', async () => {
    const { getDatabase } = await import('@/shared/db');
    const { designRoutes } = await import('@/app/api/design');
    const { createDesignProject, listDesignProjects } =
      await import('@/shared/services/design-mode/projects');
    const project = await createDesignProject({
      title: 'Stale project',
      surface: 'image',
    });
    await fs.rm(path.join(workDir, 'design-projects', project.id), {
      recursive: true,
      force: true,
    });

    await expect(listDesignProjects()).resolves.not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: project.id })]),
    );
    const row = getDatabase()
      .prepare('SELECT id FROM design_projects WHERE id = ?')
      .get(project.id);
    expect(row).toEqual(expect.objectContaining({ id: project.id }));

    const staleResponse = await designRoutes.request(`/projects/${project.id}`);
    expect(staleResponse.status).toBe(404);
  });

  it('blocks media dispatch before provider calls when project budget is exhausted', async () => {
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { startDesignMediaTask } =
      await import('@/shared/services/design-mode/media-dispatcher');
    const { listTraceEvents } = await import('@/shared/observability/trace');
    const project = await createDesignProject({
      title: 'Budgeted image',
      surface: 'image',
      budget: { maxImageGenerations: 0 },
    });
    const task = await startDesignMediaTask({
      projectId: project.id,
      surface: 'image',
      prompt: 'Generate a poster',
    });
    expect(task.state).toBe('failed');
    expect(task.providerError).toMatch(/budget exceeded/i);
    expect(task.requestedUnits?.imageGenerations).toBe(1);
    expect(task.budgetCheck?.allowed).toBe(false);
    const trace = listTraceEvents(task.taskId);
    expect(
      trace.some(
        (event) => event.kind === 'budget' && event.status === 'denied',
      ),
    ).toBe(true);
  });

  it('renders HyperFrames HTML video through a configured renderer command', async () => {
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { resolveProjectPath, writeProjectTextFile } =
      await import('@/shared/services/design-mode/fs');
    const { startDesignMediaTask, waitDesignMediaTask } =
      await import('@/shared/services/design-mode/media-dispatcher');
    const project = await createDesignProject({
      title: 'HyperFrames render',
      surface: 'video',
      media: { model: 'hyperframes-html' },
    });
    await writeProjectTextFile(
      project.id,
      '.hyperframes-cache/demo/index.html',
      '<main data-start="0" data-duration="2">Motion card</main>',
    );
    const rendererScript = path.join(workDir, 'mock-hyperframes-renderer.mjs');
    await fs.writeFile(
      rendererScript,
      [
        "import fs from 'node:fs/promises';",
        "import path from 'node:path';",
        'const [, , compositionDir, output] = process.argv;',
        "console.error('Frame 1/2');",
        "console.log('Frame 2/2');",
        "await fs.access(path.join(compositionDir, 'index.html'));",
        "await fs.writeFile(output, Buffer.from('mock mp4'));",
      ].join('\n'),
      'utf-8',
    );
    vi.stubEnv('NEUMA_HYPERFRAMES_BIN', process.execPath);
    vi.stubEnv(
      'NEUMA_HYPERFRAMES_RENDER_ARGS_JSON',
      JSON.stringify([rendererScript, '{compositionDir}', '{output}']),
    );

    const task = await startDesignMediaTask({
      projectId: project.id,
      surface: 'video',
      model: 'hyperframes-html',
      prompt: 'Render a motion card.',
      compositionDir: '.hyperframes-cache/demo',
      output: 'motion-card.mp4',
    });
    const result = await waitDesignMediaTask(task.taskId);

    expect(result.status).toBe('done');
    expect(result.file).toEqual(
      expect.objectContaining({
        kind: 'video',
        path: 'assets/generated/motion-card.mp4',
        provider: 'hyperframes',
        model: 'hyperframes-html',
      }),
    );
    expect(result.progress.join('\n')).toContain('Frame 1/2');
    expect(result.progress.join('\n')).toContain('Frame 2/2');
    await expect(
      fs.readFile(
        resolveProjectPath(project.id, 'assets/generated/motion-card.mp4')
          .absolutePath,
        'utf-8',
      ),
    ).resolves.toBe('mock mp4');
  });

  it('streams preview reload events after project file writes', async () => {
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { designRoutes } = await import('@/app/api/design');
    const project = await createDesignProject({
      title: 'Preview stream',
      surface: 'prototype',
    });

    const preview = await designRoutes.request(
      `/projects/${project.id}/preview`,
    );
    expect(preview.status).toBe(200);
    expect(preview.headers.get('content-type')).toContain('text/event-stream');
    const reader = preview.body!.getReader();
    try {
      await expect(readStreamUntil(reader, 'event: ready')).resolves.toContain(
        project.id,
      );

      const write = await designRoutes.request(`/projects/${project.id}/file`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          path: 'artifacts/index.html',
          content: '<main data-neuma-id="root">Reload</main>',
        }),
      });
      expect(write.status).toBe(200);

      await expect(readStreamUntil(reader, 'event: reload')).resolves.toContain(
        'artifacts/index.html',
      );
    } finally {
      await reader.cancel().catch(() => {});
    }
  });

  it('blocks generated prose HTML before writing a project file', async () => {
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { resolveProjectPath } =
      await import('@/shared/services/design-mode/fs');
    const { designRoutes } = await import('@/app/api/design');
    const project = await createDesignProject({
      title: 'Generated HTML gate',
      surface: 'prototype',
    });

    const response = await designRoutes.request(
      `/projects/${project.id}/file`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          path: 'artifacts/index.html',
          content: 'Updated the hero and button copy.',
          source: 'generated',
        }),
      },
    );

    expect(response.status).toBe(422);
    await expect(
      fs.stat(
        resolveProjectPath(project.id, 'artifacts/index.html').absolutePath,
      ),
    ).rejects.toThrow();
  });

  it('rejects preview streams for unknown projects', async () => {
    const { designRoutes } = await import('@/app/api/design');

    const preview = await designRoutes.request(
      '/projects/design_missing123/preview',
    );

    expect(preview.status).toBe(404);
  });

  it('serves project blobs with path guards for media previews', async () => {
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { resolveProjectPath } =
      await import('@/shared/services/design-mode/fs');
    const { designRoutes } = await import('@/app/api/design');
    const project = await createDesignProject({
      title: 'Blob preview',
      surface: 'image',
    });
    const pngPath = resolveProjectPath(project.id, 'assets/generated/test.png');
    await fs.mkdir(path.dirname(pngPath.absolutePath), { recursive: true });
    await fs.writeFile(
      pngPath.absolutePath,
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );

    const response = await designRoutes.request(
      `/projects/${project.id}/blob?path=${encodeURIComponent('assets/generated/test.png')}`,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('content-disposition')).toBe(
      'inline; filename="test.png"',
    );
    expect(Buffer.from(await response.arrayBuffer())).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );

    const htmlPath = resolveProjectPath(project.id, 'exports/bad "name".html');
    await fs.mkdir(path.dirname(htmlPath.absolutePath), { recursive: true });
    await fs.writeFile(htmlPath.absolutePath, '<main>download</main>');
    const htmlResponse = await designRoutes.request(
      `/projects/${project.id}/blob?path=${encodeURIComponent('exports/bad "name".html')}`,
    );
    expect(htmlResponse.status).toBe(200);
    expect(htmlResponse.headers.get('content-disposition')).toBe(
      'attachment; filename="bad _name_.html"',
    );

    const unsupportedPath = resolveProjectPath(
      project.id,
      'assets/generated/raw.bin',
    );
    await fs.writeFile(unsupportedPath.absolutePath, 'raw');
    const unsupported = await designRoutes.request(
      `/projects/${project.id}/blob?path=${encodeURIComponent('assets/generated/raw.bin')}`,
    );
    expect(unsupported.status).toBe(415);
    await expect(unsupported.json()).resolves.toMatchObject({
      error: 'UNSUPPORTED_FILE_TYPE',
    });

    const disguisedHtmlPath = resolveProjectPath(
      project.id,
      'assets/generated/not-an-image.png',
    );
    await fs.writeFile(
      disguisedHtmlPath.absolutePath,
      '<!doctype html><main>sign in</main>',
    );
    const disguisedHtml = await designRoutes.request(
      `/projects/${project.id}/blob?path=${encodeURIComponent('assets/generated/not-an-image.png')}`,
    );
    expect(disguisedHtml.status).toBe(415);
    await expect(disguisedHtml.json()).resolves.toMatchObject({
      error: 'INVALID_IMAGE_CONTENT',
    });

    const largePath = resolveProjectPath(
      project.id,
      'assets/generated/large.png',
    );
    await fs.writeFile(largePath.absolutePath, '');
    await fs.truncate(largePath.absolutePath, 51 * 1024 * 1024);
    const oversized = await designRoutes.request(
      `/projects/${project.id}/blob?path=${encodeURIComponent('assets/generated/large.png')}`,
    );
    expect(oversized.status).toBe(413);
    await expect(oversized.json()).resolves.toMatchObject({
      error: 'FILE_TOO_LARGE',
      maxBytes: 50 * 1024 * 1024,
    });

    const traversal = await designRoutes.request(
      `/projects/${project.id}/blob?path=${encodeURIComponent('../secret.png')}`,
    );
    expect(traversal.status).toBeGreaterThanOrEqual(400);
  });

  it('creates and refreshes project-native live artifacts from project JSON', async () => {
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { writeProjectTextFile, resolveProjectPath } =
      await import('@/shared/services/design-mode/fs');
    const { designRoutes } = await import('@/app/api/design');
    const project = await createDesignProject({
      title: 'Live report',
      surface: 'prototype',
    });
    await writeProjectTextFile(
      project.id,
      'artifacts/data.json',
      JSON.stringify({ metric: 7 }),
    );

    const connectors = await designRoutes.request('/connectors');
    expect(connectors.status).toBe(200);
    const connectorData = (await connectors.json()) as {
      connectors: Array<{ id: string; access: string; configured: boolean }>;
    };
    expect(connectorData.connectors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'project-json',
          access: 'read',
          configured: true,
        }),
      ]),
    );

    const created = await designRoutes.request(
      `/projects/${project.id}/live-artifacts`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: 'Metric report',
          source: { kind: 'project-file', path: 'artifacts/data.json' },
          templateHtml:
            '<html><body><script>window.report = {{DATA_JSON}}</script></body></html>',
        }),
      },
    );
    expect(created.status).toBe(201);
    const createdData = (await created.json()) as {
      liveArtifact: { id: string; entrypointPath: string; status: string };
    };
    expect(createdData.liveArtifact.status).toBe('ready');
    const listed = await designRoutes.request(
      `/projects/${project.id}/live-artifacts`,
    );
    expect(listed.status).toBe(200);
    const listedData = (await listed.json()) as {
      liveArtifacts: Array<{ id: string }>;
    };
    expect(listedData.liveArtifacts.map((item) => item.id)).toContain(
      createdData.liveArtifact.id,
    );
    await expect(
      fs.readFile(
        resolveProjectPath(project.id, createdData.liveArtifact.entrypointPath)
          .absolutePath,
        'utf-8',
      ),
    ).resolves.toContain('"metric": 7');

    await writeProjectTextFile(
      project.id,
      'artifacts/data.json',
      JSON.stringify({ metric: 9 }),
    );
    const refreshed = await designRoutes.request(
      `/projects/${project.id}/live-artifacts/${createdData.liveArtifact.id}/refresh`,
      { method: 'POST' },
    );
    expect(refreshed.status).toBe(200);
    await expect(
      fs.readFile(
        resolveProjectPath(project.id, createdData.liveArtifact.entrypointPath)
          .absolutePath,
        'utf-8',
      ),
    ).resolves.toContain('"metric": 9');

    const detail = await designRoutes.request(
      `/projects/${project.id}/live-artifacts/${createdData.liveArtifact.id}`,
    );
    expect(detail.status).toBe(200);
    const detailData = (await detail.json()) as {
      provenance: { schema: string; connectorId: string };
      refreshLog: Array<{ status: string }>;
    };
    expect(detailData.provenance.schema).toBe(
      'neuma.design.live-artifact.provenance.v1',
    );
    expect(detailData.provenance.connectorId).toBe('project-json');
    expect(detailData.refreshLog.map((entry) => entry.status)).toContain(
      'ready',
    );
  });

  it('preserves the last live-artifact preview when refresh fails', async () => {
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { writeProjectTextFile, resolveProjectPath } =
      await import('@/shared/services/design-mode/fs');
    const { designRoutes } = await import('@/app/api/design');
    const project = await createDesignProject({
      title: 'Stable live report',
      surface: 'prototype',
    });
    await writeProjectTextFile(
      project.id,
      'artifacts/data.json',
      JSON.stringify({ metric: 'stable' }),
    );
    const created = await designRoutes.request(
      `/projects/${project.id}/live-artifacts`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          source: { kind: 'project-file', path: 'artifacts/data.json' },
          templateHtml: '<main>{{DATA_JSON}}</main>',
        }),
      },
    );
    const createdData = (await created.json()) as {
      liveArtifact: { id: string; entrypointPath: string };
    };
    const entrypoint = resolveProjectPath(
      project.id,
      createdData.liveArtifact.entrypointPath,
    ).absolutePath;
    const before = await fs.readFile(entrypoint, 'utf-8');

    await writeProjectTextFile(project.id, 'artifacts/data.json', '{invalid');
    const refreshed = await designRoutes.request(
      `/projects/${project.id}/live-artifacts/${createdData.liveArtifact.id}/refresh`,
      { method: 'POST' },
    );
    expect(refreshed.status).toBe(200);
    const refreshedData = (await refreshed.json()) as {
      liveArtifact: { status: string; lastError?: string };
    };
    expect(refreshedData.liveArtifact.status).toBe('failed');
    expect(refreshedData.liveArtifact.lastError).toMatch(/JSON/);
    await expect(fs.readFile(entrypoint, 'utf-8')).resolves.toBe(before);
  });

  it('reports content-free DesignMode metrics', async () => {
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { writeProjectTextFile } =
      await import('@/shared/services/design-mode/fs');
    const { designRoutes } = await import('@/app/api/design');
    const project = await createDesignProject({
      title: 'Metrics project',
      surface: 'prototype',
    });
    await writeProjectTextFile(
      project.id,
      'artifacts/index.html',
      '<main data-neuma-id="root"><img src="hero.png"></main>',
    );

    await designRoutes.request(`/projects/${project.id}/file`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        path: 'artifacts/index.html',
        content: '<main data-neuma-id="root"><img src="hero.png"></main>',
      }),
    });
    await designRoutes.request(`/projects/${project.id}/lint`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'artifacts/index.html' }),
    });
    await designRoutes.request(`/projects/${project.id}/edit-target`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        target: { id: 'root' },
        instruction: 'Tighten the layout',
      }),
    });
    const exported = await designRoutes.request(
      `/projects/${project.id}/export`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ format: 'zip' }),
      },
    );
    expect(exported.status).toBe(201);

    const projectMetricsResponse = await designRoutes.request(
      `/projects/${project.id}/metrics`,
    );
    expect(projectMetricsResponse.status).toBe(200);
    const projectMetricsData = (await projectMetricsResponse.json()) as {
      metrics: {
        targetedEditCount: number;
        lintP1Count: number;
        exportFormatUsage: Record<string, number>;
        timeToFirstPreviewMs: number | null;
        timeToFirstExportMs: number | null;
      };
    };
    expect(projectMetricsData.metrics.targetedEditCount).toBe(1);
    expect(projectMetricsData.metrics.lintP1Count).toBeGreaterThanOrEqual(1);
    expect(projectMetricsData.metrics.exportFormatUsage.zip).toBe(1);
    expect(projectMetricsData.metrics.timeToFirstPreviewMs).not.toBeNull();
    expect(projectMetricsData.metrics.timeToFirstExportMs).not.toBeNull();

    const globalMetricsResponse = await designRoutes.request('/metrics');
    expect(globalMetricsResponse.status).toBe(200);
    const globalMetricsData = (await globalMetricsResponse.json()) as {
      metrics: {
        projectCount: number;
        targetedEditCount: number;
        lintP1Count: number;
        exportFormatUsage: Record<string, number>;
      };
    };
    expect(globalMetricsData.metrics.projectCount).toBeGreaterThanOrEqual(1);
    expect(globalMetricsData.metrics.targetedEditCount).toBeGreaterThanOrEqual(
      1,
    );
    expect(globalMetricsData.metrics.lintP1Count).toBeGreaterThanOrEqual(1);
    expect(
      globalMetricsData.metrics.exportFormatUsage.zip,
    ).toBeGreaterThanOrEqual(1);
  });

  it('returns a project debug snapshot with prompts, provenance, and render logs', async () => {
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { appendProjectHistory, resolveProjectPath, writeProjectTextFile } =
      await import('@/shared/services/design-mode/fs');
    const { designRoutes } = await import('@/app/api/design');
    const project = await createDesignProject({
      title: 'Debuggable prototype',
      surface: 'prototype',
    });
    await writeProjectTextFile(
      project.id,
      'prompts/resolved-system.md',
      'System prompt snapshot',
    );
    await writeProjectTextFile(
      project.id,
      'prompts/resolved-user.md',
      'User prompt snapshot',
    );
    await appendProjectHistory(project.id, {
      type: 'edit.target',
      at: new Date().toISOString(),
      instruction: { target: { id: 'hero-title' } },
    });
    await fs.appendFile(
      resolveProjectPath(project.id, 'provenance/assets.jsonl').absolutePath,
      `${JSON.stringify({ assetId: 'asset_debug', path: 'assets/generated/debug.png' })}\n`,
    );
    await fs.appendFile(
      resolveProjectPath(project.id, 'provenance/tasks.jsonl').absolutePath,
      `${JSON.stringify({
        taskId: 'dmtask_debug',
        projectId: project.id,
        surface: 'video',
        model: 'hyperframes-html',
        state: 'running',
        startedAt: new Date().toISOString(),
        progressLines: ['Frame 1/2'],
        providerError: null,
      })}\n`,
    );

    const response = await designRoutes.request(
      `/projects/${project.id}/debug`,
    );
    expect(response.status).toBe(200);
    const data = (await response.json()) as {
      snapshot: {
        project: { id: string };
        prompts: { system: string; user: string };
        provenance: {
          assets: Array<{ assetId?: string }>;
          tasks: Array<{ taskId?: string }>;
        };
        renderLog: string[];
        metrics: { targetedEditCount: number };
      };
    };
    expect(data.snapshot.project.id).toBe(project.id);
    expect(data.snapshot.prompts.system).toContain('System prompt snapshot');
    expect(data.snapshot.prompts.user).toContain('User prompt snapshot');
    expect(data.snapshot.provenance.assets[0]?.assetId).toBe('asset_debug');
    expect(data.snapshot.provenance.tasks[0]?.taskId).toBe('dmtask_debug');
    expect(data.snapshot.renderLog.join('\n')).toContain('Frame 1/2');
    expect(data.snapshot.metrics.targetedEditCount).toBe(1);
  });

  it('reports DesignMode export dependency status', async () => {
    const { designRoutes } = await import('@/app/api/design');
    const response = await designRoutes.request('/dependencies');
    expect(response.status).toBe(200);
    const data = (await response.json()) as {
      dependencies: Array<{ id: string; state: string; usedFor: string[] }>;
    };
    expect(data.dependencies.map((dependency) => dependency.id)).toEqual(
      expect.arrayContaining([
        'sharp',
        'playwright',
        'pandoc',
        'pptxgenjs',
        'ffmpeg',
        'hyperframes',
      ]),
    );
    for (const dependency of data.dependencies) {
      expect(['available', 'missing', 'not-configured']).toContain(
        dependency.state,
      );
      expect(dependency.usedFor.length).toBeGreaterThan(0);
    }
  });

  it('uses global DesignMode budget settings when no project budget overrides them', async () => {
    const { saveSetting } = await import('@/shared/db/operations');
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { getDesignBudgetStatus } =
      await import('@/shared/services/design-mode/budgets');
    saveSetting(
      'designMode',
      JSON.stringify({
        strictProviderMode: true,
        budgets: { maxImageGenerations: 7 },
      }),
    );
    const project = await createDesignProject({
      title: 'Global budget',
      surface: 'image',
    });

    const status = await getDesignBudgetStatus(project);
    expect(status.config.maxImageGenerations).toBe(7);
    expect(status.config.strictProviderMode).toBe(true);
  });

  it('imports a sanitized ZIP into a DesignMode project', async () => {
    const zip = new JSZip();
    zip.file(
      'index.html',
      '<section data-od-id="hero" onclick="alert(1)">Imported</section>',
    );
    zip.file('assets/note.txt', 'safe text');
    const archiveBase64 = await zip.generateAsync({ type: 'base64' });
    const { designRoutes } = await import('@/app/api/design');

    const response = await designRoutes.request('/projects/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Imported ZIP',
        surface: 'prototype',
        archiveBase64,
        archiveName: 'fixture.zip',
      }),
    });
    expect(response.status).toBe(201);
    const data = (await response.json()) as {
      project: { id: string };
      report: Array<{ rule: string; status: string }>;
    };
    expect(data.report.some((item) => item.rule === 'archive-readable')).toBe(
      true,
    );
    const html = await fs.readFile(
      path.join(workDir, 'design-projects', data.project.id, 'index.html'),
      'utf8',
    );
    expect(html).toContain('data-neuma-id="hero"');
    expect(html).not.toContain('onclick');
  });

  it('imports zero-byte deflate entries from Claude Design ZIPs', async () => {
    const archive = buildZipFixture([
      { name: 'index.html', body: Buffer.from('<main>Imported</main>') },
      { name: 'docs/empty.md', body: Buffer.alloc(0) },
    ]);
    const { designRoutes } = await import('@/app/api/design');

    const response = await designRoutes.request('/projects/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Empty deflate ZIP',
        surface: 'prototype',
        archiveBase64: archive.toString('base64'),
        archiveName: 'empty-deflate.zip',
      }),
    });
    expect(response.status).toBe(201);
    const data = (await response.json()) as { project: { id: string } };
    const empty = await fs.readFile(
      path.join(workDir, 'design-projects', data.project.id, 'docs/empty.md'),
    );
    expect(empty.length).toBe(0);
  });

  it('preserves deflated entries when central size is under-reported as zero', async () => {
    const streamedBody = Buffer.from(
      '# streamed entry\n\n' + 'x'.repeat(4096) + '\n',
      'utf8',
    );
    const archive = buildZipFixture([
      { name: 'index.html', body: Buffer.from('<main>Imported</main>') },
      {
        name: 'docs/streamed.md',
        body: streamedBody,
        falsifyCentralUncompressed: true,
      },
    ]);
    const { designRoutes } = await import('@/app/api/design');

    const response = await designRoutes.request('/projects/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Streamed deflate ZIP',
        surface: 'prototype',
        archiveBase64: archive.toString('base64'),
        archiveName: 'streamed-deflate.zip',
      }),
    });
    expect(response.status).toBe(201);
    const data = (await response.json()) as { project: { id: string } };
    const written = await fs.readFile(
      path.join(
        workDir,
        'design-projects',
        data.project.id,
        'docs/streamed.md',
      ),
    );
    expect(written.equals(streamedBody)).toBe(true);
  });

  it('imports multipart project folders with binary files', async () => {
    const form = new FormData();
    form.set('title', 'Multipart folder');
    form.set('surface', 'prototype');
    form.set('entrypoint', 'site/index.html');
    form.append(
      'files',
      new File(
        ['<main data-od-id="root" onclick="alert(1)">Folder</main>'],
        'index.html',
        { type: 'text/html' },
      ),
      'site/index.html',
    );
    form.append(
      'files',
      new File([new Uint8Array([137, 80, 78, 71])], 'hero.png', {
        type: 'image/png',
      }),
      'site/assets/hero.png',
    );
    const { designRoutes } = await import('@/app/api/design');

    const response = await designRoutes.request('/projects/import', {
      method: 'POST',
      body: form,
    });
    expect(response.status).toBe(201);
    const data = (await response.json()) as { project: { id: string } };
    const projectRoot = path.join(workDir, 'design-projects', data.project.id);
    const html = await fs.readFile(
      path.join(projectRoot, 'site/index.html'),
      'utf8',
    );
    expect(html).toContain('data-neuma-id="root"');
    expect(html).not.toContain('onclick');
    await expect(
      fs.readFile(path.join(projectRoot, 'site/assets/hero.png')),
    ).resolves.toEqual(Buffer.from([137, 80, 78, 71]));
  });

  it('blocks imported projects with P0 lint findings until overridden', async () => {
    const { designRoutes } = await import('@/app/api/design');
    const payload = {
      title: 'Linty import',
      surface: 'prototype',
      files: [
        {
          path: 'index.html',
          content: '<main data-neuma-id="root"><p>lorem ipsum</p></main>',
        },
      ],
    };

    const blocked = await designRoutes.request('/projects/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(blocked.status).toBe(409);
    const blockedData = (await blocked.json()) as {
      report: Array<{ rule: string; status: string }>;
      findings: Array<{ id: string; severity: string }>;
    };
    expect(blockedData.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'ai-slop.filler-copy',
          severity: 'p0',
        }),
      ]),
    );
    expect(blockedData.report).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule: 'lint.ai-slop.filler-copy',
          status: 'error',
        }),
      ]),
    );

    const overridden = await designRoutes.request('/projects/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...payload, allowLintOverride: true }),
    });
    expect(overridden.status).toBe(201);
    const data = (await overridden.json()) as {
      project: { id: string };
      report: Array<{ rule: string; status: string }>;
    };
    expect(data.project.id).toMatch(/^design_/);
    expect(data.report).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule: 'lint.ai-slop.filler-copy',
          status: 'error',
        }),
      ]),
    );
  });

  it('rejects encrypted ZIP entries before import', async () => {
    const zip = new JSZip();
    zip.file('index.html', '<main>Encrypted</main>');
    const buffer = Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }));
    patchZipEntryPolicy(buffer, { encrypted: true });
    const { designRoutes } = await import('@/app/api/design');

    const response = await designRoutes.request('/projects/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Encrypted ZIP',
        surface: 'prototype',
        archiveBase64: buffer.toString('base64'),
      }),
    });
    expect(response.status).toBe(400);
    const data = (await response.json()) as {
      report: Array<{ rule: string; status: string }>;
    };
    expect(data.report).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule: 'encrypted-entries',
          status: 'error',
        }),
      ]),
    );
  });

  it('rejects unsupported ZIP compression methods before import', async () => {
    const zip = new JSZip();
    zip.file('index.html', '<main>Unsupported compression</main>');
    const buffer = Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }));
    patchZipEntryPolicy(buffer, { compressionMethod: 12 });
    const { designRoutes } = await import('@/app/api/design');

    const response = await designRoutes.request('/projects/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Unsupported ZIP',
        surface: 'prototype',
        archiveBase64: buffer.toString('base64'),
      }),
    });
    expect(response.status).toBe(400);
    const data = (await response.json()) as {
      report: Array<{ rule: string; status: string }>;
    };
    expect(data.report).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule: 'unsupported-compression',
          status: 'error',
        }),
      ]),
    );
  });

  it('exports a real ZIP bundle without nesting prior exports', async () => {
    const { createDesignProject, addProjectOutput } =
      await import('@/shared/services/design-mode/projects');
    const { appendJsonl, resolveProjectPath, writeProjectTextFile } =
      await import('@/shared/services/design-mode/fs');
    const { designRoutes } = await import('@/app/api/design');
    const project = await createDesignProject({
      title: 'Export ZIP',
      surface: 'prototype',
    });
    await writeProjectTextFile(
      project.id,
      'artifacts/index.html',
      '<main data-neuma-id="root">Export me</main>',
    );
    await addProjectOutput(project.id, {
      id: 'asset_zip',
      kind: 'prototype',
      path: 'artifacts/index.html',
      provider: 'openai',
      model: 'gpt-4.1',
      taskId: 'task_zip',
      createdAt: '2026-05-02T00:00:00.000Z',
    });
    await appendJsonl(
      resolveProjectPath(project.id, 'provenance/assets.jsonl').absolutePath,
      {
        assetId: 'asset_zip',
        path: 'artifacts/index.html',
        provider: 'openai',
        model: 'gpt-4.1',
        taskId: 'task_zip',
        disclosureText: 'AI-generated prototype · OpenAI gpt-4.1 · 2026-05-02',
      },
    );

    const response = await designRoutes.request(
      `/projects/${project.id}/export`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ format: 'zip' }),
      },
    );
    expect(response.status).toBe(201);
    const data = (await response.json()) as {
      export: { path: string; mime: string; disclosurePath: string };
    };
    expect(data.export.mime).toBe('application/zip');
    const buffer = await fs.readFile(
      path.join(workDir, 'design-projects', project.id, data.export.path),
    );
    const zip = await JSZip.loadAsync(buffer);
    expect(zip.file('project.json')).toBeTruthy();
    expect(zip.file('artifacts/index.html')).toBeTruthy();
    expect(
      Object.keys(zip.files).some((name) => name.startsWith('exports/')),
    ).toBe(false);
    const disclosure = JSON.parse(
      await zip.file('metadata/designmode-disclosure.json')!.async('string'),
    ) as {
      schema: string;
      assets: Array<{ assetId?: string; disclosureText?: string }>;
      signing: { status: string };
    };
    expect(disclosure.schema).toBe('neuma.design.export-disclosure.v1');
    expect(disclosure.assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assetId: 'asset_zip',
          disclosureText:
            'AI-generated prototype · OpenAI gpt-4.1 · 2026-05-02',
        }),
      ]),
    );
    expect(disclosure.signing.status).toBe('unsigned');
    const sidecar = JSON.parse(
      await fs.readFile(
        path.join(
          workDir,
          'design-projects',
          project.id,
          data.export.disclosurePath,
        ),
        'utf-8',
      ),
    ) as { export: { path: string } };
    expect(sidecar.export.path).toBe(data.export.path);
  });

  it('exports an HTML artifact as deterministic HTML', async () => {
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { writeProjectTextFile } =
      await import('@/shared/services/design-mode/fs');
    const { designRoutes } = await import('@/app/api/design');
    const project = await createDesignProject({
      title: 'HTML export',
      surface: 'prototype',
    });
    await writeProjectTextFile(
      project.id,
      'artifacts/index.html',
      '<main data-neuma-id="root"><h1>Launch brief</h1></main>',
    );

    const response = await designRoutes.request(
      `/projects/${project.id}/export`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ format: 'html' }),
      },
    );
    expect(response.status).toBe(201);
    const data = (await response.json()) as {
      export: { path: string; mime: string };
    };
    expect(data.export.mime).toBe('text/html');
    await expect(
      fs.readFile(
        path.join(workDir, 'design-projects', project.id, data.export.path),
        'utf-8',
      ),
    ).resolves.toContain('Launch brief');
  });

  it('prefers ready design_2k catalog proxies when inlining Design HTML assets', async () => {
    const { AssetRegistry } = await import('@/shared/assets');
    const { getDatabase } = await import('@/shared/db');
    const { resolveDesignInlineAsset } =
      await import('@/shared/services/design-mode/catalog-assets');
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { resolveProjectPath, writeProjectTextFile } =
      await import('@/shared/services/design-mode/fs');
    const { designRoutes } = await import('@/app/api/design');
    const project = await createDesignProject({
      title: 'Proxy inline export',
      surface: 'prototype',
    });
    await fs.writeFile(path.join(workDir, 'brand-large.png'), 'original bytes');
    const registry = new AssetRegistry();
    const { asset } = await registry.ingest({
      source: 'local_fs',
      storagePath: 'brand-large.png',
      clientRequestId: 'design-inline-proxy-source',
      hint: {
        kind: 'image',
        mime: 'image/png',
        width: 4096,
        height: 3072,
        title: 'Brand large',
      },
    });
    const active = resolveProjectPath(
      project.id,
      `assets/imports/${asset.id}.png`,
    );
    await fs.mkdir(path.dirname(active.absolutePath), { recursive: true });
    await fs.writeFile(active.absolutePath, 'original bytes');
    const contentHash = asset.contentHash;
    if (!contentHash) throw new Error('Expected ingested asset content hash');
    const proxyPath = path.join(
      workDir,
      '.cache',
      'assets',
      'proxies',
      contentHash.slice(0, 2),
      contentHash.slice(2),
      'design_2k.webp',
    );
    await fs.mkdir(path.dirname(proxyPath), { recursive: true });
    await fs.writeFile(proxyPath, 'proxy bytes');
    const realProxyPath = await fs.realpath(proxyPath);
    const now = Date.now();
    const db = getDatabase();
    db.prepare(
      `INSERT INTO asset_cache (
        content_hash, cache_path, bytes, mime, fetched_at, last_used_at,
        origin_provider, origin_connection_id, origin_source_id,
        source_file_hint_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      contentHash,
      active.absolutePath,
      14,
      'image/png',
      now,
      now,
      'local_fs',
      null,
      null,
      null,
    );
    db.prepare(
      `INSERT INTO asset_materializations (
        id, asset_id, scope, scope_id, active_path, content_hash, bytes,
        created_at, license_snapshot_json, client_request_id, role
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      `mat-${asset.id}`,
      asset.id,
      'design_project',
      project.id,
      active.absolutePath,
      contentHash,
      14,
      now,
      null,
      'design-inline-proxy-attach',
      'inline',
    );
    db.prepare(
      `INSERT INTO asset_proxies (
        content_hash, preset, proxy_path, bytes, width, height, generated_at,
        last_used_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(contentHash, 'design_2k', proxyPath, 11, 2048, 1536, now, now);
    expect(
      db
        .prepare(
          `SELECT proxy_path
         FROM asset_proxies
         WHERE content_hash = ? AND preset = 'design_2k'`,
        )
        .get(contentHash),
    ).toMatchObject({ proxy_path: proxyPath });
    expect(registry.proxyPathFor(asset.id, 'design_2k')).toMatchObject({
      absolutePath: realProxyPath,
      mime: 'image/webp',
    });
    expect(
      resolveDesignInlineAsset(project.id, asset.id, { preferProxy: true }),
    ).toMatchObject({
      absolutePath: realProxyPath,
      mime: 'image/webp',
      source: 'proxy',
    });
    await writeProjectTextFile(
      project.id,
      'artifacts/index.html',
      `<main><img src="asset:${asset.id}" alt="Proxy"><img src="asset:${asset.id}" alt="Original" data-full-resolution></main>`,
    );

    const response = await designRoutes.request(
      `/projects/${project.id}/export/file?path=${encodeURIComponent(
        'artifacts/index.html',
      )}&inline=true`,
    );

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain(
      `src="data:image/webp;base64,${Buffer.from('proxy bytes').toString(
        'base64',
      )}"`,
    );
    expect(html).toContain(
      `src="data:image/png;base64,${Buffer.from('original bytes').toString(
        'base64',
      )}"`,
    );
  });

  it('injects required asset attribution into HTML exports', async () => {
    const { AssetRegistry } = await import('@/shared/assets');
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { writeProjectTextFile } =
      await import('@/shared/services/design-mode/fs');
    const { attachCatalogAssetToDesign } =
      await import('@/shared/services/design-mode/catalog-assets');
    const { designRoutes } = await import('@/app/api/design');
    const project = await createDesignProject({
      title: 'Attributed HTML export',
      surface: 'prototype',
    });
    await writeProjectTextFile(
      project.id,
      'artifacts/index.html',
      '<!doctype html><html><body><main><h1>Launch brief</h1></main></body></html>',
    );
    await fs.writeFile(path.join(workDir, 'html-credit.png'), 'image bytes');
    const registry = new AssetRegistry();
    const { asset } = await registry.ingest({
      source: 'local_fs',
      storagePath: 'html-credit.png',
      clientRequestId: 'html-credit-export',
      hint: {
        kind: 'image',
        mime: 'image/png',
        title: 'HTML credit',
        provenance: {
          licenseInfo: {
            provider: 'Pexels',
            license: 'Pexels',
            requiresAttribution: true,
            attributionText: 'Photo by Ada on Pexels',
          },
        },
      },
    });
    await attachCatalogAssetToDesign(project.id, asset.id, {
      clientRequestId: 'html-credit-export-attach',
    });

    const response = await designRoutes.request(
      `/projects/${project.id}/export`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ format: 'html' }),
      },
    );

    expect(response.status).toBe(201);
    const data = (await response.json()) as {
      export: { path: string };
    };
    const exported = await fs.readFile(
      path.join(workDir, 'design-projects', project.id, data.export.path),
      'utf-8',
    );
    expect(exported).toContain('data-neuma-export-attribution="true"');
    expect(exported).toContain('Photo by Ada on Pexels');
  });

  it('blocks standalone image exports when attached assets require attribution', async () => {
    const { AssetRegistry } = await import('@/shared/assets');
    const { createDesignProject, addProjectOutput } =
      await import('@/shared/services/design-mode/projects');
    const { resolveProjectPath } =
      await import('@/shared/services/design-mode/fs');
    const { attachCatalogAssetToDesign } =
      await import('@/shared/services/design-mode/catalog-assets');
    const { designRoutes } = await import('@/app/api/design');
    const project = await createDesignProject({
      title: 'Attributed image export',
      surface: 'image',
    });
    const output = resolveProjectPath(
      project.id,
      'assets/generated/render.png',
    );
    await fs.mkdir(path.dirname(output.absolutePath), { recursive: true });
    await fs.writeFile(output.absolutePath, Buffer.from('png bytes'));
    await addProjectOutput(project.id, {
      id: 'asset_render',
      kind: 'image',
      path: output.relativePath,
      provider: 'local',
      model: 'fixture',
      createdAt: new Date().toISOString(),
    });

    await fs.writeFile(path.join(workDir, 'credited.png'), 'credited image');
    const registry = new AssetRegistry();
    const { asset } = await registry.ingest({
      source: 'local_fs',
      storagePath: 'credited.png',
      clientRequestId: 'credited-image-export',
      hint: {
        kind: 'image',
        mime: 'image/png',
        title: 'Credited image',
        provenance: {
          licenseInfo: {
            provider: 'Pexels',
            license: 'Pexels',
            requiresAttribution: true,
            attributionText: 'Photo by Ada on Pexels',
          },
        },
      },
    });
    await attachCatalogAssetToDesign(project.id, asset.id, {
      clientRequestId: 'credited-image-export-attach',
    });

    const response = await designRoutes.request(
      `/projects/${project.id}/export`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ format: 'png' }),
      },
    );

    expect(response.status).toBe(422);
    const data = (await response.json()) as {
      code?: string;
      error: string;
      dependency?: string;
      source?: string;
    };
    expect(data.code).toBe('attribution_blocked');
    expect(data.error).toMatch(/standalone image files cannot include/i);
    expect(data.dependency).toBe('asset attribution');
    expect(data.source).toBe('asset_materializations');
  });

  it('exports HTML artifacts to PDF through the Playwright renderer', async () => {
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { writeProjectTextFile } =
      await import('@/shared/services/design-mode/fs');
    vi.doMock('playwright', () => ({
      chromium: {
        launch: vi.fn(async () => ({
          newPage: vi.fn(async () => ({
            route: vi.fn(async () => {}),
            goto: vi.fn(async () => {}),
            pdf: vi.fn(async ({ path: pdfPath }: { path: string }) => {
              await fs.writeFile(pdfPath, Buffer.from('%PDF-1.4\nmock\n'));
            }),
          })),
          close: vi.fn(async () => {}),
        })),
      },
    }));
    try {
      const { designRoutes } = await import('@/app/api/design');
      const project = await createDesignProject({
        title: 'PDF render',
        surface: 'prototype',
      });
      await writeProjectTextFile(
        project.id,
        'artifacts/index.html',
        '<main data-neuma-id="root"><h1>Printable</h1></main>',
      );

      const response = await designRoutes.request(
        `/projects/${project.id}/export`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ format: 'pdf' }),
        },
      );
      expect(response.status).toBe(201);
      const data = (await response.json()) as {
        export: { path: string; mime: string; size: number };
      };
      expect(data.export.mime).toBe('application/pdf');
      expect(data.export.size).toBeGreaterThan(0);
      await expect(
        fs.readFile(
          path.join(workDir, 'design-projects', project.id, data.export.path),
          'utf-8',
        ),
      ).resolves.toContain('%PDF-1.4');
    } finally {
      vi.doUnmock('playwright');
    }
  });

  it('exports Markdown documents to PDF through the Playwright renderer', async () => {
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { writeProjectTextFile } =
      await import('@/shared/services/design-mode/fs');
    vi.doMock('playwright', () => ({
      chromium: {
        launch: vi.fn(async () => ({
          newPage: vi.fn(async () => ({
            route: vi.fn(async () => {}),
            goto: vi.fn(async () => {}),
            pdf: vi.fn(async ({ path: pdfPath }: { path: string }) => {
              await fs.writeFile(pdfPath, Buffer.from('%PDF-1.4\nmock\n'));
            }),
          })),
          close: vi.fn(async () => {}),
        })),
      },
    }));
    try {
      const { designRoutes } = await import('@/app/api/design');
      const project = await createDesignProject({
        title: 'Markdown PDF render',
        surface: 'document',
      });
      await writeProjectTextFile(
        project.id,
        'artifacts/document.md',
        '# Printable\n\n- Revenue quality\n- Pipeline clarity',
      );

      const response = await designRoutes.request(
        `/projects/${project.id}/export`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ format: 'pdf' }),
        },
      );
      expect(response.status).toBe(201);
      const data = (await response.json()) as {
        export: { path: string; mime: string; size: number };
      };
      expect(data.export.mime).toBe('application/pdf');
      expect(data.export.size).toBeGreaterThan(0);
      await expect(
        fs.stat(
          path.join(
            workDir,
            'design-projects',
            project.id,
            'exports',
            `${data.export.path
              .split('/')
              .pop()!
              .replace(/\.pdf$/, '')}.render.html`,
          ),
        ),
      ).rejects.toThrow();
    } finally {
      vi.doUnmock('playwright');
    }
  });

  it('exports WAV audio assets to MP3 through ffmpeg when available', async () => {
    const { createDesignProject, addProjectOutput } =
      await import('@/shared/services/design-mode/projects');
    const { resolveProjectPath } =
      await import('@/shared/services/design-mode/fs');
    const { designRoutes } = await import('@/app/api/design');
    const project = await createDesignProject({
      title: 'MP3 export',
      surface: 'audio',
    });
    const wav = resolveProjectPath(project.id, 'assets/generated/audio.wav');
    await fs.mkdir(path.dirname(wav.absolutePath), { recursive: true });
    await fs.writeFile(wav.absolutePath, silentWavBuffer());
    await addProjectOutput(project.id, {
      id: 'asset_wav',
      kind: 'audio',
      path: wav.relativePath,
      mime: 'audio/wav',
      createdAt: new Date().toISOString(),
    });

    const response = await designRoutes.request(
      `/projects/${project.id}/export`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ format: 'mp3' }),
      },
    );
    if (!(await commandAvailable('ffmpeg', ['-version']))) {
      expect(response.status).toBe(422);
      const data = (await response.json()) as { dependency?: string };
      expect(data.dependency).toBe('ffmpeg');
      return;
    }

    expect(response.status).toBe(201);
    const data = (await response.json()) as {
      export: { path: string; mime: string; size: number };
    };
    expect(data.export.mime).toBe('audio/mpeg');
    expect(data.export.size).toBeGreaterThan(0);
    await expect(
      fs.stat(
        path.join(workDir, 'design-projects', project.id, data.export.path),
      ),
    ).resolves.toBeTruthy();
  });

  it('exports slides.json decks to deterministic PPTX bundles', async () => {
    const { createDesignProject, addProjectOutput } =
      await import('@/shared/services/design-mode/projects');
    const { appendJsonl, resolveProjectPath, writeProjectTextFile } =
      await import('@/shared/services/design-mode/fs');
    const { designRoutes } = await import('@/app/api/design');
    const project = await createDesignProject({
      title: 'PPTX deck',
      surface: 'deck',
    });
    await writeProjectTextFile(
      project.id,
      'artifacts/slides.json',
      JSON.stringify({
        slides: [
          {
            id: 'cover',
            title: 'Quarterly Review',
            subtitle: 'DesignMode export',
            bullets: ['Revenue quality', 'Pipeline clarity'],
            notes: 'Speaker notes stay in the source JSON.',
          },
          {
            id: 'close',
            title: 'Next Steps',
            body: 'Align owners\nShip follow-up',
          },
        ],
      }),
    );
    await addProjectOutput(project.id, {
      id: 'asset_deck',
      kind: 'deck',
      path: 'artifacts/slides.json',
      provider: 'openai',
      model: 'gpt-4.1',
      taskId: 'task_deck',
      createdAt: '2026-05-02T00:00:00.000Z',
    });
    await appendJsonl(
      resolveProjectPath(project.id, 'provenance/assets.jsonl').absolutePath,
      {
        assetId: 'asset_deck',
        path: 'artifacts/slides.json',
        provider: 'openai',
        model: 'gpt-4.1',
        taskId: 'task_deck',
        disclosureText: 'AI-generated deck · OpenAI gpt-4.1 · 2026-05-02',
      },
    );

    const response = await designRoutes.request(
      `/projects/${project.id}/export`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ format: 'pptx' }),
      },
    );
    expect(response.status).toBe(201);
    const data = (await response.json()) as {
      export: { path: string; mime: string; size: number };
    };
    expect(data.export.mime).toBe(
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    );
    expect(data.export.size).toBeGreaterThan(0);
    const buffer = await fs.readFile(
      path.join(workDir, 'design-projects', project.id, data.export.path),
    );
    const zip = await JSZip.loadAsync(buffer);
    expect(zip.file('ppt/presentation.xml')).toBeTruthy();
    await expect(
      zip.file('ppt/slides/slide1.xml')!.async('string'),
    ).resolves.toContain('Quarterly Review');
    await expect(
      zip.file('ppt/slides/slide2.xml')!.async('string'),
    ).resolves.toContain('Next Steps');
    await expect(
      zip.file('docProps/custom.xml')!.async('string'),
    ).resolves.toContain('AI-generated deck');
  });

  it('exports Markdown documents to deterministic DOCX bundles', async () => {
    const { createDesignProject, addProjectOutput } =
      await import('@/shared/services/design-mode/projects');
    const { appendJsonl, resolveProjectPath, writeProjectTextFile } =
      await import('@/shared/services/design-mode/fs');
    const { designRoutes } = await import('@/app/api/design');
    const project = await createDesignProject({
      title: 'DOCX export',
      surface: 'document',
    });
    await writeProjectTextFile(
      project.id,
      'artifacts/document.md',
      '# Quarterly Review\n\n- Revenue quality\n- Pipeline clarity\n\nShip follow-up.',
    );
    await addProjectOutput(project.id, {
      id: 'asset_doc',
      kind: 'document',
      path: 'artifacts/document.md',
      provider: 'openai',
      model: 'gpt-4.1',
      taskId: 'task_doc',
      createdAt: '2026-05-02T00:00:00.000Z',
    });
    await appendJsonl(
      resolveProjectPath(project.id, 'provenance/assets.jsonl').absolutePath,
      {
        assetId: 'asset_doc',
        path: 'artifacts/document.md',
        provider: 'openai',
        model: 'gpt-4.1',
        taskId: 'task_doc',
        disclosureText: 'AI-generated document · OpenAI gpt-4.1 · 2026-05-02',
      },
    );

    const response = await designRoutes.request(
      `/projects/${project.id}/export`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ format: 'docx' }),
      },
    );
    expect(response.status).toBe(201);
    const data = (await response.json()) as {
      export: { path: string; mime: string; size: number };
    };
    expect(data.export.mime).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(data.export.size).toBeGreaterThan(0);
    const buffer = await fs.readFile(
      path.join(workDir, 'design-projects', project.id, data.export.path),
    );
    const zip = await JSZip.loadAsync(buffer);
    expect(zip.file('word/document.xml')).toBeTruthy();
    await expect(
      zip.file('word/document.xml')!.async('string'),
    ).resolves.toContain('Quarterly Review');
    await expect(
      zip.file('docProps/custom.xml')!.async('string'),
    ).resolves.toContain('AI-generated document');
  });

  it('reports missing renderers instead of creating JSON fallback exports', async () => {
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { designRoutes } = await import('@/app/api/design');
    const project = await createDesignProject({
      title: 'MP4 export',
      surface: 'video',
    });

    const response = await designRoutes.request(
      `/projects/${project.id}/export`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ format: 'mp4' }),
      },
    );
    expect(response.status).toBe(422);
    const data = (await response.json()) as {
      code?: string;
      error: string;
      dependency?: string;
    };
    expect(data.code).toBe('dependency_missing');
    expect(data.error).toMatch(/MP4 export requires/i);
    expect(data.dependency).toBe('provider video or HyperFrames renderer');
  });

  it('blocks exports when P0 DesignMode lint findings are present', async () => {
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { writeProjectTextFile } =
      await import('@/shared/services/design-mode/fs');
    const { designRoutes } = await import('@/app/api/design');
    const project = await createDesignProject({
      title: 'Blocked export',
      surface: 'prototype',
    });
    await writeProjectTextFile(
      project.id,
      'artifacts/index.html',
      '<main><p>lorem ipsum</p></main>',
    );

    const response = await designRoutes.request(
      `/projects/${project.id}/export`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ format: 'zip' }),
      },
    );
    expect(response.status).toBe(409);
    const data = (await response.json()) as {
      code?: string;
      findings: Array<{ id: string; severity: string }>;
    };
    expect(data.code).toBe('export_blocked_by_lint');
    expect(data.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'ai-slop.filler-copy',
          severity: 'p0',
        }),
      ]),
    );
  });

  it('returns the current output as an asset version when no version index exists', async () => {
    const { createDesignProject, addProjectOutput } =
      await import('@/shared/services/design-mode/projects');
    const { designRoutes } = await import('@/app/api/design');
    const project = await createDesignProject({
      title: 'Version fallback',
      surface: 'image',
    });
    await addProjectOutput(project.id, {
      id: 'asset_test',
      kind: 'image',
      path: 'assets/generated/test.png',
      provider: 'local',
      model: 'fixture',
      createdAt: new Date().toISOString(),
    });

    const response = await designRoutes.request(
      `/projects/${project.id}/assets/asset_test/versions`,
    );
    expect(response.status).toBe(200);
    const data = (await response.json()) as {
      versions: Array<{ id: string; path: string }>;
    };
    expect(data.versions).toEqual([
      expect.objectContaining({
        id: 'asset_test',
        path: 'assets/generated/test.png',
      }),
    ]);
  });

  it('returns asset provenance records with output fallback', async () => {
    const { createDesignProject, addProjectOutput } =
      await import('@/shared/services/design-mode/projects');
    const { appendJsonl, resolveProjectPath } =
      await import('@/shared/services/design-mode/fs');
    const { designRoutes } = await import('@/app/api/design');
    const project = await createDesignProject({
      title: 'Provenance asset',
      surface: 'image',
    });
    await addProjectOutput(project.id, {
      id: 'asset_prov',
      kind: 'image',
      path: 'assets/generated/prov.png',
      provider: 'openai',
      model: 'gpt-image-1.5',
      taskId: 'task_prov',
      createdAt: new Date().toISOString(),
    });
    await appendJsonl(
      resolveProjectPath(project.id, 'provenance/assets.jsonl').absolutePath,
      {
        assetId: 'asset_prov',
        path: 'assets/generated/prov.png',
        provider: 'openai',
        model: 'gpt-image-1.5',
        promptHash: 'sha256:test',
        promptSnapshot: 'prompts/resolved-user.md',
        taskId: 'task_prov',
        disclosureText: 'AI-generated image · OpenAI · 2026-05-02',
      },
    );

    const response = await designRoutes.request(
      `/projects/${project.id}/assets/asset_prov/provenance`,
    );
    expect(response.status).toBe(200);
    const data = (await response.json()) as {
      provenance: { assetId?: string; promptHash?: string };
    };
    expect(data.provenance.assetId).toBe('asset_prov');
    expect(data.provenance.promptHash).toBe('sha256:test');
  });
});

describe('DesignMode evaluation fixtures', () => {
  it('ships fixture projects with manifests, outputs, and provenance', async () => {
    const root = path.resolve(
      import.meta.dirname,
      '../../fixtures/design-projects',
    );
    const expected = [
      'markdown-doc',
      'editorial-image',
      'volcengine-i2v',
      'voiceover-audio',
      'prototype-html',
      'magazine-deck',
      'claude-design-zip',
      'hyperframes-video',
    ];

    await expect(fs.readdir(root)).resolves.toEqual(
      expect.arrayContaining(expected),
    );

    for (const name of expected) {
      const fixtureRoot = path.join(root, name);
      const manifest = designProjectSchema.parse(
        JSON.parse(
          await fs.readFile(path.join(fixtureRoot, 'project.json'), 'utf8'),
        ),
      );
      await expect(
        fs.stat(path.join(fixtureRoot, 'brief.json')),
      ).resolves.toBeTruthy();
      expect(manifest.outputs.length).toBeGreaterThan(0);
      for (const output of manifest.outputs) {
        await expect(
          fs.stat(path.join(fixtureRoot, output.path)),
        ).resolves.toBeTruthy();
      }
      const assetProvenance = await fs.readFile(
        path.join(fixtureRoot, 'provenance/assets.jsonl'),
        'utf8',
      );
      const taskProvenance = await fs.readFile(
        path.join(fixtureRoot, 'provenance/tasks.jsonl'),
        'utf8',
      );
      expect(assetProvenance.trim()).not.toBe('');
      expect(taskProvenance.trim()).not.toBe('');
    }
  });
});

function buildZipFixture(
  entries: Array<{
    name: string;
    body: Buffer;
    method?: 0 | 8;
    falsifyCentralUncompressed?: boolean;
  }>,
): Buffer {
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const method = entry.method ?? 8;
    const name = Buffer.from(entry.name, 'utf8');
    const compressed = method === 0 ? entry.body : deflateRawSync(entry.body);
    const crc = Buffer.alloc(4);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    crc.copy(local, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.body.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localChunks.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    crc.copy(central, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(
      entry.falsifyCentralUncompressed ? 0 : entry.body.length,
      24,
    );
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralChunks.push(central, name);

    offset += local.length + name.length + compressed.length;
  }

  const localBlob = Buffer.concat(localChunks);
  const centralBlob = Buffer.concat(centralChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBlob.length, 12);
  eocd.writeUInt32LE(localBlob.length, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([localBlob, centralBlob, eocd]);
}

function patchZipEntryPolicy(
  buffer: Buffer,
  patch: { encrypted?: boolean; compressionMethod?: number },
) {
  let offset = 0;
  while (offset <= buffer.length - 4) {
    const signature = buffer.readUInt32LE(offset);
    if (signature === 0x04034b50 && offset <= buffer.length - 30) {
      if (patch.encrypted) {
        buffer.writeUInt16LE(
          buffer.readUInt16LE(offset + 6) | 0x01,
          offset + 6,
        );
      }
      if (patch.compressionMethod !== undefined) {
        buffer.writeUInt16LE(patch.compressionMethod, offset + 8);
      }
      const nameLength = buffer.readUInt16LE(offset + 26);
      const extraLength = buffer.readUInt16LE(offset + 28);
      offset += 30 + nameLength + extraLength;
      continue;
    }
    if (signature === 0x02014b50 && offset <= buffer.length - 46) {
      if (patch.encrypted) {
        buffer.writeUInt16LE(
          buffer.readUInt16LE(offset + 8) | 0x01,
          offset + 8,
        );
      }
      if (patch.compressionMethod !== undefined) {
        buffer.writeUInt16LE(patch.compressionMethod, offset + 10);
      }
      const nameLength = buffer.readUInt16LE(offset + 28);
      const extraLength = buffer.readUInt16LE(offset + 30);
      const commentLength = buffer.readUInt16LE(offset + 32);
      offset += 46 + nameLength + extraLength + commentLength;
      continue;
    }
    offset += 1;
  }
}

async function readStreamUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  marker: string,
) {
  const decoder = new TextDecoder();
  let text = '';
  const deadline = Date.now() + 1000;
  while (!text.includes(marker)) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new Error(`Timed out waiting for ${marker}; received ${text}`);
    }
    const result = await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('Timed out reading stream')),
          remaining,
        ),
      ),
    ]);
    if (result.done) break;
    text += decoder.decode(result.value, { stream: true });
  }
  return text;
}

async function commandAvailable(command: string, args: string[]) {
  const { execFile } = await import('node:child_process');
  return new Promise<boolean>((resolve) => {
    const child = execFile(command, args, { timeout: 1500 }, (error) => {
      resolve(!error);
    });
    child.on('error', () => resolve(false));
  });
}

function silentWavBuffer() {
  const sampleRate = 8000;
  const samples = sampleRate / 10;
  const bytesPerSample = 2;
  const dataSize = samples * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * bytesPerSample, 28);
  buffer.writeUInt16LE(bytesPerSample, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}
