import { useLocation, useNavigate } from 'react-router-dom';

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { MediaProgressCard } from '@/components/artifacts/media/MediaProgressCard';
import { AssetCard } from '@/components/design/AssetCard';
import { AssetProvenanceDialog } from '@/components/design/AssetProvenanceDialog';
import { CompareModal } from '@/components/design/CompareModal';
import { DesignDebugDrawer } from '@/components/design/DesignDebugDrawer';
import { DesignProjectActivity } from '@/components/design/DesignProjectActivity';
import { DesignSystemPreviewModal } from '@/components/design/DesignSystemPreviewModal';
import { designSystemTheme } from '@/components/design/designSystemTheme';
import { DesignEntryView } from '@/components/design/EntryView';
import { ExportsDrawer } from '@/components/design/ExportsDrawer';
import { FidelityPicker } from '@/components/design/FidelityPicker';
import { FileViewer } from '@/components/design/FileViewer';
import { FileWorkspace } from '@/components/design/FileWorkspace';
import { ImportDialog } from '@/components/design/ImportDialog';
import { NewProjectPanel } from '@/components/design/NewProjectPanel';
import { DesignProjectView } from '@/components/design/ProjectView';
import {
  queuedDesignSendsStorageKey,
  type QueuedDesignSend,
} from '@/components/design/queued-design-sends';
import { SurfaceTabsShell } from '@/components/design/SurfaceTabs';
import { DesignsTab } from '@/components/design/tabs/DesignsTab';
import { DesignSystemsTab } from '@/components/design/tabs/DesignSystemsTab';
import { ExamplesTab } from '@/components/design/tabs/ExamplesTab';
import { PromptTemplatesTab } from '@/components/design/tabs/PromptTemplatesTab';
import { SkillsTab } from '@/components/design/tabs/SkillsTab';
import { DesignModeSettings } from '@/components/settings/tabs/DesignModeSettings';
import { defaultSettings, saveSettings } from '@/shared/db/settings';
import type {
  DesignDebugSnapshot,
  DesignJuryRun,
  DesignProject,
  DesignSkillRecord,
  DesignTaskRecord,
  PromptTemplateSnapshot,
} from '@/shared/types/design-mode';

import { renderWithProviders } from './helpers/render-with-providers';

const pdfPrintMock = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('@/components/design/pdf-print', () => ({
  printArtifactPdfInput: pdfPrintMock,
}));

describe('DesignMode UI', () => {
  const selectSurface = async (
    user: ReturnType<typeof userEvent.setup>,
    name: RegExp,
  ) => {
    await user.click(screen.getByTestId('design-surface-picker'));
    await user.click(await screen.findByRole('menuitemradio', { name }));
  };

  // Secondary project actions moved into the header overflow menu
  // (Fix-sync Phase 01). Open it, then return the requested menu item.
  const openHeaderMenuItem = async (
    user: ReturnType<typeof userEvent.setup>,
    name: RegExp,
  ) => {
    await user.click(screen.getByRole('button', { name: /more actions/i }));
    return screen.findByRole('menuitem', { name });
  };

  it('switches surface tabs with aria selected state', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithProviders(
      <SurfaceTabsShell value="document" onChange={onChange} />,
    );
    await selectSurface(user, /media/i);
    expect(onChange).toHaveBeenCalledWith('media');
  });

  it('preserves per-surface panel state while switching tabs', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <NewProjectPanel
        designSystems={[]}
        skills={[]}
        imageTemplates={[]}
        videoTemplates={[]}
        onCreated={vi.fn()}
      />,
    );
    await user.clear(screen.getByPlaceholderText('Project name'));
    await user.type(screen.getByPlaceholderText('Project name'), 'Prototype A');
    await selectSurface(user, /media/i);
    await user.type(screen.getByPlaceholderText('Project name'), 'Image B');
    await selectSurface(user, /prototype/i);
    expect(screen.getByPlaceholderText('Project name')).toHaveValue(
      'Prototype A',
    );
  });

  it('keeps DesignMode tab navigation in browser history', async () => {
    const user = userEvent.setup();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/projects')) return jsonResponse({ projects: [] });
      if (url.endsWith('/design-systems')) {
        return jsonResponse({ designSystems: [] });
      }
      if (url.endsWith('/skills')) return jsonResponse({ skills: [] });
      if (url.includes('/prompt-templates')) {
        return jsonResponse({ templates: [] });
      }
      return jsonResponse({});
    }) as typeof fetch;

    try {
      renderWithProviders(
        <>
          <DesignEntryView />
          <LocationProbe />
        </>,
        { initialEntries: ['/', '/design'] },
      );

      await user.click(
        await screen.findByRole('button', { name: /design systems/i }),
      );
      expect(screen.getByTestId('route-probe')).toHaveTextContent(
        '/design#design-systems',
      );
      await user.click(screen.getByRole('button', { name: /browser back/i }));
      expect(screen.getByTestId('route-probe')).toHaveTextContent('/design');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('opens the new project panel on audio from route search', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/projects')) return jsonResponse({ projects: [] });
      if (url.endsWith('/design-systems'))
        return jsonResponse({ designSystems: [] });
      if (url.endsWith('/skills')) return jsonResponse({ skills: [] });
      if (url.includes('/prompt-templates')) {
        return jsonResponse({ templates: [] });
      }
      return jsonResponse({});
    }) as typeof fetch;

    try {
      renderWithProviders(<DesignEntryView />, {
        initialEntries: ['/design?surface=audio'],
      });

      expect(screen.getByTestId('design-surface-picker')).toHaveTextContent(
        /media/i,
      );
      expect(screen.getByRole('button', { name: /^audio$/i })).toHaveAttribute(
        'data-active',
        'true',
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('routes video template intent to video templates while preserving search', async () => {
    const user = userEvent.setup();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/projects')) return jsonResponse({ projects: [] });
      if (url.endsWith('/design-systems')) {
        return jsonResponse({ designSystems: [] });
      }
      if (url.endsWith('/skills')) return jsonResponse({ skills: [] });
      if (url.includes('/prompt-templates')) {
        return jsonResponse({ templates: [] });
      }
      return jsonResponse({});
    }) as typeof fetch;

    try {
      renderWithProviders(
        <>
          <DesignEntryView />
          <LocationProbe />
        </>,
        { initialEntries: ['/design?surface=video'] },
      );

      await user.click(
        await screen.findByRole('radio', { name: /^from template$/i }),
      );

      expect(screen.getByTestId('route-probe')).toHaveTextContent(
        '/design?surface=video#video-templates',
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('creates an image project from the intent entry', async () => {
    const user = userEvent.setup();
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (
          url.endsWith('/projects') &&
          (!init || !init.method || init.method === 'GET')
        ) {
          return jsonResponse({ projects: [] });
        }
        if (url.endsWith('/design-systems')) {
          return jsonResponse({ designSystems: [] });
        }
        if (url.endsWith('/skills')) return jsonResponse({ skills: [] });
        if (url.includes('/prompt-templates')) {
          return jsonResponse({ templates: [] });
        }
        return jsonResponse({
          project: {
            id: 'design_intent_image',
            title: 'Hero concept',
            surface: 'image',
            status: 'draft',
            skillId: null,
            designSystemId: null,
            inspirationDesignSystemIds: [],
            craftRefs: [],
            brief: {},
            outputs: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        });
      },
    );
    globalThis.fetch = fetchMock as typeof fetch;

    try {
      renderWithProviders(<DesignEntryView />, {
        initialEntries: ['/design'],
      });

      await user.click(await screen.findByRole('radio', { name: /^image$/i }));
      await user.type(
        screen.getByPlaceholderText(/describe the output/i),
        'Hero concept',
      );
      await user.click(screen.getByRole('button', { name: /^start$/i }));

      await waitFor(() =>
        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining('/design/projects'),
          expect.objectContaining({ method: 'POST' }),
        ),
      );
      const [, init] = fetchMock.mock.calls.find(
        ([url, requestInit]) =>
          String(url).includes('/design/projects') &&
          requestInit?.method === 'POST',
      )!;
      expect(JSON.parse(String(init?.body))).toMatchObject({
        title: 'Hero concept',
        surface: 'image',
        intent: 'media',
        brief: {
          prompt: 'Hero concept',
          createdFromIntent: 'image',
        },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('passes configured project defaults when creating', async () => {
    const user = userEvent.setup();
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        jsonResponse({
          project: {
            id: 'design_defaulted',
            title: 'Prototype',
            surface: 'prototype',
            status: 'draft',
            skillId: 'bundled:mobile-app',
            designSystemId: 'default-freeform',
            inspirationDesignSystemIds: [],
            craftRefs: [],
            brief: {},
            outputs: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    try {
      renderWithProviders(
        <NewProjectPanel
          designSystems={[
            {
              id: 'default-freeform',
              title: 'Default Freeform',
              category: 'General',
              summary: 'Neutral starter system',
              body: '',
              swatches: [],
              tokens: [],
            },
          ]}
          skills={[
            {
              id: 'bundled:mobile-app',
              name: 'Mobile App',
              slug: 'mobile-app',
              description: 'Builds mobile app prototypes',
              source: 'skill/SKILL.md',
              od: {
                surface: 'prototype',
                warnings: [],
              },
            },
          ]}
          imageTemplates={[]}
          videoTemplates={[]}
          defaultDesignSystemId="default-freeform"
          defaultSkillId="mobile-app"
          onCreated={vi.fn()}
        />,
      );

      await user.click(screen.getByRole('button', { name: /^create$/i }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      const [, init] = fetchMock.mock.calls[0]!;
      expect(JSON.parse(String(init?.body))).toMatchObject({
        surface: 'prototype',
        designSystemId: 'default-freeform',
        skillId: 'bundled:mobile-app',
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('uses prompt template detail as the pending prompt when creating', async () => {
    const user = userEvent.setup();
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, _init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/prompt-templates/image/editorial')) {
          return jsonResponse({
            template: {
              id: 'editorial',
              surface: 'image',
              title: 'Editorial',
              prompt: 'Template prompt text',
            },
          });
        }
        return jsonResponse({
          project: designProjectFixture({
            id: 'design_template',
            surface: 'image',
          }),
        });
      },
    );
    globalThis.fetch = fetchMock as typeof fetch;

    try {
      renderWithProviders(
        <NewProjectPanel
          designSystems={[]}
          skills={[]}
          imageTemplates={[
            {
              id: 'editorial',
              surface: 'image',
              title: 'Editorial',
              prompt: '',
            },
          ]}
          videoTemplates={[]}
          onCreated={vi.fn()}
        />,
      );

      await selectSurface(user, /media/i);
      await user.selectOptions(screen.getByRole('combobox'), ['editorial']);
      await user.click(screen.getByRole('button', { name: /^create$/i }));

      await waitFor(() =>
        expect(
          fetchMock.mock.calls.some(
            ([input, init]) =>
              String(input).includes('/design/projects') &&
              init?.method === 'POST',
          ),
        ).toBe(true),
      );
      const createCall = fetchMock.mock.calls.find(
        ([input, init]) =>
          String(input).includes('/design/projects') && init?.method === 'POST',
      );
      expect(createCall).toBeDefined();
      const [, init] = createCall!;
      expect(JSON.parse(String(init?.body))).toMatchObject({
        brief: {
          prompt: 'Template prompt text',
          createdFromTemplate: true,
        },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('opens example cards and dispatches the selected example prompt', async () => {
    const user = userEvent.setup();
    const skill: DesignSkillRecord = {
      id: 'bundled:image-poster',
      name: 'image-poster',
      slug: 'image-poster',
      description: 'Poster generation skill',
      source: 'bundled',
      od: {
        surface: 'image',
        scenario: 'design',
        examplePrompt: 'Create an editorial poster.',
        warnings: [],
      },
    };
    const otherSkill: DesignSkillRecord = {
      id: 'bundled:video-trailer',
      name: 'video-trailer',
      slug: 'video-trailer',
      description: 'Trailer generation skill',
      source: 'bundled',
      od: {
        surface: 'video',
        scenario: 'social',
        examplePrompt: 'Create a launch trailer.',
        warnings: [],
      },
    };
    const onUsePrompt = vi.fn().mockResolvedValue(undefined);

    renderWithProviders(
      <ExamplesTab skills={[skill, otherSkill]} onUsePrompt={onUsePrompt} />,
    );

    await user.type(screen.getByTestId('examples-search'), 'editorial');
    expect(
      screen.getByTestId('example-card-bundled:image-poster'),
    ).toBeVisible();
    expect(
      screen.queryByTestId('example-card-bundled:video-trailer'),
    ).not.toBeInTheDocument();
    await user.clear(screen.getByTestId('examples-search'));
    await user.click(screen.getByTestId('examples-surface-filter-video'));
    expect(
      screen.getByTestId('example-card-bundled:video-trailer'),
    ).toBeVisible();
    await user.click(screen.getByTestId('examples-surface-filter-all'));

    await user.click(
      screen.getByTestId('example-use-prompt-bundled:image-poster'),
    );
    expect(onUsePrompt).toHaveBeenCalledWith(skill);
  });

  it('opens design system cards and can select a default system', async () => {
    const user = userEvent.setup();
    const system = {
      id: 'modern-neutral',
      title: 'Modern Neutral',
      category: 'Starter',
      summary: 'Clean starter system',
      body: '# Modern Neutral\n\nStarter tokens.',
      swatches: ['#111111', '#f6f6f6'],
      tokens: ['#111111', '#f6f6f6'],
    };
    const otherSystem = {
      id: 'expressive-retail',
      title: 'Expressive Retail',
      category: 'Retail',
      summary: 'High energy retail system',
      body: '# Expressive Retail',
      swatches: ['#e11d48', '#fef3c7'],
      tokens: ['#e11d48', '#fef3c7'],
    };
    const onPreview = vi.fn();
    const onSelectDefault = vi.fn();

    renderWithProviders(
      <DesignSystemsTab
        systems={[system, otherSystem]}
        selectedId="image-poster"
        onPreview={onPreview}
        onSelectDefault={onSelectDefault}
        onCatalogChanged={vi.fn()}
      />,
    );

    expect(
      screen.getByTestId('design-system-preview-modern-neutral'),
    ).toBeVisible();
    expect(
      screen.getByTestId('design-system-icon-modern-neutral'),
    ).toBeVisible();
    await user.type(screen.getByTestId('design-systems-search'), 'retail');
    expect(
      screen.getByTestId('design-system-card-expressive-retail'),
    ).toBeVisible();
    expect(
      screen.queryByTestId('design-system-card-modern-neutral'),
    ).not.toBeInTheDocument();
    await user.clear(screen.getByTestId('design-systems-search'));
    await user.selectOptions(
      screen.getByTestId('design-systems-category-filter'),
      ['Starter'],
    );
    expect(
      screen.getByTestId('design-system-card-modern-neutral'),
    ).toBeVisible();

    await user.click(screen.getByTestId('design-system-card-modern-neutral'));
    expect(onPreview).toHaveBeenCalledWith(system);

    await user.click(
      screen.getByTestId('design-system-default-modern-neutral'),
    );
    expect(onSelectDefault).toHaveBeenCalledWith(system);
  });

  it('installs design system catalog packs without opening preview', async () => {
    const user = userEvent.setup();
    const system = {
      id: 'modern-neutral',
      title: 'Modern Neutral',
      category: 'Starter',
      summary: 'Clean starter system',
      body: '# Modern Neutral',
      swatches: ['#111111', '#f6f6f6'],
      tokens: ['#111111', '#f6f6f6'],
      origin: 'bundled' as const,
    };
    const originalFetch = globalThis.fetch;
    const onPreview = vi.fn();
    const onCatalogChanged = vi.fn();
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({
        designSystem: { ...system, origin: 'installed', canUninstall: true },
      }),
    ) as typeof fetch;

    try {
      renderWithProviders(
        <DesignSystemsTab
          systems={[system]}
          selectedId=""
          onPreview={onPreview}
          onSelectDefault={vi.fn()}
          onCatalogChanged={onCatalogChanged}
        />,
      );

      await user.click(screen.getByRole('button', { name: /^install$/i }));
      await waitFor(() => expect(onCatalogChanged).toHaveBeenCalled());
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining(
          '/design/design-systems/modern-neutral/install',
        ),
        expect.objectContaining({ method: 'POST' }),
      );
      expect(onPreview).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('renders design system preview showcase, tokens, source, and share controls', async () => {
    const user = userEvent.setup();
    const system = {
      id: 'modern-neutral',
      title: 'Modern Neutral',
      category: 'Starter',
      summary: 'Clean starter system',
      body: '# Modern Neutral\n\n- **Primary:** #111111\n- Surface: #f6f6f6',
      swatches: ['#111111', '#f6f6f6', '#2563eb', '#16a34a'],
      tokens: ['#111111', '#f6f6f6', '#2563eb', '#16a34a'],
    };
    const onSelectDefault = vi.fn();

    renderWithProviders(
      <DesignSystemPreviewModal
        system={system}
        selected={false}
        installPending={false}
        installError=""
        onOpenChange={vi.fn()}
        onInstallChange={vi.fn()}
        onSelectDefault={onSelectDefault}
      />,
    );

    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByRole('tab', { name: /showcase/i }),
    ).toHaveAttribute('aria-selected', 'true');
    expect(
      screen.getByTestId('design-system-showcase-modern-neutral'),
    ).toBeVisible();
    expect(
      screen.getByTestId('design-system-spec-modern-neutral'),
    ).toBeVisible();

    await user.click(within(dialog).getByRole('tab', { name: /^tokens$/i }));
    expect(
      screen.getByTestId('design-system-tokens-modern-neutral'),
    ).toBeVisible();

    await user.click(screen.getByTestId('design-system-share'));
    expect(
      within(dialog).getByRole('menuitem', { name: /copy design\.md/i }),
    ).toBeVisible();
    expect(
      within(dialog).getByRole('menuitem', { name: /copy tokens/i }),
    ).toBeVisible();
    await user.click(screen.getByTestId('design-system-fullscreen'));
    expect(
      within(dialog).getByRole('button', { name: /exit fullscreen/i }),
    ).toBeVisible();

    await user.click(
      within(dialog).getByRole('button', { name: /use as default/i }),
    );
    expect(onSelectDefault).toHaveBeenCalledWith(system);
  });

  it('derives readable preview colors for dark design systems', () => {
    const theme = designSystemTheme({
      id: 'anthropic-dark',
      title: 'Anthropic Dark',
      category: 'AI',
      summary: 'Dark warm surfaces',
      body: [
        '- **Primary:** `#141413` — primary text and dark-theme surface.',
        '- **Coral Accent:** `#d97757` — lighter emphasis on dark surfaces.',
        '- **Surface:** `#141413` — dark page background.',
        '- **Text:** `#4d4c48` — text on light warm surfaces.',
      ].join('\n'),
      swatches: ['#141413', '#d97757', '#30302e', '#4d4c48'],
      tokens: ['#141413', '#d97757', '#30302e', '#4d4c48', '#b0aea5'],
    });

    expect(contrast(theme.text, theme.surface)).toBeGreaterThanOrEqual(7);
    expect(contrast(theme.muted, theme.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(theme.onPrimary, theme.primary)).toBeGreaterThanOrEqual(
      4.5,
    );
  });

  it('opens skill cards and dispatches create-from-skill', async () => {
    const user = userEvent.setup();
    const skill: DesignSkillRecord = {
      id: 'bundled:image-poster',
      name: 'image-poster',
      slug: 'image-poster',
      description: 'Poster generation skill',
      source: 'bundled',
      content: '# Image Poster Skill',
      od: {
        surface: 'image',
        scenario: 'design',
        examplePrompt: 'Create an editorial poster.',
        warnings: [],
      },
    };
    const otherSkill: DesignSkillRecord = {
      id: 'bundled:prototype-audit',
      name: 'prototype-audit',
      slug: 'prototype-audit',
      description: 'Reviews prototype flows',
      source: 'bundled',
      content: '# Prototype Audit Skill',
      category: 'Review',
      od: {
        surface: 'prototype',
        scenario: 'audit',
        examplePrompt: 'Review this flow.',
        warnings: [],
      },
    };
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const onSelectDefault = vi.fn();

    renderWithProviders(
      <SkillsTab
        skills={[skill, otherSkill]}
        selectedId="image-poster"
        onCreate={onCreate}
        onSelectDefault={onSelectDefault}
        onCatalogChanged={vi.fn()}
      />,
    );

    expect(
      within(screen.getByTestId('skill-card-bundled:image-poster')).getByRole(
        'button',
        { name: /default skill/i },
      ),
    ).toBeVisible();

    await user.type(screen.getByTestId('skills-search'), 'audit');
    expect(
      screen.getByTestId('skill-card-bundled:prototype-audit'),
    ).toBeVisible();
    expect(
      screen.queryByTestId('skill-card-bundled:image-poster'),
    ).not.toBeInTheDocument();
    await user.clear(screen.getByTestId('skills-search'));
    await user.selectOptions(screen.getByTestId('skills-surface-filter'), [
      'image',
    ]);
    expect(screen.getByTestId('skill-card-bundled:image-poster')).toBeVisible();

    await user.click(screen.getByTestId('skill-card-bundled:image-poster'));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/Image Poster Skill/)).toBeVisible();

    await user.click(
      within(dialog).getByRole('button', { name: /create from skill/i }),
    );
    expect(onCreate).toHaveBeenCalledWith(skill);
  });

  it('treats prompt template cards as preview triggers', async () => {
    const user = userEvent.setup();
    const template: PromptTemplateSnapshot = {
      id: 'editorial-poster',
      surface: 'image',
      title: 'Editorial poster',
      prompt: '',
      summary: 'A poster prompt template',
      category: 'Poster',
      model: 'gpt-image-2',
      aspect: '1:1',
    };
    const otherTemplate: PromptTemplateSnapshot = {
      id: 'cinematic-banner',
      surface: 'image',
      title: 'Cinematic banner',
      prompt: 'Create a banner.',
      summary: 'A banner prompt template',
      category: 'Banner',
      model: 'gpt-image-2',
      aspect: '16:9',
    };
    const onPreview = vi.fn();

    renderWithProviders(
      <PromptTemplatesTab
        surface="image"
        templates={[template, otherTemplate]}
        onPreview={onPreview}
      />,
    );

    await user.type(
      screen.getByTestId('prompt-templates-image-search'),
      'banner',
    );
    expect(
      screen.getByTestId('prompt-template-card-image-cinematic-banner'),
    ).toBeVisible();
    expect(
      screen.queryByTestId('prompt-template-card-image-editorial-poster'),
    ).not.toBeInTheDocument();
    await user.clear(screen.getByTestId('prompt-templates-image-search'));
    await user.selectOptions(
      screen.getByTestId('prompt-templates-image-aspect-filter'),
      ['1:1'],
    );
    expect(
      screen.getByTestId('prompt-template-card-image-editorial-poster'),
    ).toBeVisible();

    await user.click(
      screen.getByTestId('prompt-template-card-image-editorial-poster'),
    );
    expect(onPreview).toHaveBeenCalledWith(template);
  });

  it('contains prompt template card thumbnails instead of cropping them', () => {
    const pauseMock = vi
      .spyOn(window.HTMLMediaElement.prototype, 'pause')
      .mockImplementation(() => {});
    const imageTemplate: PromptTemplateSnapshot = {
      id: 'portrait-poster',
      surface: 'image',
      title: 'Portrait poster',
      prompt: '',
      summary: 'A portrait poster prompt template',
      aspect: '9:16',
      previewImageUrl: 'https://example.test/poster.jpg',
    };
    const videoTemplate: PromptTemplateSnapshot = {
      id: 'portrait-video',
      surface: 'video',
      title: 'Portrait video',
      prompt: '',
      summary: 'A portrait video prompt template',
      aspect: '9:16',
      previewImageUrl: 'https://example.test/poster.jpg',
      previewVideoUrl: 'https://example.test/video.mp4',
    };

    try {
      renderWithProviders(
        <>
          <PromptTemplatesTab
            surface="image"
            templates={[imageTemplate]}
            onPreview={vi.fn()}
          />
          <PromptTemplatesTab
            surface="video"
            templates={[videoTemplate]}
            onPreview={vi.fn()}
          />
        </>,
      );

      const imageCard = screen.getByTestId(
        'prompt-template-card-image-portrait-poster',
      );
      const videoCard = screen.getByTestId(
        'prompt-template-card-video-portrait-video',
      );

      expect(imageCard.querySelector('img')).toHaveClass(
        'absolute',
        'object-contain',
      );
      expect(videoCard.querySelector('img')).toHaveClass(
        'absolute',
        'object-contain',
      );
      expect(videoCard.querySelector('video')).toHaveClass('object-contain');
    } finally {
      pauseMock.mockRestore();
    }
  });

  it('hides empty prompt template filters', () => {
    renderWithProviders(
      <PromptTemplatesTab
        surface="image"
        templates={[
          {
            id: 'plain',
            surface: 'image',
            title: 'Plain',
            prompt: '',
            summary: 'No metadata',
          },
        ]}
        onPreview={vi.fn()}
      />,
    );

    expect(
      screen.queryByTestId('prompt-templates-image-category-filter'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('prompt-templates-image-model-filter'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('prompt-templates-image-aspect-filter'),
    ).not.toBeInTheDocument();
  });

  it('filters the designs tab by title search and surface', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const poster = designProjectFixture({
      id: 'design_poster',
      title: 'Poster project',
      surface: 'image',
    });
    const cutdown = designProjectFixture({
      id: 'design_cutdown',
      title: 'Video cutdown',
      surface: 'video',
    });

    renderWithProviders(
      <DesignsTab
        projects={[poster, cutdown]}
        designSystems={[]}
        onOpen={onOpen}
        onRename={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    await user.type(screen.getByTestId('designs-search'), 'poster');
    expect(screen.getByText('Poster project')).toBeVisible();
    expect(screen.queryByText('Video cutdown')).not.toBeInTheDocument();
    await user.clear(screen.getByTestId('designs-search'));
    await user.selectOptions(screen.getByTestId('designs-surface-filter'), [
      'video',
    ]);
    expect(screen.getByText('Video cutdown')).toBeVisible();
    expect(screen.queryByText('Poster project')).not.toBeInTheDocument();
  });

  it('keeps polling media tasks until the provider reaches a final state', async () => {
    const user = userEvent.setup();
    const originalFetch = globalThis.fetch;
    const onProjectChange = vi.fn();
    const project = designProjectFixture({
      id: 'design_polling',
      title: 'Polling image',
      surface: 'image',
      media: { model: 'gpt-image-2', aspect: '16:9' },
    });
    const runningTask = designTaskFixture({
      taskId: 'dmtask_polling',
      projectId: project.id,
      state: 'running',
      progressLines: ['Task accepted by DesignMode dispatcher.'],
    });
    const doneTask = designTaskFixture({
      ...runningTask,
      state: 'done',
      endedAt: '2026-05-02T00:01:15.000Z',
      outputPath: 'assets/generated/hero.png',
      provider: 'Codex CLI',
      progressLines: [
        'Task accepted by DesignMode dispatcher.',
        'Output written to assets/generated/hero.png.',
      ],
    });
    const completedProject: DesignProject = {
      ...project,
      status: 'complete',
      outputs: [
        {
          id: 'asset_polling',
          kind: 'image',
          path: 'assets/generated/hero.png',
          mime: 'image/png',
          provider: 'Codex CLI',
          model: 'gpt-image-2',
          taskId: doneTask.taskId,
          createdAt: '2026-05-02T00:01:15.000Z',
        },
      ],
    };
    let waitCalls = 0;

    globalThis.fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/capabilities')) {
          return jsonResponse({
            capabilities: {},
            budget: designBudgetFixture(),
            projectId: project.id,
          });
        }
        if (url.endsWith('/files')) {
          return jsonResponse({
            files: [
              {
                name: 'project.json',
                path: 'project.json',
                isDir: false,
                size: 2,
                updatedAt: '2026-05-02T00:00:00.000Z',
              },
            ],
          });
        }
        if (
          url.endsWith(`/projects/${project.id}/media`) &&
          init?.method === 'POST'
        ) {
          return jsonResponse({
            taskId: runningTask.taskId,
            task: runningTask,
          });
        }
        if (url.endsWith(`/tasks/${runningTask.taskId}/wait`)) {
          waitCalls += 1;
          return jsonResponse(
            waitCalls === 1
              ? { status: 'running', task: runningTask, progress: [] }
              : { status: 'done', task: doneTask, progress: [] },
          );
        }
        if (url.endsWith(`/projects/${project.id}`)) {
          return jsonResponse({ project: completedProject });
        }
        return jsonResponse({});
      },
    ) as typeof fetch;

    try {
      renderWithProviders(
        <DesignProjectView
          project={project}
          onBack={vi.fn()}
          onProjectChange={onProjectChange}
        />,
      );

      await user.type(
        screen.getByPlaceholderText('Describe the design you want...'),
        'Create a landing hero image',
      );
      await user.click(screen.getByRole('button', { name: /^send$/i }));

      await waitFor(() => expect(waitCalls).toBe(2));
      await waitFor(() =>
        expect(onProjectChange).toHaveBeenCalledWith(completedProject),
      );
      expect(
        screen.getByText('Output written to assets/generated/hero.png.'),
      ).toBeVisible();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('queues design chat sends while a media task is active', async () => {
    const user = userEvent.setup();
    const originalFetch = globalThis.fetch;
    const onProjectChange = vi.fn();
    const project = designProjectFixture({
      id: 'design_queue',
      title: 'Queued image',
      surface: 'image',
      media: { model: 'gpt-image-2', aspect: '16:9' },
    });
    const firstTask = designTaskFixture({
      taskId: 'dmtask_queue_1',
      projectId: project.id,
      state: 'running',
    });
    const firstDone = designTaskFixture({
      ...firstTask,
      state: 'done',
      endedAt: '2026-05-02T00:01:00.000Z',
      outputPath: 'assets/generated/first.png',
      progressLines: ['First output written.'],
    });
    const secondTask = designTaskFixture({
      taskId: 'dmtask_queue_2',
      projectId: project.id,
      state: 'running',
    });
    const secondDone = designTaskFixture({
      ...secondTask,
      state: 'done',
      endedAt: '2026-05-02T00:02:00.000Z',
      outputPath: 'assets/generated/second.png',
      progressLines: ['Second output written.'],
    });
    const prompts: string[] = [];
    let resolveFirstWait: (response: Response) => void = () => {};
    const firstWait = new Promise<Response>((resolve) => {
      resolveFirstWait = resolve;
    });

    globalThis.fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/capabilities')) {
          return jsonResponse({
            capabilities: {},
            budget: designBudgetFixture(),
            projectId: project.id,
          });
        }
        if (url.endsWith('/files')) {
          return jsonResponse({ files: [] });
        }
        if (
          url.endsWith(`/projects/${project.id}/media`) &&
          init?.method === 'POST'
        ) {
          const body = JSON.parse(String(init.body)) as { prompt: string };
          prompts.push(body.prompt);
          const task = prompts.length === 1 ? firstTask : secondTask;
          return jsonResponse({ taskId: task.taskId, task });
        }
        if (url.endsWith(`/tasks/${firstTask.taskId}/wait`)) {
          return firstWait;
        }
        if (url.endsWith(`/tasks/${secondTask.taskId}/wait`)) {
          return jsonResponse({
            status: 'done',
            task: secondDone,
            progress: [],
          });
        }
        if (url.endsWith(`/projects/${project.id}`)) {
          return jsonResponse({
            project: {
              ...project,
              status: 'complete',
              outputs:
                prompts.length > 1
                  ? [
                      {
                        id: 'asset_second',
                        kind: 'image',
                        path: 'assets/generated/second.png',
                        taskId: secondDone.taskId,
                        createdAt: secondDone.endedAt,
                      },
                    ]
                  : [],
            },
          });
        }
        return jsonResponse({});
      },
    ) as typeof fetch;

    try {
      renderWithProviders(
        <DesignProjectView
          project={project}
          onBack={vi.fn()}
          onProjectChange={onProjectChange}
        />,
      );

      const composer = screen.getByPlaceholderText(
        'Describe the design you want...',
      );
      await user.type(composer, 'First prompt');
      await user.click(screen.getByRole('button', { name: /^send$/i }));

      await waitFor(() => expect(prompts).toEqual(['First prompt']));
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: /cancel task/i }),
        ).not.toBeDisabled(),
      );

      await user.type(composer, 'Second prompt');
      await user.click(screen.getByRole('button', { name: /^send$/i }));

      expect(screen.getByTestId('queued-send-strip')).toBeVisible();
      expect(screen.getByText('Second prompt')).toBeVisible();
      expect(prompts).toEqual(['First prompt']);

      resolveFirstWait(
        jsonResponse({ status: 'done', task: firstDone, progress: [] }),
      );

      await waitFor(() =>
        expect(prompts).toEqual(['First prompt', 'Second prompt']),
      );
      await waitFor(() =>
        expect(onProjectChange).toHaveBeenLastCalledWith(
          expect.objectContaining({ status: 'complete' }),
        ),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('keeps persisted queued sends behind a remounted active task', async () => {
    const originalFetch = globalThis.fetch;
    const { storage, restore } = installStorageMock();
    const onProjectChange = vi.fn();
    const project = designProjectFixture({
      id: 'design_queue_persist',
      title: 'Persisted queue',
      surface: 'image',
      media: { model: 'gpt-image-2', aspect: '16:9' },
    });
    const activeTask = designTaskFixture({
      taskId: 'dmtask_queue_active',
      projectId: project.id,
      state: 'running',
    });
    const activeDone = designTaskFixture({
      ...activeTask,
      state: 'done',
      endedAt: '2026-05-02T00:01:00.000Z',
    });
    const queuedTask = designTaskFixture({
      taskId: 'dmtask_queue_persisted',
      projectId: project.id,
      state: 'running',
    });
    const queuedDone = designTaskFixture({
      ...queuedTask,
      state: 'done',
      endedAt: '2026-05-02T00:02:00.000Z',
    });
    const storageKey = queuedDesignSendsStorageKey(project.id);
    const persistedQueue = [
      {
        id: 'queued_persisted',
        prompt: 'Persisted prompt',
        createdAt: '2026-05-02T00:00:30.000Z',
        status: 'queued',
      },
    ] satisfies QueuedDesignSend[];
    storage.setItem(storageKey, JSON.stringify(persistedQueue));
    const prompts: string[] = [];
    let resolveActiveWait: (response: Response) => void = () => {};
    const activeWait = new Promise<Response>((resolve) => {
      resolveActiveWait = resolve;
    });

    globalThis.fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/capabilities')) {
          return jsonResponse({
            capabilities: {},
            budget: designBudgetFixture(),
            projectId: project.id,
          });
        }
        if (url.endsWith('/tasks')) {
          return jsonResponse({ tasks: [activeTask] });
        }
        if (url.endsWith('/files')) return jsonResponse({ files: [] });
        if (url.endsWith(`/tasks/${activeTask.taskId}/wait`)) {
          return activeWait;
        }
        if (
          url.endsWith(`/projects/${project.id}/media`) &&
          init?.method === 'POST'
        ) {
          const body = JSON.parse(String(init.body)) as { prompt: string };
          prompts.push(body.prompt);
          return jsonResponse({ taskId: queuedTask.taskId, task: queuedTask });
        }
        if (url.endsWith(`/tasks/${queuedTask.taskId}/wait`)) {
          return jsonResponse({
            status: 'done',
            task: queuedDone,
            progress: [],
          });
        }
        if (url.endsWith(`/projects/${project.id}`)) {
          return jsonResponse({ project: { ...project, status: 'complete' } });
        }
        return jsonResponse({});
      },
    ) as typeof fetch;

    try {
      renderWithProviders(
        <DesignProjectView
          project={project}
          onBack={vi.fn()}
          onProjectChange={onProjectChange}
        />,
      );

      expect(await screen.findByText('Persisted prompt')).toBeVisible();
      expect(prompts).toEqual([]);

      resolveActiveWait(
        jsonResponse({ status: 'done', task: activeDone, progress: [] }),
      );

      await waitFor(() => expect(prompts).toEqual(['Persisted prompt']));
      await waitFor(() => expect(storage.getItem(storageKey)).toBeNull());
    } finally {
      globalThis.fetch = originalFetch;
      restore();
    }
  });

  it('keeps failed queued sends visible and retryable', async () => {
    const user = userEvent.setup();
    const originalFetch = globalThis.fetch;
    const { storage, restore } = installStorageMock();
    const project = designProjectFixture({
      id: 'design_queue_failure',
      title: 'Failed queue',
      surface: 'image',
      media: { model: 'gpt-image-2', aspect: '16:9' },
    });
    const retryTask = designTaskFixture({
      taskId: 'dmtask_queue_retry',
      projectId: project.id,
      state: 'done',
      endedAt: '2026-05-02T00:01:00.000Z',
    });
    const storageKey = queuedDesignSendsStorageKey(project.id);
    const persistedQueue = [
      {
        id: 'queued_retry',
        prompt: 'Retry prompt',
        createdAt: '2026-05-02T00:00:30.000Z',
        status: 'queued',
      },
    ] satisfies QueuedDesignSend[];
    storage.setItem(storageKey, JSON.stringify(persistedQueue));
    const prompts: string[] = [];
    let mediaAttempts = 0;

    globalThis.fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/capabilities')) {
          return jsonResponse({
            capabilities: {},
            budget: designBudgetFixture(),
            projectId: project.id,
          });
        }
        if (url.endsWith('/tasks')) return jsonResponse({ tasks: [] });
        if (url.endsWith('/files')) return jsonResponse({ files: [] });
        if (
          url.endsWith(`/projects/${project.id}/media`) &&
          init?.method === 'POST'
        ) {
          const body = JSON.parse(String(init.body)) as { prompt: string };
          prompts.push(body.prompt);
          mediaAttempts += 1;
          if (mediaAttempts === 1) {
            return jsonResponse({ error: 'Provider unavailable' }, 503);
          }
          return jsonResponse({ taskId: retryTask.taskId, task: retryTask });
        }
        if (url.endsWith(`/projects/${project.id}`)) {
          return jsonResponse({ project: { ...project, status: 'complete' } });
        }
        return jsonResponse({});
      },
    ) as typeof fetch;

    try {
      renderWithProviders(
        <DesignProjectView
          project={project}
          onBack={vi.fn()}
          onProjectChange={vi.fn()}
        />,
      );

      await waitFor(() => expect(prompts).toEqual(['Retry prompt']));
      expect(
        await screen.findByText(/Queued send failed: Provider unavailable/i),
      ).toBeVisible();
      await waitFor(() => {
        const stored = JSON.parse(
          storage.getItem(storageKey) ?? '[]',
        ) as Array<{
          status?: string;
        }>;
        expect(stored[0]?.status).toBe('failed');
      });

      await user.click(screen.getByRole('button', { name: /send next/i }));

      await waitFor(() =>
        expect(prompts).toEqual(['Retry prompt', 'Retry prompt']),
      );
      await waitFor(() => expect(storage.getItem(storageKey)).toBeNull());
    } finally {
      globalThis.fetch = originalFetch;
      restore();
    }
  });

  it('does not show an active spinner for completed media tasks', () => {
    const { container } = renderWithProviders(
      <MediaProgressCard
        task={designTaskFixture({
          state: 'done',
          provider: 'Codex CLI',
          progressLines: ['Output written to assets/generated/hero.png.'],
        })}
      />,
    );

    expect(screen.getByText(/Codex CLI · done/)).toBeVisible();
    expect(container.querySelector('.animate-spin')).toBeNull();
  });

  it('updates completed media task detail to the latest progress line', () => {
    const task = designTaskFixture({
      state: 'running',
      progressLines: ['Rendering draft frame...'],
    });
    const { rerender } = renderWithProviders(<MediaProgressCard task={task} />);

    expect(screen.getByText('Rendering draft frame...')).toBeVisible();

    rerender(
      <MediaProgressCard
        task={{
          ...task,
          state: 'done',
          progressLines: [
            'Rendering draft frame...',
            'Output written to assets/generated/hero.png.',
          ],
        }}
      />,
    );

    expect(
      screen.getByText('Output written to assets/generated/hero.png.'),
    ).toBeVisible();
    expect(screen.queryByText('Rendering draft frame...')).toBeNull();
  });

  it('preserves the design chat scroll position across remounts', () => {
    sessionStorage.clear();
    const props = {
      projectId: 'design_scroll',
      brief: {},
      tasks: [designTaskFixture({ taskId: 'task_scroll' })],
      sendError: null,
      juryRun: null,
      juryError: null,
      emptyHint: 'No activity yet',
      scrollStorageKey: 'neuma-design-chat-scroll:test',
      onBriefSubmit: vi.fn().mockResolvedValue(undefined),
    };

    const { unmount } = renderWithProviders(
      <DesignProjectActivity {...props} />,
    );
    const activity = screen.getByTestId('design-project-activity');
    activity.scrollTop = 128;
    fireEvent.scroll(activity);

    expect(sessionStorage.getItem(props.scrollStorageKey)).toBe('128');
    unmount();
    renderWithProviders(<DesignProjectActivity {...props} />);

    expect(screen.getByTestId('design-project-activity').scrollTop).toBe(128);
  });

  it('keeps media flow and ledger behind run details', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <DesignProjectActivity
        projectId="design_flow"
        brief={{ goal: 'Launch hero image' }}
        tasks={[
          designTaskFixture({
            taskId: 'task_flow',
            state: 'done',
            outputPath: 'assets/generated/hero.png',
            provider: 'openai',
            durationMs: 1200,
          }),
        ]}
        sendError={null}
        juryRun={null}
        juryError={null}
        emptyHint="No activity yet"
        onBriefSubmit={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.getByTestId('media-task-summary-card')).toBeVisible();
    expect(screen.queryByTestId('creative-flow-viewer')).toBeNull();

    const runDetails = screen.getByRole('button', { name: /run details/i });
    expect(runDetails).toHaveAttribute('aria-expanded', 'false');
    await user.click(runDetails);

    expect(runDetails).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('creative-flow-viewer')).toBeVisible();
    expect(screen.getByText('Design activity flow')).toBeVisible();
    expect(screen.getByText('3 nodes')).toBeVisible();
    expect(screen.getByText('2 edges')).toBeVisible();
    expect(screen.getByText('hero.png')).toBeVisible();
    expect(screen.getByTestId('creative-execution-ledger')).toHaveTextContent(
      '1200 ms',
    );
  });

  it('batch deletes selected design files through the workspace sidebar', async () => {
    const user = userEvent.setup();
    const originalFetch = globalThis.fetch;
    const originalConfirm = globalThis.confirm;
    const onProjectChange = vi.fn();
    const deleteBodies: unknown[] = [];
    globalThis.confirm = vi.fn(() => true);
    globalThis.fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/files') && init?.method === 'DELETE') {
          deleteBodies.push(JSON.parse(String(init.body)));
          return jsonResponse({
            deleted: [
              {
                path: 'artifacts/one.html',
                trashPath: '.neuma/.trash/now/artifacts/one.html',
                size: 1,
              },
              {
                path: 'artifacts/two.html',
                trashPath: '.neuma/.trash/now/artifacts/two.html',
                size: 1,
              },
            ],
            project: designProjectFixture({ id: 'design_batch_delete' }),
          });
        }
        if (url.endsWith('/files')) {
          return jsonResponse({
            files:
              deleteBodies.length > 0
                ? []
                : [
                    {
                      name: 'artifacts',
                      path: 'artifacts',
                      isDir: true,
                      updatedAt: '2026-05-02T00:00:00.000Z',
                      children: [
                        {
                          name: 'one.html',
                          path: 'artifacts/one.html',
                          isDir: false,
                          size: 1,
                          updatedAt: '2026-05-02T00:00:00.000Z',
                        },
                        {
                          name: 'two.html',
                          path: 'artifacts/two.html',
                          isDir: false,
                          size: 1,
                          updatedAt: '2026-05-02T00:00:00.000Z',
                        },
                      ],
                    },
                  ],
          });
        }
        if (url.includes('/file?path=')) {
          return jsonResponse({
            path: 'artifacts/one.html',
            content: '<h1 />',
          });
        }
        return jsonResponse({});
      },
    ) as typeof fetch;

    try {
      renderWithProviders(
        <FileWorkspace
          projectId="design_batch_delete"
          surface="prototype"
          outputs={[]}
          onProjectChange={onProjectChange}
        />,
      );

      await user.click(
        await screen.findByRole('button', { name: 'Toggle file tree' }),
      );
      await user.click(
        await screen.findByRole('button', { name: 'Folder: artifacts' }),
      );
      await user.click(
        await screen.findByLabelText('Select artifacts/one.html'),
      );
      await user.click(screen.getByLabelText('Select artifacts/two.html'));
      await user.click(
        screen.getByRole('button', { name: 'Delete 2 selected files' }),
      );

      expect(deleteBodies).toEqual([
        { paths: ['artifacts/one.html', 'artifacts/two.html'] },
      ]);
      expect(onProjectChange).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'design_batch_delete' }),
      );
    } finally {
      globalThis.fetch = originalFetch;
      globalThis.confirm = originalConfirm;
    }
  });

  it('filters design files by kind and persists the filter', async () => {
    const user = userEvent.setup();
    const originalFetch = globalThis.fetch;
    const project = designProjectFixture({ id: 'design_file_filter' });
    const patchBodies: unknown[] = [];

    globalThis.fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/files')) {
          return jsonResponse({
            files: [
              {
                name: 'artifacts',
                path: 'artifacts',
                isDir: true,
                children: [
                  {
                    name: 'index.html',
                    path: 'artifacts/index.html',
                    isDir: false,
                    size: 1,
                    updatedAt: '2026-05-02T00:00:00.000Z',
                  },
                  {
                    name: 'hero.png',
                    path: 'assets/hero.png',
                    isDir: false,
                    size: 1,
                    updatedAt: '2026-05-02T00:00:00.000Z',
                  },
                  {
                    name: 'brief.pdf',
                    path: 'exports/brief.pdf',
                    isDir: false,
                    size: 1,
                    updatedAt: '2026-05-02T00:00:00.000Z',
                  },
                ],
              },
            ],
          });
        }
        if (
          url.endsWith('/projects/design_file_filter') &&
          init?.method === 'PATCH'
        ) {
          patchBodies.push(JSON.parse(String(init.body)));
          return jsonResponse({
            project: {
              ...project,
              ui: (patchBodies.at(-1) as Pick<DesignProject, 'ui'>).ui,
            },
          });
        }
        if (url.includes('/file?path=')) {
          return jsonResponse({
            path: 'artifacts/index.html',
            content: '<h1 />',
          });
        }
        return jsonResponse({});
      },
    ) as typeof fetch;

    try {
      renderWithProviders(
        <FileWorkspace
          projectId="design_file_filter"
          project={project}
          surface="prototype"
          outputs={[]}
        />,
      );

      await user.click(
        await screen.findByRole('button', { name: 'Toggle file tree' }),
      );
      await user.click(
        await screen.findByRole('button', { name: 'Folder: artifacts' }),
      );
      expect(
        await screen.findByLabelText('Select artifacts/index.html'),
      ).toBeVisible();
      expect(screen.getByLabelText('Select assets/hero.png')).toBeVisible();

      await user.click(screen.getByLabelText('Filter files by kind'));
      await user.click(await screen.findByRole('option', { name: 'PDF' }));

      expect(screen.getByLabelText('Select exports/brief.pdf')).toBeVisible();
      expect(screen.queryByLabelText('Select artifacts/index.html')).toBeNull();
      expect(screen.queryByLabelText('Select assets/hero.png')).toBeNull();
      await waitFor(() =>
        expect(patchBodies).toContainEqual({
          ui: {
            fileWorkspace: {
              currentDirectory: 'artifacts',
              sortBy: 'name',
              sortDirection: 'asc',
              groupBy: 'none',
              kindFilter: 'pdf',
            },
          },
        }),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('reorders file tabs and persists the order to the project manifest', async () => {
    const originalFetch = globalThis.fetch;
    const project = designProjectFixture({
      id: 'design_tabs',
      ui: {
        fileTabs: {
          order: ['artifacts/one.html', 'artifacts/two.html'],
        },
      },
    });
    const patchBodies: unknown[] = [];

    globalThis.fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/files')) {
          return jsonResponse({
            files: [
              {
                name: 'artifacts',
                path: 'artifacts',
                isDir: true,
                children: [
                  {
                    name: 'one.html',
                    path: 'artifacts/one.html',
                    isDir: false,
                    size: 1,
                    updatedAt: '2026-05-02T00:00:00.000Z',
                  },
                  {
                    name: 'two.html',
                    path: 'artifacts/two.html',
                    isDir: false,
                    size: 1,
                    updatedAt: '2026-05-02T00:00:00.000Z',
                  },
                ],
              },
            ],
          });
        }
        if (url.endsWith('/projects/design_tabs') && init?.method === 'PATCH') {
          patchBodies.push(JSON.parse(String(init.body)));
          return jsonResponse({
            project: {
              ...project,
              ui: (patchBodies.at(-1) as Pick<DesignProject, 'ui'>).ui,
            },
          });
        }
        if (url.includes('/file?path=')) {
          return jsonResponse({
            path: 'artifacts/one.html',
            content: '<h1 />',
          });
        }
        return jsonResponse({});
      },
    ) as typeof fetch;

    try {
      renderWithProviders(
        <FileWorkspace
          projectId="design_tabs"
          project={project}
          surface="prototype"
          outputs={[]}
        />,
      );

      const oneTab = await screen.findByRole('button', {
        name: 'Open artifacts/one.html',
      });
      const twoTab = screen.getByRole('button', {
        name: 'Open artifacts/two.html',
      });
      const dataTransfer = {
        effectAllowed: '',
        setData: vi.fn(),
        getData: vi.fn(() => 'artifacts/two.html'),
      };

      fireEvent.dragStart(twoTab, { dataTransfer });
      fireEvent.dragOver(oneTab, { dataTransfer });
      fireEvent.drop(oneTab, { dataTransfer });

      await waitFor(() =>
        expect(patchBodies).toContainEqual({
          ui: {
            fileTabs: {
              order: ['artifacts/two.html', 'artifacts/one.html'],
            },
          },
        }),
      );
      expect(
        screen.getByRole('button', { name: 'Design Files' }),
      ).toBeVisible();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('pushes file opens into DesignMode project route history', async () => {
    const user = userEvent.setup();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/files')) {
        return jsonResponse({
          files: [
            {
              name: 'artifacts',
              path: 'artifacts',
              isDir: true,
              children: [
                {
                  name: 'one.html',
                  path: 'artifacts/one.html',
                  isDir: false,
                  size: 1,
                  updatedAt: '2026-05-02T00:00:00.000Z',
                },
                {
                  name: 'two.html',
                  path: 'artifacts/two.html',
                  isDir: false,
                  size: 1,
                  updatedAt: '2026-05-02T00:00:00.000Z',
                },
              ],
            },
          ],
        });
      }
      if (url.includes('/file?path=')) {
        return jsonResponse({ path: 'artifacts/one.html', content: '<h1 />' });
      }
      return jsonResponse({});
    }) as typeof fetch;

    try {
      renderWithProviders(
        <>
          <FileWorkspace
            projectId="design_route"
            surface="prototype"
            outputs={[]}
          />
          <LocationProbe />
        </>,
        {
          initialEntries: ['/design/design_route?file=artifacts%2Fone.html'],
        },
      );

      await user.click(
        await screen.findByRole('button', { name: 'Toggle file tree' }),
      );
      await user.click(
        await screen.findByRole('button', { name: 'Folder: artifacts' }),
      );
      await user.click(await screen.findByText('artifacts/two.html'));
      expect(screen.getByTestId('route-probe')).toHaveTextContent(
        '/design/design_route?file=artifacts%2Ftwo.html',
      );
      await user.click(screen.getByRole('button', { name: /browser back/i }));
      expect(screen.getByTestId('route-probe')).toHaveTextContent(
        '/design/design_route?file=artifacts%2Fone.html',
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('pushes project drawer actions into DesignMode route history', async () => {
    const user = userEvent.setup();
    const project = designProjectFixture({ id: 'design_route' });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/capabilities')) {
        return jsonResponse({
          capabilities: {},
          budget: designBudgetFixture(),
          projectId: project.id,
        });
      }
      if (url.endsWith('/design-jury/status')) {
        return jsonResponse({ enabled: false });
      }
      if (url.endsWith('/finalize/state')) {
        return jsonResponse({
          state: {
            exists: false,
            generatedAt: null,
            transcriptMessageCount: null,
            designSystemId: null,
            currentArtifact: null,
            isStale: false,
            staleReason: null,
          },
        });
      }
      if (url.endsWith('/files')) {
        return jsonResponse({
          files: [
            {
              name: 'project.json',
              path: 'project.json',
              isDir: false,
              size: 2,
              updatedAt: '2026-05-02T00:00:00.000Z',
            },
          ],
        });
      }
      if (url.endsWith('/debug')) {
        return jsonResponse({ snapshot: designDebugSnapshotFixture(project) });
      }
      return jsonResponse({});
    }) as typeof fetch;

    try {
      renderWithProviders(
        <>
          <DesignProjectView
            project={project}
            onBack={vi.fn()}
            onProjectChange={vi.fn()}
          />
          <LocationProbe />
        </>,
        {
          initialEntries: ['/', '/design/design_route?file=project.json'],
        },
      );

      await user.click(await openHeaderMenuItem(user, /project debug/i));
      expect(screen.getByTestId('route-probe')).toHaveTextContent(
        '/design/design_route?file=project.json&panel=debug',
      );
      await user.click(screen.getByRole('button', { name: /browser back/i }));
      expect(screen.getByTestId('route-probe')).toHaveTextContent(
        '/design/design_route',
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('saves project-level custom instructions from the project header', async () => {
    const user = userEvent.setup();
    const project = designProjectFixture({ id: 'design_instructions' });
    const updatedProject = {
      ...project,
      customInstructions: 'Use dense enterprise layouts.',
    };
    const onProjectChange = vi.fn();
    const originalFetch = globalThis.fetch;
    const patchBodies: unknown[] = [];
    globalThis.fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/capabilities')) {
          return jsonResponse({
            capabilities: {},
            budget: designBudgetFixture(),
          });
        }
        if (url.endsWith('/design-jury/status')) {
          return jsonResponse({ enabled: false });
        }
        if (url.endsWith('/finalize/state')) {
          return jsonResponse({
            state: {
              exists: false,
              generatedAt: null,
              transcriptMessageCount: null,
              designSystemId: null,
              currentArtifact: null,
              isStale: false,
              staleReason: null,
            },
          });
        }
        if (url.endsWith('/files')) {
          return jsonResponse({ files: [] });
        }
        if (url.endsWith(`/projects/${project.id}`)) {
          patchBodies.push(JSON.parse(String(init?.body)));
          return jsonResponse({ project: updatedProject });
        }
        return jsonResponse({});
      },
    ) as typeof fetch;

    try {
      renderWithProviders(
        <DesignProjectView
          project={project}
          onBack={vi.fn()}
          onProjectChange={onProjectChange}
        />,
      );

      await user.click(await openHeaderMenuItem(user, /instructions/i));
      await user.type(
        screen.getByLabelText(/^instructions$/i),
        'Use dense enterprise layouts.',
      );
      await user.click(screen.getByRole('button', { name: /^save$/i }));

      await waitFor(() =>
        expect(onProjectChange).toHaveBeenCalledWith(updatedProject),
      );
      expect(patchBodies).toEqual([
        { customInstructions: 'Use dense enterprise layouts.' },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('submits folder imports as multipart form data', async () => {
    const user = userEvent.setup();
    const onImported = vi.fn();
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        jsonResponse(
          {
            ok: true,
            project: {
              id: 'design_imported',
              title: 'Imported',
              surface: 'prototype',
              status: 'draft',
              skillId: null,
              designSystemId: null,
              inspirationDesignSystemIds: [],
              craftRefs: [],
              brief: {},
              outputs: [],
              createdAt: '2026-05-02T00:00:00.000Z',
              updatedAt: '2026-05-02T00:00:00.000Z',
            },
            report: [],
          },
          201,
        ),
    );
    globalThis.fetch = fetchMock as typeof fetch;
    const html = withRelativePath(
      new File(['<main>Folder</main>'], 'index.html', {
        type: 'text/html',
      }),
      'site/index.html',
    );
    const image = withRelativePath(
      new File([new Uint8Array([137, 80, 78, 71])], 'hero.png', {
        type: 'image/png',
      }),
      'site/assets/hero.png',
    );

    try {
      renderWithProviders(
        <ImportDialog
          open
          onOpenChange={vi.fn()}
          surface="prototype"
          onImported={onImported}
        />,
      );

      await user.upload(screen.getByLabelText('Choose folder'), [html, image]);
      expect(screen.getByText(/2 selected files/)).toBeVisible();
      await user.click(
        screen.getByRole('button', { name: /create imported project/i }),
      );

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      const [, init] = fetchMock.mock.calls[0]!;
      const body = init?.body;
      expect(body).toBeInstanceOf(FormData);
      const formData = body as FormData;
      expect(formData.get('surface')).toBe('prototype');
      expect(formData.get('entrypoint')).toBe('site/index.html');
      const uploadedFiles = formData.getAll('files') as File[];
      expect(uploadedFiles.map((file) => file.name)).toEqual([
        'site/index.html',
        'site/assets/hero.png',
      ]);
      expect(onImported).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'design_imported' }),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('surfaces import lint blockers and retries with override', async () => {
    const user = userEvent.setup();
    const onImported = vi.fn();
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = init?.body as FormData;
        if (body.get('allowLintOverride') === 'true') {
          return jsonResponse(
            {
              ok: true,
              project: {
                id: 'design_lint_override',
                title: 'Imported',
                surface: 'prototype',
                status: 'draft',
                skillId: null,
                designSystemId: null,
                inspirationDesignSystemIds: [],
                craftRefs: [],
                brief: {},
                outputs: [],
                createdAt: '2026-05-02T00:00:00.000Z',
                updatedAt: '2026-05-02T00:00:00.000Z',
              },
              report: [
                {
                  rule: 'lint.ai-slop.filler-copy',
                  status: 'error',
                  message: 'index.html: Replace placeholder copy.',
                },
              ],
            },
            201,
          );
        }
        return jsonResponse(
          {
            ok: false,
            error: 'Import blocked by P0 DesignMode lint findings',
            report: [
              {
                rule: 'lint.ai-slop.filler-copy',
                status: 'error',
                message: 'index.html: Replace placeholder copy.',
              },
            ],
          },
          409,
        );
      },
    );
    globalThis.fetch = fetchMock as typeof fetch;

    try {
      renderWithProviders(
        <ImportDialog
          open
          onOpenChange={vi.fn()}
          surface="prototype"
          onImported={onImported}
        />,
      );

      await user.upload(
        screen.getByLabelText('Choose ZIP or HTML file'),
        new File(['<main>lorem ipsum</main>'], 'index.html', {
          type: 'text/html',
        }),
      );
      await user.click(
        screen.getByRole('button', { name: /create imported project/i }),
      );

      expect(
        await screen.findByText(/lint\.ai-slop\.filler-copy/i),
      ).toBeVisible();
      await user.click(
        screen.getByRole('checkbox', { name: /allow p0 lint override/i }),
      );
      await user.click(
        screen.getByRole('button', { name: /import with override/i }),
      );

      await waitFor(() =>
        expect(onImported).toHaveBeenCalledWith(
          expect.objectContaining({ id: 'design_lint_override' }),
        ),
      );
      const [, retryInit] = fetchMock.mock.calls[1]!;
      expect((retryInit?.body as FormData).get('allowLintOverride')).toBe(
        'true',
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('renders both fidelity variants', () => {
    renderWithProviders(
      <FidelityPicker value="wireframe" onChange={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: /wireframe/i })).toBeVisible();
    expect(
      screen.getByRole('button', { name: /high fidelity/i }),
    ).toBeVisible();
  });

  it('gates unsupported audio kinds in the new project panel', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <NewProjectPanel
        designSystems={[]}
        skills={[]}
        imageTemplates={[]}
        videoTemplates={[]}
        onCreated={vi.fn()}
      />,
    );

    await selectSurface(user, /media/i);
    await user.click(screen.getByRole('button', { name: /^audio$/i }));

    expect(screen.getByRole('button', { name: /^speech$/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /^voiceover$/i })).toBeEnabled();
    const musicOption = screen.getByRole('button', { name: /^music$/i });
    expect(musicOption).not.toBeDisabled();
    expect(musicOption).toHaveAttribute('aria-disabled', 'true');
    expect(musicOption).toHaveAccessibleDescription('Provider not configured');
    expect(musicOption).toHaveAttribute('title', 'Provider not configured');
  });

  it('runs lint from the file viewer and renders findings', async () => {
    const user = userEvent.setup();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/file?')) {
        return jsonResponse({
          path: 'artifacts/index.html',
          content: '<main data-neuma-id="root">Hello</main>',
        });
      }
      if (url.endsWith('/lint')) {
        return jsonResponse({
          findings: [
            {
              id: 'ai-slop.filler-copy',
              severity: 'p0',
              message: 'Filler copy is not exportable.',
            },
          ],
        });
      }
      return jsonResponse({});
    }) as typeof fetch;

    try {
      renderWithProviders(
        <FileViewer
          projectId="design_test"
          surface="prototype"
          path="artifacts/index.html"
        />,
      );

      await user.click(
        await screen.findByRole('button', { name: /lint now/i }),
      );
      expect(
        (await screen.findAllByText(/1 lint issues/i)).length,
      ).toBeGreaterThanOrEqual(2);
      expect(screen.getAllByText('ai-slop.filler-copy').length).toBeGreaterThan(
        0,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('copies source content from the file viewer', async () => {
    const user = userEvent.setup();
    const originalFetch = globalThis.fetch;
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/file?')) {
        return jsonResponse({
          path: 'artifacts/index.html',
          content: '<main data-neuma-id="root">Hello</main>',
        });
      }
      return jsonResponse({});
    }) as typeof fetch;

    try {
      renderWithProviders(
        <FileViewer
          projectId="design_test"
          surface="prototype"
          path="artifacts/index.html"
        />,
      );

      await user.click(await screen.findByRole('tab', { name: /source/i }));
      await user.click(screen.getByRole('button', { name: /^copy$/i }));
      expect(writeText).toHaveBeenCalledWith(
        '<main data-neuma-id="root">Hello</main>',
      );
      expect(screen.getByRole('button', { name: /copied/i })).toBeVisible();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('batches open preview comments into the next DesignMode send', async () => {
    const user = userEvent.setup();
    const originalFetch = globalThis.fetch;
    const project = designProjectFixture({
      id: 'design_comments',
      surface: 'prototype',
      brief: {},
    });
    const completedProject = {
      ...project,
      updatedAt: '2026-05-02T00:03:00.000Z',
    };
    const mediaBodies: unknown[] = [];
    const patchCalls: string[] = [];

    globalThis.fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/capabilities')) {
          return jsonResponse({
            capabilities: {},
            budget: designBudgetFixture(),
            projectId: project.id,
          });
        }
        if (url.endsWith('/files')) {
          return jsonResponse({ files: [] });
        }
        if (url.endsWith('/comments') && init?.method !== 'POST') {
          return jsonResponse({
            comments: [
              {
                id: 'comment_1',
                status: 'open',
                createdAt: '2026-05-02T00:00:00.000Z',
                attachToChat: true,
                target: {
                  file: 'artifacts/index.html',
                  id: 'hero-cta',
                  label: 'Hero CTA',
                },
                text: 'Make the CTA more concrete.',
              },
            ],
          });
        }
        if (url.includes('/comments/comment_1') && init?.method === 'PATCH') {
          patchCalls.push(String(init.body));
          return jsonResponse({ comments: [] });
        }
        if (
          url.endsWith(`/projects/${project.id}/media`) &&
          init?.method === 'POST'
        ) {
          mediaBodies.push(JSON.parse(String(init.body)));
          const task = designTaskFixture({ state: 'done' });
          return jsonResponse({ taskId: task.taskId, task });
        }
        if (url.endsWith(`/projects/${project.id}`)) {
          return jsonResponse({ project: completedProject });
        }
        return jsonResponse({});
      },
    ) as typeof fetch;

    // This flow tests the media-dispatcher send (comment batching), so pin the
    // chat loop off — it is on by default for agentic surfaces.
    saveSettings({
      ...defaultSettings,
      designMode: { ...defaultSettings.designMode, chatLoop: false },
    });
    try {
      renderWithProviders(
        <DesignProjectView
          project={project}
          onBack={vi.fn()}
          onProjectChange={vi.fn()}
        />,
      );

      await user.type(
        screen.getByPlaceholderText('Describe the design you want...'),
        'Update the preview',
      );
      await user.click(screen.getByRole('button', { name: /^send$/i }));

      await waitFor(() => expect(mediaBodies).toHaveLength(1));
      expect(mediaBodies[0]).toMatchObject({
        prompt: expect.stringContaining('Preview comments to address'),
      });
      expect(JSON.stringify(mediaBodies[0])).toContain('Hero CTA');
      await waitFor(() =>
        expect(patchCalls.some((body) => body.includes('attachToChat'))).toBe(
          true,
        ),
      );
    } finally {
      globalThis.fetch = originalFetch;
      saveSettings(defaultSettings);
    }
  });

  it('runs Design Jury when the backend gate is enabled', async () => {
    const user = userEvent.setup();
    const originalFetch = globalThis.fetch;
    const project = designProjectFixture({
      id: 'design_jury',
      outputs: [
        {
          id: 'output_jury',
          kind: 'html',
          path: 'artifacts/index.html',
          createdAt: '2026-05-02T00:00:00.000Z',
        },
      ],
    });
    const run = designJuryRunFixture({
      projectId: project.id,
      artifactRef: {
        runId: 'jury_test',
        mediaType: 'text/html',
        byteLength: 128,
        sha256:
          '4b7b0a5d4d3ccdb260a39c32f86c3f9d4f5985ef092ac987e704d2329d6460d7',
        url: `/design/projects/${project.id}/design-jury/jury_test/artifact`,
      },
    });
    const juryBodies: unknown[] = [];

    globalThis.fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/design-jury/status')) {
          return jsonResponse({ enabled: true });
        }
        if (url.endsWith('/capabilities')) {
          return jsonResponse({
            capabilities: {},
            budget: designBudgetFixture(),
            projectId: project.id,
          });
        }
        if (url.endsWith('/files')) {
          return jsonResponse({ files: [] });
        }
        if (url.endsWith('/design-jury') && init?.method === 'POST') {
          juryBodies.push(JSON.parse(String(init.body)));
          return jsonResponse({ run }, 201);
        }
        return jsonResponse({});
      },
    ) as typeof fetch;

    // The jury result card renders in the (non-chat-loop) activity view, so
    // pin the chat loop off — it is on by default for agentic surfaces.
    saveSettings({
      ...defaultSettings,
      designMode: { ...defaultSettings.designMode, chatLoop: false },
    });
    try {
      renderWithProviders(
        <DesignProjectView
          project={project}
          onBack={vi.fn()}
          onProjectChange={vi.fn()}
        />,
      );

      await user.click(await openHeaderMenuItem(user, /^design jury$/i));

      await waitFor(() => expect(juryBodies).toHaveLength(1));
      expect(juryBodies[0]).toEqual({ artifactPath: 'artifacts/index.html' });
      const card = await screen.findByTestId('design-jury-card');
      expect(within(card).getByText('Design Jury')).toBeVisible();
      expect(card).toHaveTextContent('8/10');
      expect(card).toHaveTextContent('critique/jury_test/summary.md');
      expect(
        within(card).getByRole('link', { name: /view shipped artifact/i }),
      ).toHaveAttribute(
        'href',
        expect.stringContaining(
          `/design/projects/${project.id}/design-jury/jury_test/artifact`,
        ),
      );
    } finally {
      globalThis.fetch = originalFetch;
      saveSettings(defaultSettings);
    }
  });

  it('finalizes DESIGN.md and copies the CLI handoff prompt', async () => {
    const user = userEvent.setup();
    const project = designProjectFixture({
      id: 'design_finalize',
      title: 'Finalize handoff',
      outputs: [
        {
          id: 'output_finalize',
          kind: 'html',
          path: 'artifacts/index.html',
          createdAt: '2026-05-02T00:00:00.000Z',
        },
      ],
    });
    const originalFetch = globalThis.fetch;
    const writeText = vi.fn(async () => {});
    const originalClipboard = Object.getOwnPropertyDescriptor(
      navigator,
      'clipboard',
    );
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    let finalized = false;
    globalThis.fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/finalize/state')) {
          return jsonResponse({
            state: finalized
              ? {
                  exists: true,
                  generatedAt: '2026-05-10T00:00:00.000Z',
                  transcriptMessageCount: 2,
                  designSystemId: null,
                  currentArtifact: 'artifacts/index.html',
                  isStale: false,
                  staleReason: null,
                }
              : {
                  exists: false,
                  generatedAt: null,
                  transcriptMessageCount: null,
                  designSystemId: null,
                  currentArtifact: null,
                  isStale: false,
                  staleReason: null,
                },
          });
        }
        if (url.endsWith('/finalize') && init?.method === 'POST') {
          finalized = true;
          return jsonResponse(
            {
              result: {
                path: 'DESIGN.md',
                generatedAt: '2026-05-10T00:00:00.000Z',
                runId: 'finalize_test',
                state: {
                  exists: true,
                  generatedAt: '2026-05-10T00:00:00.000Z',
                  transcriptMessageCount: 2,
                  designSystemId: null,
                  currentArtifact: 'artifacts/index.html',
                  isStale: false,
                  staleReason: null,
                },
              },
            },
            201,
          );
        }
        if (url.endsWith(`/projects/${project.id}`)) {
          return jsonResponse({ project });
        }
        if (url.endsWith('/capabilities')) {
          return jsonResponse({
            capabilities: {},
            budget: designBudgetFixture(),
            projectId: project.id,
          });
        }
        if (url.endsWith('/design-jury/status')) {
          return jsonResponse({ enabled: false });
        }
        if (url.endsWith('/files')) {
          return jsonResponse({ files: [] });
        }
        if (url.includes('/file-location?path=DESIGN.md')) {
          return jsonResponse({
            path: 'DESIGN.md',
            absolutePath: '/workspace/design_finalize/DESIGN.md',
          });
        }
        return jsonResponse({});
      },
    ) as typeof fetch;

    try {
      renderWithProviders(
        <DesignProjectView
          project={project}
          onBack={vi.fn()}
          onProjectChange={vi.fn()}
        />,
      );

      // Continue-in-CLI starts disabled (no DESIGN.md yet).
      expect(
        await openHeaderMenuItem(user, /continue in cli/i),
      ).toHaveAttribute('aria-disabled', 'true');
      // Finalize from the same overflow menu (still open).
      await user.click(
        await screen.findByRole('menuitem', {
          name: /finalize design package/i,
        }),
      );
      // Re-open the menu; Continue-in-CLI is now enabled, then invoke it.
      await waitFor(async () =>
        expect(
          await openHeaderMenuItem(user, /continue in cli/i),
        ).not.toHaveAttribute('aria-disabled', 'true'),
      );
      await user.click(
        await screen.findByRole('menuitem', { name: /continue in cli/i }),
      );

      expect(writeText).toHaveBeenCalledWith(
        expect.stringContaining('/workspace/design_finalize/DESIGN.md'),
      );
      // Re-open the overflow menu: the CLI item now reflects the copied state.
      expect(await openHeaderMenuItem(user, /prompt copied/i)).toBeVisible();
    } finally {
      globalThis.fetch = originalFetch;
      if (originalClipboard) {
        Object.defineProperty(navigator, 'clipboard', originalClipboard);
      } else {
        Reflect.deleteProperty(navigator, 'clipboard');
      }
    }
  });

  it('runs the workflow export action through the finalizer', async () => {
    const user = userEvent.setup();
    const project = designProjectFixture({
      id: 'design_workflow_export',
      title: 'Workflow export',
      status: 'complete',
      outputs: [
        {
          id: 'output_workflow_export',
          kind: 'html',
          path: 'artifacts/index.html',
          createdAt: '2026-05-02T00:00:00.000Z',
        },
      ],
    });
    const originalFetch = globalThis.fetch;
    let finalizeCalls = 0;
    globalThis.fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/finalize/state')) {
          return jsonResponse({
            state: {
              exists: false,
              generatedAt: null,
              transcriptMessageCount: null,
              designSystemId: null,
              currentArtifact: null,
              isStale: false,
              staleReason: null,
            },
          });
        }
        if (url.endsWith('/finalize') && init?.method === 'POST') {
          finalizeCalls += 1;
          return jsonResponse(
            {
              result: {
                path: 'DESIGN.md',
                generatedAt: '2026-05-10T00:00:00.000Z',
                runId: 'workflow_export',
                state: {
                  exists: true,
                  generatedAt: '2026-05-10T00:00:00.000Z',
                  transcriptMessageCount: 1,
                  designSystemId: null,
                  currentArtifact: 'artifacts/index.html',
                  isStale: false,
                  staleReason: null,
                },
              },
            },
            201,
          );
        }
        if (url.endsWith(`/projects/${project.id}`)) {
          return jsonResponse({ project });
        }
        if (url.endsWith('/capabilities')) {
          return jsonResponse({
            capabilities: {},
            budget: designBudgetFixture(),
            projectId: project.id,
          });
        }
        if (url.endsWith('/design-jury/status')) {
          return jsonResponse({ enabled: false });
        }
        if (url.endsWith('/files')) {
          return jsonResponse({ files: [] });
        }
        return jsonResponse({});
      },
    ) as typeof fetch;

    try {
      renderWithProviders(
        <DesignProjectView
          project={project}
          onBack={vi.fn()}
          onProjectChange={vi.fn()}
        />,
      );

      await user.click(
        await screen.findByRole('button', { name: /export output/i }),
      );

      await waitFor(() => expect(finalizeCalls).toBe(1));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('surfaces stale DESIGN.md state in the project header', async () => {
    const user = userEvent.setup();
    const project = designProjectFixture({
      id: 'design_stale_spec',
      title: 'Stale handoff',
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/finalize/state')) {
        return jsonResponse({
          state: {
            exists: true,
            generatedAt: null,
            transcriptMessageCount: null,
            designSystemId: null,
            currentArtifact: null,
            isStale: true,
            staleReason: 'unknown-provenance',
          },
        });
      }
      if (url.endsWith('/capabilities')) {
        return jsonResponse({
          capabilities: {},
          budget: designBudgetFixture(),
          projectId: project.id,
        });
      }
      if (url.endsWith('/design-jury/status')) {
        return jsonResponse({ enabled: false });
      }
      if (url.endsWith('/files')) {
        return jsonResponse({ files: [] });
      }
      return jsonResponse({});
    }) as typeof fetch;

    try {
      renderWithProviders(
        <DesignProjectView
          project={project}
          onBack={vi.fn()}
          onProjectChange={vi.fn()}
        />,
      );

      expect(await screen.findByText(/spec freshness unknown/i)).toBeVisible();
      // Finalize + Continue-in-CLI live in the header overflow menu now.
      expect(
        await openHeaderMenuItem(user, /re-finalize \(spec is stale\)/i),
      ).not.toHaveAttribute('aria-disabled', 'true');
      expect(
        screen.getByRole('menuitem', { name: /continue in cli/i }),
      ).not.toHaveAttribute('aria-disabled', 'true');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('renders project debug snapshot details', async () => {
    const user = userEvent.setup();
    const snapshot: DesignDebugSnapshot = {
      project: {
        id: 'design_debug',
        title: 'Debug project',
        surface: 'prototype',
        status: 'draft',
        skillId: null,
        designSystemId: null,
        inspirationDesignSystemIds: [],
        craftRefs: [],
        brief: {},
        outputs: [],
        createdAt: '2026-05-02T00:00:00.000Z',
        updatedAt: '2026-05-02T00:00:00.000Z',
      },
      metrics: {
        projectId: 'design_debug',
        surface: 'prototype',
        status: 'draft',
        assetCount: 1,
        exportCount: 0,
        assetToExportRatio: 1,
        targetedEditCount: 1,
        commentCount: 0,
        lintFindingCount: 2,
        lintP0Count: 1,
        lintP1Count: 1,
        lintFindingCountsByRule: { 'ai-slop.filler-copy': 1 },
        exportFormatUsage: {},
        generationByProviderModel: {},
        timeToFirstPreviewMs: 1200,
        timeToFirstExportMs: null,
        meanRetryCountPerSuccess: 0,
      },
      prompts: {
        system: 'System prompt snapshot',
        user: 'User prompt snapshot',
        template: null,
        stack: {
          version: 'design-prompt-stack.v1',
          generatedAt: '2026-05-02T00:00:02.000Z',
          project: {
            id: 'design_debug',
            surface: 'prototype',
            intent: 'other',
            designSystemId: null,
            resolvedDesignSystemId: null,
            inspirationDesignSystemIds: [],
            skillId: null,
            craftRefs: ['anti-ai-slop'],
            linkedContextDirs: [],
            contextPackIds: [],
            promptTemplateId: null,
            mediaModel: null,
          },
          latestMessageHash: 'a'.repeat(64),
          systemHash: 'b'.repeat(64),
          userHash: 'c'.repeat(64),
          sections: [
            {
              id: 'contract',
              title: 'DesignMode operating contract',
              bodyHash: 'd'.repeat(64),
              bodyBytes: 128,
              cacheControl: null,
            },
          ],
        },
      },
      provenance: {
        assets: [{ assetId: 'asset_debug' }],
        tasks: [{ taskId: 'dmtask_debug' }],
        invalidLines: { assets: 0, tasks: 0, history: 0 },
      },
      runtimeTasks: [],
      renderLog: ['dmtask_debug: Frame 1/2'],
      history: [{ type: 'edit.target', at: '2026-05-02T00:00:01.000Z' }],
      exports: [],
    };

    renderWithProviders(
      <DesignDebugDrawer
        snapshot={snapshot}
        loading={false}
        error={null}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('Project debug')).toBeVisible();
    expect(screen.getByText('1.2s')).toBeVisible();
    await user.click(screen.getByRole('button', { name: /prompts/i }));
    expect(screen.getByText('System prompt snapshot')).toBeVisible();
    expect(screen.getByText('Prompt stack')).toBeVisible();
    expect(screen.getByText(/design-prompt-stack\.v1/)).toBeVisible();
    expect(screen.getByText(/DesignMode operating contract/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: /render log/i }));
    expect(screen.getByText(/Frame 1\/2/)).toBeVisible();
  });

  it('shows export dependency status for renderer-backed formats', async () => {
    const user = userEvent.setup();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/exports')) {
        return jsonResponse({ exports: [] });
      }
      if (url.endsWith('/dependencies')) {
        return jsonResponse({
          dependencies: [
            {
              id: 'playwright',
              label: 'Playwright renderer',
              kind: 'renderer',
              state: 'not-configured',
              usedFor: ['PDF export'],
              reason: 'Installed but not wired.',
              installHint: 'Wire the renderer.',
            },
          ],
        });
      }
      return jsonResponse({});
    }) as typeof fetch;

    try {
      renderWithProviders(
        <ExportsDrawer
          open
          onOpenChange={vi.fn()}
          projectId="design_export"
          surface="deck"
        />,
      );

      await user.click(await screen.findByRole('button', { name: 'PDF' }));
      expect(screen.getByText('Export dependencies')).toBeVisible();
      expect(screen.getByText('Playwright renderer')).toBeVisible();
      expect(screen.getByText('Not configured')).toBeVisible();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('falls back to print-ready PDF input when PDF renderer is unavailable', async () => {
    const user = userEvent.setup();
    const originalFetch = globalThis.fetch;
    pdfPrintMock.mockClear();
    globalThis.fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/exports')) return jsonResponse({ exports: [] });
        if (url.endsWith('/dependencies')) {
          return jsonResponse({ dependencies: [] });
        }
        if (url.endsWith('/export') && init?.method === 'POST') {
          return jsonResponse(
            { error: 'Playwright missing', dependency: 'playwright' },
            400,
          );
        }
        if (url.endsWith('/export/pdf-input') && init?.method === 'POST') {
          return jsonResponse({
            buildInput: {
              baseHref: 'http://localhost/design/projects/design_export/raw/',
              deck: true,
              defaultFilename: 'deck.pdf',
              html: '<!doctype html><title>Deck</title>',
              title: 'Deck',
            },
          });
        }
        return jsonResponse({});
      },
    ) as typeof fetch;

    try {
      renderWithProviders(
        <ExportsDrawer
          open
          onOpenChange={vi.fn()}
          projectId="design_export"
          surface="deck"
        />,
      );

      await user.click(await screen.findByRole('button', { name: 'PDF' }));
      await user.click(screen.getByRole('button', { name: 'Export' }));
      await waitFor(() => {
        expect(pdfPrintMock).toHaveBeenCalledWith(
          expect.objectContaining({
            defaultFilename: 'deck.pdf',
            html: expect.stringContaining('<title>Deck</title>'),
          }),
        );
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('renders export record actions and re-exports existing formats', async () => {
    const user = userEvent.setup();
    const originalFetch = globalThis.fetch;
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/exports')) {
          return jsonResponse({
            exports: [
              {
                id: 'export_existing',
                format: 'html',
                path: 'exports/export_existing.html',
                size: 128,
                createdAt: '2026-05-02T00:00:00.000Z',
              },
            ],
          });
        }
        if (url.endsWith('/dependencies')) {
          return jsonResponse({ dependencies: [] });
        }
        if (url.endsWith('/export') && init?.method === 'POST') {
          return jsonResponse(
            {
              export: {
                id: 'export_next',
                format: 'html',
                path: 'exports/export_next.html',
                size: 256,
                createdAt: '2026-05-02T00:00:01.000Z',
              },
            },
            201,
          );
        }
        return jsonResponse({});
      },
    );
    globalThis.fetch = fetchMock as typeof fetch;

    try {
      renderWithProviders(
        <ExportsDrawer
          open
          onOpenChange={vi.fn()}
          projectId="design_export"
          surface="prototype"
        />,
      );

      expect(
        await screen.findByText('exports/export_existing.html'),
      ).toBeVisible();
      expect(screen.getByRole('link', { name: /open/i })).toHaveAttribute(
        'href',
        expect.stringContaining('exports%2Fexport_existing.html'),
      );
      await user.click(screen.getByRole('button', { name: /copy path/i }));
      expect(writeText).toHaveBeenCalledWith('exports/export_existing.html');
      await user.click(screen.getByRole('button', { name: /re-export/i }));
      expect(await screen.findByText('exports/export_next.html')).toBeVisible();
      const exportCall = fetchMock.mock.calls.find(
        ([input, init]) =>
          String(input).endsWith('/export') && init?.method === 'POST',
      );
      expect(JSON.parse(String(exportCall?.[1]?.body))).toMatchObject({
        format: 'html',
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('shows visible AI disclosure on generated asset cards', () => {
    renderWithProviders(
      <AssetCard
        projectId="design_assets"
        asset={{
          id: 'asset_disclosure',
          kind: 'image',
          path: 'assets/generated/hero.png',
          provider: 'openai',
          model: 'gpt-image-1.5',
          createdAt: '2026-05-02T00:00:00.000Z',
        }}
        onOpen={vi.fn()}
        onVersions={vi.fn()}
        onCompare={vi.fn()}
        onProvenance={vi.fn()}
      />,
    );

    expect(
      screen.getByText(
        'AI-generated image · openai gpt-image-1.5 · 2026-05-02',
      ),
    ).toBeVisible();
  });

  it('renders line-level diffs for text asset versions', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/file?') && url.includes('left.md')) {
        return jsonResponse({
          path: 'assets/generated/left.md',
          content: 'Title\nOld line\nKeep',
        });
      }
      if (url.includes('/file?') && url.includes('right.md')) {
        return jsonResponse({
          path: 'assets/generated/right.md',
          content: 'Title\nNew line\nKeep',
        });
      }
      return jsonResponse({});
    }) as typeof fetch;

    try {
      renderWithProviders(
        <CompareModal
          open
          onOpenChange={vi.fn()}
          projectId="design_compare"
          left={{
            id: 'left',
            kind: 'document',
            path: 'assets/generated/left.md',
            createdAt: '2026-05-02T00:00:00.000Z',
          }}
          right={{
            id: 'right',
            kind: 'document',
            path: 'assets/generated/right.md',
            createdAt: '2026-05-02T00:00:01.000Z',
          }}
        />,
      );

      expect(await screen.findByText('Text diff')).toBeVisible();
      expect(screen.getByText(/- Old line/)).toBeVisible();
      expect(screen.getByText(/\+ New line/)).toBeVisible();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('renders synced video compare controls', () => {
    const playMock = vi
      .spyOn(window.HTMLMediaElement.prototype, 'play')
      .mockResolvedValue();
    const pauseMock = vi
      .spyOn(window.HTMLMediaElement.prototype, 'pause')
      .mockImplementation(() => {});
    try {
      renderWithProviders(
        <CompareModal
          open
          onOpenChange={vi.fn()}
          projectId="design_compare"
          left={{
            id: 'left-video',
            kind: 'video',
            path: 'assets/generated/left.mp4',
            createdAt: '2026-05-02T00:00:00.000Z',
          }}
          right={{
            id: 'right-video',
            kind: 'video',
            path: 'assets/generated/right.mp4',
            createdAt: '2026-05-02T00:00:01.000Z',
          }}
        />,
      );

      expect(screen.getByText('Synced video compare')).toBeVisible();
      expect(screen.getByRole('slider', { name: /scrub/i })).toBeVisible();

      const videos = document.querySelectorAll('video');
      const leftVideo = videos.item(0)!;
      const rightVideo = videos.item(1)!;
      expect(videos).toHaveLength(2);
      Object.defineProperty(leftVideo, 'currentTime', {
        configurable: true,
        value: 4,
        writable: true,
      });
      Object.defineProperty(rightVideo, 'currentTime', {
        configurable: true,
        value: 0,
        writable: true,
      });
      fireEvent.play(leftVideo);
      expect(playMock).toHaveBeenCalledTimes(1);
      expect(rightVideo.currentTime).toBe(4);

      leftVideo.currentTime = 6;
      fireEvent.timeUpdate(leftVideo);
      expect(rightVideo.currentTime).toBe(6);

      Object.defineProperty(leftVideo, 'paused', {
        configurable: true,
        value: false,
      });
      Object.defineProperty(rightVideo, 'paused', {
        configurable: true,
        value: false,
      });
      fireEvent.pause(leftVideo);
      expect(pauseMock).toHaveBeenCalledTimes(2);
    } finally {
      playMock.mockRestore();
      pauseMock.mockRestore();
    }
  });

  it('renders dual waveform compare for audio assets', () => {
    renderWithProviders(
      <CompareModal
        open
        onOpenChange={vi.fn()}
        projectId="design_compare"
        left={{
          id: 'left-audio',
          kind: 'audio',
          path: 'assets/generated/left.wav',
          createdAt: '2026-05-02T00:00:00.000Z',
        }}
        right={{
          id: 'right-audio',
          kind: 'audio',
          path: 'assets/generated/right.wav',
          createdAt: '2026-05-02T00:00:01.000Z',
        }}
      />,
    );

    expect(screen.getByText('Audio waveform compare')).toBeVisible();
    expect(screen.getAllByText('A').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('B').length).toBeGreaterThanOrEqual(2);
  });

  it('decodes audio data for waveform compare when Web Audio is available', async () => {
    const originalFetch = globalThis.fetch;
    const originalAudioContext = window.AudioContext;
    const decodeAudioData = vi.fn(
      async () =>
        ({
          length: 4,
          numberOfChannels: 1,
          getChannelData: () => new Float32Array([0, 0.25, 1, 0.5]),
        }) as unknown as AudioBuffer,
    );
    const closeMock = vi.fn(async () => {});
    class MockAudioContext {
      decodeAudioData = decodeAudioData;
      close = closeMock;
    }
    const fetchMock = vi.fn(
      async () => new Response(new Uint8Array([1, 2, 3, 4])),
    );
    globalThis.fetch = fetchMock as typeof fetch;
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      value: MockAudioContext,
    });

    try {
      renderWithProviders(
        <CompareModal
          open
          onOpenChange={vi.fn()}
          projectId="design_compare"
          left={{
            id: 'left-audio',
            kind: 'audio',
            path: 'assets/generated/left.wav',
            createdAt: '2026-05-02T00:00:00.000Z',
          }}
          right={{
            id: 'right-audio',
            kind: 'audio',
            path: 'assets/generated/right.wav',
            createdAt: '2026-05-02T00:00:01.000Z',
          }}
        />,
      );

      await waitFor(() =>
        expect(screen.getByLabelText('A waveform')).toHaveAttribute(
          'data-waveform-source',
          'decoded',
        ),
      );
      expect(screen.getByLabelText('B waveform')).toHaveAttribute(
        'data-waveform-source',
        'decoded',
      );
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(decodeAudioData).toHaveBeenCalledTimes(2);
      expect(closeMock).toHaveBeenCalledTimes(2);
    } finally {
      globalThis.fetch = originalFetch;
      Object.defineProperty(window, 'AudioContext', {
        configurable: true,
        value: originalAudioContext,
      });
    }
  });

  it('surfaces render dependencies in DesignMode settings', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/dependencies')) {
        return jsonResponse({
          dependencies: [
            {
              id: 'playwright',
              label: 'Playwright',
              kind: 'node-package',
              state: 'available',
              usedFor: ['pdf'],
              version: '1.56.0',
            },
            {
              id: 'hyperframes',
              label: 'HyperFrames',
              kind: 'renderer',
              state: 'missing',
              usedFor: ['mp4'],
              reason: 'Renderer is not installed',
              installHint: 'Install HyperFrames locally',
            },
          ],
        });
      }
      return jsonResponse({});
    }) as typeof fetch;

    try {
      renderWithProviders(
        <DesignModeSettings
          settings={{
            ...defaultSettings,
            designMode: {
              ...defaultSettings.designMode,
              budgets: { ...defaultSettings.designMode.budgets },
            },
          }}
          onSettingsChange={vi.fn()}
        />,
      );

      expect(await screen.findByText('Render dependencies')).toBeVisible();
      expect(await screen.findByText('Playwright')).toBeVisible();
      expect(screen.getByText('HyperFrames')).toBeVisible();
      expect(screen.getByText('Install HyperFrames locally')).toBeVisible();
      expect(screen.getByText('Version 1.56.0')).toBeVisible();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('renders recent critique runs in DesignMode telemetry settings', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/critique/metrics')) {
        return jsonResponse({
          metrics: [
            {
              runId: 'jury_recent123456',
              outcome: 'degraded',
              conformanceOk: false,
              panelistCount: 5,
              mustFixCount: 2,
              durationMs: 1450,
              startedAt: '2026-05-15T00:00:00.000Z',
            },
          ],
        });
      }
      if (url.endsWith('/dependencies')) {
        return jsonResponse({ dependencies: [] });
      }
      return jsonResponse({});
    }) as typeof fetch;

    try {
      renderWithProviders(
        <DesignModeSettings
          settings={{
            ...defaultSettings,
            designMode: {
              ...defaultSettings.designMode,
              budgets: { ...defaultSettings.designMode.budgets },
            },
          }}
          onSettingsChange={vi.fn()}
        />,
      );

      expect(await screen.findByText('Recent critique runs')).toBeVisible();
      expect(await screen.findByText('jury_recent1...')).toBeVisible();
      expect(screen.getByText('Degraded')).toBeVisible();
      expect(screen.getByText('Failed')).toBeVisible();
      expect(screen.getByText('1.4 s')).toBeVisible();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('manages DesignMode project locations in settings', async () => {
    const originalFetch = globalThis.fetch;
    const defaultLocation = {
      path: '/tmp/design-default',
      isDefault: true,
      configured: false,
      exists: true,
      projectCount: 1,
    };
    const configuredLocation = {
      path: '/tmp/design-alt',
      isDefault: false,
      configured: true,
      exists: true,
      projectCount: 0,
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init) => {
      const url = String(input);
      if (url.endsWith('/project-locations/scan')) {
        return jsonResponse({
          locations: [
            defaultLocation,
            { ...configuredLocation, projectCount: 2 },
          ],
          projects: [],
        });
      }
      if (url.endsWith('/project-locations') && init?.method === 'POST') {
        return jsonResponse(
          {
            location: {
              path: '/tmp/design-new',
              isDefault: false,
              configured: true,
              exists: true,
              projectCount: 0,
            },
            locations: [
              defaultLocation,
              {
                path: '/tmp/design-new',
                isDefault: false,
                configured: true,
                exists: true,
                projectCount: 0,
              },
            ],
          },
          201,
        );
      }
      if (url.endsWith('/project-locations') && init?.method === 'DELETE') {
        return jsonResponse({ locations: [defaultLocation] });
      }
      if (url.endsWith('/project-locations')) {
        return jsonResponse({
          locations: [defaultLocation, configuredLocation],
        });
      }
      if (url.endsWith('/dependencies')) {
        return jsonResponse({ dependencies: [] });
      }
      if (url.endsWith('/critique/metrics')) {
        return jsonResponse({ metrics: [] });
      }
      return jsonResponse({});
    });
    globalThis.fetch = fetchMock as typeof fetch;

    try {
      renderWithProviders(
        <DesignModeSettings
          settings={{
            ...defaultSettings,
            designMode: {
              ...defaultSettings.designMode,
              budgets: { ...defaultSettings.designMode.budgets },
            },
          }}
          onSettingsChange={vi.fn()}
        />,
      );

      expect(await screen.findByText('Project locations')).toBeVisible();
      expect(await screen.findByText('/tmp/design-default')).toBeVisible();
      expect(screen.getByText('/tmp/design-alt')).toBeVisible();

      fireEvent.change(screen.getByLabelText('Location path'), {
        target: { value: '/tmp/design-new' },
      });
      fireEvent.click(screen.getByRole('button', { name: /add location/i }));

      await waitFor(() =>
        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining('/project-locations'),
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ path: '/tmp/design-new' }),
          }),
        ),
      );
      expect(await screen.findByText('/tmp/design-new')).toBeVisible();

      fireEvent.click(screen.getByRole('button', { name: /^scan$/i }));
      expect(await screen.findByText('2 projects')).toBeVisible();

      fireEvent.click(
        screen.getByRole('button', {
          name: /remove project location \/tmp\/design-alt/i,
        }),
      );
      await waitFor(() =>
        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining('/project-locations'),
          expect.objectContaining({ method: 'DELETE' }),
        ),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('renders Critique Theater rollout settings', async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/critique/rollout')) {
        return jsonResponse({
          rollout: {
            phase: 'M0',
            rolloutPhase: 'M0',
            userOverride: 'auto',
            promotedAt: { M0: '2026-05-15T00:00:00.000Z' },
            canPromote: true,
            canRollback: false,
            next: 'M1',
          },
        });
      }
      if (url.endsWith('/critique/metrics')) {
        return jsonResponse({ metrics: [] });
      }
      if (url.endsWith('/dependencies')) {
        return jsonResponse({ dependencies: [] });
      }
      return jsonResponse({});
    });
    globalThis.fetch = fetchMock as typeof fetch;

    try {
      renderWithProviders(
        <DesignModeSettings
          settings={{
            ...defaultSettings,
            designMode: {
              ...defaultSettings.designMode,
              budgets: { ...defaultSettings.designMode.budgets },
            },
          }}
          onSettingsChange={vi.fn()}
        />,
      );

      expect(await screen.findByText('Critique Theater')).toBeVisible();
      expect(screen.getByText('Current phase: M0')).toBeVisible();
      fireEvent.click(screen.getByLabelText('Force off'));
      await waitFor(() =>
        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining('/critique/rollout/override'),
          expect.objectContaining({ method: 'POST' }),
        ),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('updates user-level DesignMode custom instructions in settings', () => {
    const onSettingsChange = vi.fn();

    renderWithProviders(
      <DesignModeSettings
        settings={{
          ...defaultSettings,
          designMode: {
            ...defaultSettings.designMode,
            budgets: { ...defaultSettings.designMode.budgets },
          },
        }}
        onSettingsChange={onSettingsChange}
      />,
    );

    fireEvent.change(screen.getByLabelText(/DesignMode custom instructions/i), {
      target: { value: 'Prefer precise dense UI.' },
    });

    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        designMode: expect.objectContaining({
          customInstructions: 'Prefer precise dense UI.',
        }),
      }),
    );
  });

  it('toggles DesignMode token sidecar injection in settings', () => {
    const onSettingsChange = vi.fn();

    renderWithProviders(
      <DesignModeSettings
        settings={{
          ...defaultSettings,
          designMode: {
            ...defaultSettings.designMode,
            budgets: { ...defaultSettings.designMode.budgets },
          },
        }}
        onSettingsChange={onSettingsChange}
      />,
    );

    fireEvent.click(
      screen.getByRole('switch', {
        name: /Inject design-system token sidecars/i,
      }),
    );

    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        designMode: expect.objectContaining({
          tokenChannelEnabled: false,
        }),
      }),
    );
  });

  it('persists DesignMode media model aliases from valid JSON', () => {
    const onSettingsChange = vi.fn();

    renderWithProviders(
      <DesignModeSettings
        settings={{
          ...defaultSettings,
          designMode: {
            ...defaultSettings.designMode,
            budgets: { ...defaultSettings.designMode.budgets },
          },
        }}
        onSettingsChange={onSettingsChange}
      />,
    );

    fireEvent.change(screen.getByLabelText('Model alias map'), {
      target: { value: '{ "seedream-5.0": "doubao-seedream-5-0" }' },
    });
    fireEvent.blur(screen.getByLabelText('Model alias map'));

    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        designMode: expect.objectContaining({
          media: {
            aliases: { 'seedream-5.0': 'doubao-seedream-5-0' },
          },
        }),
      }),
    );
  });

  it('renders asset provenance metadata and prompt action', () => {
    const onOpenPrompt = vi.fn();
    renderWithProviders(
      <AssetProvenanceDialog
        open
        onOpenChange={vi.fn()}
        onOpenPrompt={onOpenPrompt}
        provenance={{
          assetId: 'asset_prov',
          provider: 'openai',
          model: 'gpt-image-1.5',
          path: 'assets/generated/prov.png',
          promptHash: 'sha256:test',
          promptSnapshot: 'prompts/resolved-user.md@abc123',
          taskId: 'task_prov',
          disclosureText: 'AI-generated image · OpenAI · 2026-05-02',
        }}
      />,
    );

    expect(screen.getByText('Provenance')).toBeVisible();
    expect(screen.getByText('openai')).toBeVisible();
    expect(screen.getByText('sha256:test')).toBeVisible();
    screen.getByRole('button', { name: /open prompt snapshot/i }).click();
    expect(onOpenPrompt).toHaveBeenCalledWith('prompts/resolved-user.md');
  });
});

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function installStorageMock() {
  const storage = createStorageMock();
  const globalDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    'localStorage',
  );
  const windowDescriptor = Object.getOwnPropertyDescriptor(
    window,
    'localStorage',
  );
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  });
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: storage,
  });
  return {
    storage,
    restore: () => {
      restoreStorageDescriptor(globalThis, globalDescriptor);
      restoreStorageDescriptor(window, windowDescriptor);
    },
  };
}

function restoreStorageDescriptor(
  target: typeof globalThis,
  descriptor: PropertyDescriptor | undefined,
) {
  if (descriptor) {
    Object.defineProperty(target, 'localStorage', descriptor);
    return;
  }
  delete (target as { localStorage?: Storage }).localStorage;
}

function createStorageMock(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: vi.fn(() => values.clear()),
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    key: vi.fn((index: number) => Array.from(values.keys())[index] ?? null),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  };
}

function LocationProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <div>
      <span data-testid="route-probe">
        {location.pathname}
        {location.search}
        {location.hash}
      </span>
      <button type="button" onClick={() => navigate(-1)}>
        browser back
      </button>
    </div>
  );
}

function designProjectFixture(
  overrides: Partial<DesignProject> = {},
): DesignProject {
  return {
    id: 'design_test',
    title: 'Design test',
    surface: 'prototype',
    status: 'draft',
    skillId: null,
    designSystemId: null,
    inspirationDesignSystemIds: [],
    craftRefs: [],
    brief: {},
    outputs: [],
    createdAt: '2026-05-02T00:00:00.000Z',
    updatedAt: '2026-05-02T00:00:00.000Z',
    ...overrides,
  };
}

function designDebugSnapshotFixture(
  project = designProjectFixture(),
): DesignDebugSnapshot {
  return {
    project,
    metrics: {
      projectId: project.id,
      surface: project.surface,
      status: project.status,
      assetCount: 0,
      exportCount: 0,
      assetToExportRatio: 0,
      targetedEditCount: 0,
      commentCount: 0,
      lintFindingCount: 0,
      lintP0Count: 0,
      lintP1Count: 0,
      lintFindingCountsByRule: {},
      exportFormatUsage: {},
      generationByProviderModel: {},
      timeToFirstPreviewMs: null,
      timeToFirstExportMs: null,
      meanRetryCountPerSuccess: 0,
    },
    prompts: { system: '', user: '', template: null },
    provenance: {
      assets: [],
      tasks: [],
      invalidLines: { assets: 0, tasks: 0, history: 0 },
    },
    runtimeTasks: [],
    renderLog: [],
    history: [],
    exports: [],
  };
}

function designTaskFixture(
  overrides: Partial<DesignTaskRecord> = {},
): DesignTaskRecord {
  return {
    taskId: 'dmtask_test',
    projectId: 'design_test',
    surface: 'image',
    model: 'gpt-image-2',
    state: 'running',
    startedAt: '2026-05-02T00:00:00.000Z',
    progressLines: ['Task accepted by DesignMode dispatcher.'],
    providerError: null,
    usedStubFallback: false,
    ...overrides,
  };
}

function designJuryRunFixture(overrides: Partial<DesignJuryRun> = {}) {
  return {
    id: 'jury_test',
    projectId: 'design_test',
    artifactPath: 'artifacts/index.html',
    status: 'complete',
    protocolVersion: 'design-jury.v1',
    createdAt: '2026-05-02T00:00:00.000Z',
    completedAt: '2026-05-02T00:00:00.000Z',
    overallScore: 8,
    roles: [
      {
        role: 'designer',
        score: 8,
        evidence: 'Designer found a coherent baseline.',
        mustFix: [],
        quickWins: ['Align repeated cards to a single grid rhythm.'],
      },
    ],
    mustFix: ['Add visible focus states.'],
    quickWins: ['Replace generic button copy.'],
    transcriptPath: 'critique/jury_test/transcript.json',
    summaryPath: 'critique/jury_test/summary.md',
    ...overrides,
  } satisfies DesignJuryRun;
}

function designBudgetFixture() {
  const usage = {
    imageGenerations: 0,
    videoJobs: 0,
    videoSeconds: 0,
    audioSeconds: 0,
    storageBytes: 0,
  };
  return {
    allowed: true,
    severity: 'none',
    message: '',
    config: {
      maxImageGenerations: 25,
      maxVideoJobs: 5,
      maxVideoSeconds: 60,
      maxAudioSeconds: 300,
      maxRetryCount: 1,
      maxStorageBytes: 1_073_741_824,
      strictProviderMode: false,
    },
    used: usage,
    requested: {},
    remaining: {
      imageGenerations: 25,
      videoJobs: 5,
      videoSeconds: 60,
      audioSeconds: 300,
      storageBytes: 1_073_741_824,
    },
  };
}

function contrast(a: string, b: string) {
  const light = Math.max(relativeLuminance(a), relativeLuminance(b));
  const dark = Math.min(relativeLuminance(a), relativeLuminance(b));
  return (light + 0.05) / (dark + 0.05);
}

function relativeLuminance(hex: string) {
  const [r, g, b] = hexToRgb(hex).map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function hexToRgb(hex: string) {
  const value = Number.parseInt(hex.slice(1, 7), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function withRelativePath(file: File, relativePath: string) {
  Object.defineProperty(file, 'webkitRelativePath', {
    configurable: true,
    value: relativePath,
  });
  return file;
}
