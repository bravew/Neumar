import type { Locator, Page } from '@playwright/test';

import { test, expect } from '../fixtures/base';
import { apiDelete, apiGet, apiPost } from '../helpers/api-client';

const surfaces = [
  'document',
  'image',
  'video',
  'audio',
  'deck',
  'prototype',
  'template',
  'campaign',
] as const;

test.describe('DesignMode smoke', () => {
  test.setTimeout(120_000);

  const createdProjectIds: string[] = [];

  test.afterEach(async () => {
    while (createdProjectIds.length > 0) {
      const id = createdProjectIds.pop();
      if (id) await apiDelete(`/design/projects/${id}`).catch(() => {});
    }
  });

  test.beforeEach(async ({ page }) => {
    await apiPost('/db/settings/designMode', {
      value: JSON.stringify({
        enabled: true,
        defaultDesignSystemId: '',
        defaultSkillId: '',
        aiDisclosureDefault: true,
        strictProviderMode: false,
        budgets: {
          maxImageGenerations: 25,
          maxVideoJobs: 5,
          maxVideoSeconds: 60,
          maxAudioSeconds: 300,
          maxRetryCount: 3,
          maxStorageBytes: 1024 * 1024 * 1024,
        },
      }),
    });
    await page.addInitScript(() => {
      const settings = JSON.parse(
        window.localStorage.getItem('neumar_settings') || '{}',
      ) as Record<string, unknown>;
      settings.language = 'en-US';
      settings.designMode = {
        enabled: true,
        defaultDesignSystemId: '',
        defaultSkillId: '',
        aiDisclosureDefault: true,
        strictProviderMode: false,
        budgets: {
          maxImageGenerations: 25,
          maxVideoJobs: 5,
          maxVideoSeconds: 60,
          maxAudioSeconds: 300,
          maxRetryCount: 3,
          maxStorageBytes: 1024 * 1024 * 1024,
        },
      };
      window.localStorage.setItem('neumar_settings', JSON.stringify(settings));
    });
  });

  test('creates every supported surface and reopens durable projects', async ({
    page,
  }) => {
    await expect(
      await apiGet<{ success: boolean }>('/health/dependencies'),
    ).toMatchObject({ success: true });
    await openDesignEntry(page);

    for (const surface of surfaces) {
      const title = `E2E ${surface} ${Date.now()}`;
      await openDesignEntry(page);
      await page.getByTestId(`design-surface-${surface}`).click();
      await page.getByTestId('design-project-name-input').fill(title);
      await page
        .getByTestId('design-project-brief-input')
        .fill(`Browser smoke brief for ${surface}.`);
      await page.getByTestId('design-create-project-button').click();

      await expect(page.getByTestId('design-project-view')).toBeVisible();
      await expect(page).toHaveURL(/\/design\/[^/]+$/);
      await expect(
        page.getByRole('button', { name: /regular mode/i }),
      ).toBeVisible();
      await expect(page.getByText(/project \/ project\.json/)).toBeVisible();
      await expect(page.getByRole('tab', { name: /source/i })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await expect(page.getByRole('tab', { name: /comment/i })).toHaveCount(0);
      const projectId = page.url().split('/').pop();
      expect(projectId).toBeTruthy();
      createdProjectIds.push(projectId!);

      const { project } = await apiGet<{
        project: { id: string; title: string; surface: string };
      }>(`/design/projects/${projectId}`);
      expect(project).toMatchObject({
        id: projectId,
        title,
        surface: surface === 'campaign' ? 'campaign' : surface,
      });

      const { files } = await apiGet<{
        files: Array<{ path: string; isDir: boolean }>;
      }>(`/design/projects/${projectId}/files`);
      expect(files.some((file) => file.path === 'project.json')).toBe(true);

      await page.goto(`/design/${projectId}`);
      await expect(page.getByTestId('design-project-view')).toBeVisible();
    }
  });

  test('exercises workspace controls without off-screen panels', async ({
    page,
  }) => {
    await openDesignEntry(page);
    await expect(page.getByText('Default').first()).toBeVisible();
    await page.getByTestId('design-surface-document').click();
    await page
      .getByTestId('design-project-name-input')
      .fill(`E2E workspace ${Date.now()}`);
    await page
      .getByTestId('design-project-brief-input')
      .fill('Workspace controls smoke brief.');
    await page.getByTestId('design-create-project-button').click();
    await expect(page.getByTestId('design-project-view')).toBeVisible();
    const projectId = page.url().split('/').pop();
    expect(projectId).toBeTruthy();
    createdProjectIds.push(projectId!);

    await page.getByRole('button', { name: /resolved prompt/i }).click();
    const promptDrawer = page.getByTestId('resolved-prompt-drawer');
    await expect(promptDrawer).toBeVisible();
    await expectInViewport(page, promptDrawer);
    await promptDrawer.getByRole('button', { name: /close/i }).click();
    await expect(promptDrawer).toBeHidden();

    await page.getByRole('button', { name: /project debug/i }).click();
    const debugDrawer = page.getByTestId('design-debug-drawer');
    await expect(debugDrawer).toBeVisible();
    await expectInViewport(page, debugDrawer);
    await debugDrawer.getByRole('button', { name: /prompts/i }).click();
    await expect(debugDrawer.getByText(/system/i).first()).toBeVisible();
    await debugDrawer.getByRole('button', { name: /close/i }).click();
    await expect(debugDrawer).toBeHidden();

    const composer = page.getByPlaceholder('Describe the design you want...');
    await composer.fill('Create a short document from this brief.');
    await composer.press(
      process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter',
    );
    await expect(
      page.getByText(/Output written to artifacts\/document\.md/),
    ).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByText(/project \/ artifacts\/document\.md/),
    ).toBeVisible();
    await expect(page.getByRole('tab', { name: /source/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await page.getByRole('button', { name: /^versions$/i }).click();
    await expect(page.getByText(/v1 · artifacts\/document\.md/)).toBeVisible();
    await page
      .getByRole('article')
      .getByRole('button', { name: /provenance/i })
      .click();
    await expect(
      page.getByRole('dialog', { name: /provenance/i }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(
      page.getByRole('dialog', { name: /provenance/i }),
    ).toBeHidden();

    await page.getByRole('button', { name: /export project/i }).click();
    await expect(
      page.getByRole('dialog', { name: /export project/i }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(
      page.getByRole('dialog', { name: /export project/i }),
    ).toBeHidden();

    await page.getByRole('button', { name: /back to designs/i }).click();
    await expect(page.getByTestId('new-project-panel')).toBeVisible();
    await page.getByRole('button', { name: /regular mode/i }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test('entry gallery cards open previews and can create projects', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const settings = JSON.parse(
        window.localStorage.getItem('neumar_settings') || '{}',
      ) as Record<string, unknown>;
      settings.theme = 'dark';
      window.localStorage.setItem('neumar_settings', JSON.stringify(settings));
    });
    await openDesignEntry(page);
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect(page.getByTestId('designs-search')).toBeVisible();
    await expect(page.getByTestId('designs-surface-filter')).toBeVisible();

    await page.getByRole('button', { name: /^design systems$/i }).click();
    await expect(page.getByTestId('design-systems-search')).toBeVisible();
    await expect(
      page.getByTestId('design-systems-category-filter'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid^="design-system-preview-"]').first(),
    ).toBeVisible();
    await page
      .getByTestId('design-systems-search')
      .fill('no design system should match this');
    await expect(page.getByText('No matches found.')).toBeVisible();
    await page.getByTestId('design-systems-search').clear();

    await page.getByTestId('design-systems-search').fill('anthropic');
    await page.getByTestId('design-system-card-anthropic').click();
    let designSystemDialog = page.getByRole('dialog');
    await expect(
      designSystemDialog.locator(
        '[data-testid="design-system-showcase-anthropic"]',
      ),
    ).toBeVisible();
    await expectReadableContrast(
      designSystemDialog.locator(
        '[data-testid="design-system-showcase-anthropic"] h2',
      ),
      designSystemDialog.locator(
        '[data-testid="design-system-showcase-anthropic"]',
      ),
      4.5,
    );
    await expectReadableContrast(
      designSystemDialog
        .locator('[data-testid="design-system-showcase-anthropic"] p')
        .first(),
      designSystemDialog.locator(
        '[data-testid="design-system-showcase-anthropic"]',
      ),
      4.5,
    );
    await page.keyboard.press('Escape');
    await expect(designSystemDialog).toBeHidden();

    await page.getByTestId('design-systems-search').clear();
    await page.getByTestId('design-systems-search').fill('airbnb');
    await page.getByTestId('design-system-card-airbnb').click();
    designSystemDialog = page.getByRole('dialog');
    await expect(
      designSystemDialog.getByRole('heading', { name: 'DESIGN.md' }),
    ).toBeVisible();
    await expect(
      designSystemDialog.locator('[data-testid^="design-system-showcase-"]'),
    ).toBeVisible();
    await expect(
      designSystemDialog.locator('[data-testid^="design-system-spec-"]'),
    ).toBeVisible();
    const specPane = designSystemDialog.locator(
      '[data-testid="design-system-spec-airbnb"]',
    );
    await expectReadableContrast(
      specPane.locator('[data-spec-line="heading"]').first(),
      specPane,
      4.5,
    );
    await expectReadableContrast(
      specPane.locator('[data-spec-line="list"]').first(),
      specPane,
      4.5,
    );
    await expectReadableContrast(
      specPane.locator('[data-spec-line="body"]').first(),
      specPane,
      4.5,
    );
    await designSystemDialog.getByRole('tab', { name: /^tokens$/i }).click();
    await expect(
      designSystemDialog.locator('[data-testid^="design-system-tokens-"]'),
    ).toBeVisible();
    await designSystemDialog.getByTestId('design-system-share').click();
    await expect(
      designSystemDialog.getByRole('menuitem', { name: /copy design\.md/i }),
    ).toBeVisible();
    await expect(
      designSystemDialog.getByRole('menuitem', { name: /copy tokens/i }),
    ).toBeVisible();
    await designSystemDialog.getByTestId('design-system-share').click();
    await designSystemDialog.getByTestId('design-system-fullscreen').click();
    await expect(
      designSystemDialog.getByRole('button', { name: /exit fullscreen/i }),
    ).toBeVisible();
    await designSystemDialog
      .getByRole('button', { name: /use as default/i })
      .click();
    await expect(
      designSystemDialog.getByRole('button', { name: /default system/i }),
    ).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(designSystemDialog).toBeHidden();

    await page.getByRole('button', { name: /^skills$/i }).click();
    await expect(page.getByTestId('skills-search')).toBeVisible();
    await expect(page.getByTestId('skills-surface-filter')).toBeVisible();
    await expect(page.getByTestId('skills-category-filter')).toBeVisible();
    await page.getByTestId('skills-search').fill('no skill should match this');
    await expect(page.getByText('No matches found.')).toBeVisible();
    await page.getByTestId('skills-search').clear();
    await page.getByTestId('skill-card-bundled:image-poster').click();
    const skillDialog = page.getByRole('dialog');
    await expect(skillDialog.getByText(/skill source/i)).toBeVisible();
    await skillDialog
      .getByRole('button', { name: /create from skill/i })
      .click();
    await expect(page.getByTestId('design-project-view')).toBeVisible();
    let projectId = page.url().split('/').pop();
    expect(projectId).toBeTruthy();
    createdProjectIds.push(projectId!);

    await openDesignEntry(page);
    await page.getByRole('button', { name: /^examples$/i }).click();
    await expect(page.getByTestId('examples-search')).toBeVisible();
    await expect(page.getByTestId('examples-surface-filter')).toBeVisible();
    await expect(page.getByTestId('examples-scenario-filter')).toBeVisible();
    await page
      .getByTestId('examples-search')
      .fill('no example should match this');
    await expect(page.getByText('No matches found.')).toBeVisible();
    await page.getByTestId('examples-search').clear();
    await page.getByTestId('example-card-bundled:image-poster').click();
    const exampleDialog = page.getByRole('dialog');
    await expect(exampleDialog.getByText(/editorial poster/i)).toBeVisible();
    await exampleDialog.getByRole('button', { name: /use prompt/i }).click();
    await expect(page.getByTestId('design-project-view')).toBeVisible();
    projectId = page.url().split('/').pop();
    expect(projectId).toBeTruthy();
    createdProjectIds.push(projectId!);

    await openDesignEntry(page);
    await page.getByRole('button', { name: /^image templates$/i }).click();
    await expect(
      page.getByTestId('prompt-templates-image-search'),
    ).toBeVisible();
    await expect(
      page.getByTestId('prompt-templates-image-category-filter'),
    ).toBeVisible();
    await expect(
      page.getByTestId('prompt-templates-image-aspect-filter'),
    ).toBeVisible();
    await page
      .getByTestId('prompt-templates-image-search')
      .fill('no image template should match this');
    await expect(page.getByText('No matches found.')).toBeVisible();
    await page.getByTestId('prompt-templates-image-search').clear();
    await page
      .locator('[data-testid^="prompt-template-card-image-"]')
      .first()
      .click();
    const templateDialog = page.getByRole('dialog');
    await expect(templateDialog.getByText(/^Prompt$/)).toBeVisible();
    const createFromTemplate = templateDialog.getByRole('button', {
      name: /create from template/i,
    });
    await expect(createFromTemplate).toBeEnabled({ timeout: 20_000 });
    await createFromTemplate.click();
    await expect(page.getByTestId('design-project-view')).toBeVisible();
    projectId = page.url().split('/').pop();
    expect(projectId).toBeTruthy();
    createdProjectIds.push(projectId!);

    await openDesignEntry(page);
    await page.getByRole('button', { name: /^video templates$/i }).click();
    await expect(
      page.getByTestId('prompt-templates-video-search'),
    ).toBeVisible();
    await expect(
      page.getByTestId('prompt-templates-video-category-filter'),
    ).toBeVisible();
    await expect(
      page.getByTestId('prompt-templates-video-aspect-filter'),
    ).toBeVisible();
    await page
      .getByTestId('prompt-templates-video-search')
      .fill('no video template should match this');
    await expect(page.getByText('No matches found.')).toBeVisible();
    await page.getByTestId('prompt-templates-video-search').clear();
    await page
      .locator('[data-testid^="prompt-template-card-video-"]')
      .first()
      .click();
    const videoTemplateDialog = page.getByRole('dialog');
    await expect(videoTemplateDialog.getByText(/^Prompt$/)).toBeVisible();
    const createFromVideoTemplate = videoTemplateDialog.getByRole('button', {
      name: /create from template/i,
    });
    await expect(createFromVideoTemplate).toBeEnabled({ timeout: 20_000 });
    await createFromVideoTemplate.click();
    await expect(page.getByTestId('design-project-view')).toBeVisible();
    projectId = page.url().split('/').pop();
    expect(projectId).toBeTruthy();
    createdProjectIds.push(projectId!);
  });
});

async function openDesignEntry(page: Page) {
  await page.goto('/design');
  const panel = page.getByTestId('new-project-panel');
  const skipSetup = page.getByRole('button', { name: /skip for now/i });
  const firstVisible = await Promise.race([
    panel
      .waitFor({ state: 'visible', timeout: 20_000 })
      .then(() => 'panel' as const)
      .catch(() => null),
    skipSetup
      .waitFor({ state: 'visible', timeout: 20_000 })
      .then(() => 'skip' as const)
      .catch(() => null),
  ]);
  if (firstVisible === 'skip') {
    await skipSetup.click();
  }
  await expect(panel).toBeVisible({ timeout: 20_000 });
}

async function expectInViewport(page: Page, locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).toBeTruthy();
  const viewport = page.viewportSize();
  expect(viewport).toBeTruthy();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 1);
}

async function expectReadableContrast(
  foreground: Locator,
  background: Locator,
  minimum: number,
) {
  const backgroundHandle = await background.elementHandle();
  if (!backgroundHandle) throw new Error('Background element not found');
  const ratio = await foreground.evaluate((element, backgroundElement) => {
    const color = getComputedStyle(element).color;
    const backgroundColor = getComputedStyle(
      backgroundElement as Element,
    ).backgroundColor;
    return contrast(color, backgroundColor);

    function contrast(a: string, b: string) {
      const light = Math.max(relativeLuminance(a), relativeLuminance(b));
      const dark = Math.min(relativeLuminance(a), relativeLuminance(b));
      return (light + 0.05) / (dark + 0.05);
    }

    function relativeLuminance(colorValue: string) {
      const [r, g, b] = parseCssColor(colorValue).map((channel) => {
        const value = channel / 255;
        return value <= 0.03928
          ? value / 12.92
          : ((value + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }

    function parseCssColor(colorValue: string): [number, number, number] {
      if (colorValue.startsWith('oklch(')) {
        return parseOklch(colorValue);
      }
      const channels = colorValue
        .match(/\d+(\.\d+)?/g)
        ?.slice(0, 3)
        .map(Number);
      return [channels?.[0] ?? 0, channels?.[1] ?? 0, channels?.[2] ?? 0];
    }

    function parseOklch(colorValue: string): [number, number, number] {
      const [lightness = '0', chroma = '0', hue = '0'] =
        colorValue.match(/oklch\(([^)]+)\)/)?.[1]?.split(/\s+/) ?? [];
      const l = parseCssNumber(lightness);
      const c = parseCssNumber(chroma);
      const h = (parseFloat(hue) * Math.PI) / 180;
      const a = c * Math.cos(h);
      const b = c * Math.sin(h);

      // Convert OKLCH -> OKLab -> linear sRGB -> display sRGB.
      const lPrime = l + 0.3963377774 * a + 0.2158037573 * b;
      const mPrime = l - 0.1055613458 * a - 0.0638541728 * b;
      const sPrime = l - 0.0894841775 * a - 1.291485548 * b;

      const l3 = lPrime ** 3;
      const m3 = mPrime ** 3;
      const s3 = sPrime ** 3;

      return [
        encodeSrgb(4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3),
        encodeSrgb(-1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3),
        encodeSrgb(-0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3),
      ];
    }

    function parseCssNumber(value: string) {
      const parsed = parseFloat(value);
      return value.includes('%') ? parsed / 100 : parsed;
    }

    function encodeSrgb(value: number) {
      const clamped = Math.min(1, Math.max(0, value));
      const encoded =
        clamped <= 0.0031308
          ? 12.92 * clamped
          : 1.055 * clamped ** (1 / 2.4) - 0.055;
      return encoded * 255;
    }
  }, backgroundHandle);
  expect(ratio).toBeGreaterThanOrEqual(minimum);
}
