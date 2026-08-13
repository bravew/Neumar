import type { Page } from '@playwright/test';

import { test, expect } from '../fixtures/base';
import { apiDelete, apiPost } from '../helpers/api-client';

import fs from 'node:fs/promises';
import path from 'node:path';

const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

test.describe('Critique Theater', () => {
  const createdProjectIds: string[] = [];

  test.afterEach(async () => {
    while (createdProjectIds.length > 0) {
      const id = createdProjectIds.pop();
      if (id) await apiDelete(`/design/projects/${id}`).catch(() => {});
    }
  });

  for (const viewport of VIEWPORTS) {
    test(`plays the happy stage fixture on ${viewport.name}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await seedSettings(page);
      await mockJuryApi(page, 'happy');

      const projectId = await createProject();
      createdProjectIds.push(projectId);

      await page.goto(`/design/${projectId}`);
      await page.getByRole('button', { name: /^design jury$/i }).click();

      const theater = page.getByTestId('critique-theater-mount');
      await expect(theater).toBeVisible();
      await expect(theater.getByText('Designer')).toBeVisible();
      await expect(
        theater.getByText('Clarify primary action copy.'),
      ).toBeVisible();
      await expect(theater.getByText('Shipped')).toBeVisible();
      await expect(
        theater.getByRole('region', { name: /design jury theater/i }),
      ).toBeVisible();
    });
  }

  test('shows the interrupted terminal state', async ({ page }) => {
    await seedSettings(page);
    await mockJuryApi(page, 'interrupt');

    const projectId = await createProject();
    createdProjectIds.push(projectId);

    await page.goto(`/design/${projectId}`);
    await page.getByRole('button', { name: /^design jury$/i }).click();

    await expect(page.getByTestId('critique-theater-mount')).toBeVisible();
    await expect(page.getByText('Interrupted')).toBeVisible();
  });
});

async function seedSettings(page: Page) {
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
    };
    window.localStorage.setItem('neumar_settings', JSON.stringify(settings));
  });
}

async function createProject() {
  const title = `Critique Theater E2E ${Date.now()}`;
  const response = await apiPost<{ project: { id: string } }>(
    '/design/projects',
    {
      title,
      surface: 'document',
      intent: 'other',
      brief: { prompt: 'Critique theater browser fixture.' },
    },
  );
  return response.project.id;
}

async function mockJuryApi(page: Page, fixture: 'happy' | 'interrupt') {
  const runId = fixture === 'happy' ? 'jury_e2e_happy' : 'jury_e2e_interrupt';
  const fixturePath = path.join(
    process.cwd(),
    'tests/e2e/fixtures/design-mode/critique/sse-events',
    `${fixture}.ndjson`,
  );
  const events = await fs.readFile(fixturePath, 'utf8');

  await page.route('**/design/design-jury/status', async (route) => {
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
  });
  await page.route('**/design/projects/*/design-jury', async (route) => {
    const projectId =
      new URL(route.request().url()).pathname.match(
        /\/design\/projects\/([^/]+)\/design-jury$/,
      )?.[1] ?? 'project-from-route';
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        run: {
          id: runId,
          projectId,
          artifactPath: 'artifacts/document.md',
          status: 'running',
          protocolVersion: 'design-jury.v1',
          createdAt: '2026-05-15T00:00:00.000Z',
          completedAt: '2026-05-15T00:00:01.000Z',
          overallScore: 8,
          roles: [
            {
              role: 'designer',
              score: 8,
              evidence: 'Fixture evidence.',
              mustFix: [],
              quickWins: [],
            },
          ],
          mustFix: ['Clarify primary action copy.'],
          quickWins: [],
          transcriptPath: 'critique/transcript.ndjson',
          summaryPath: 'critique/summary.md',
        },
      }),
    });
  });
  await page.route(
    '**/design/projects/*/design-jury/*/events',
    async (route) => {
      const body = events
        .trim()
        .split('\n')
        .map((line) => `data: ${line}\n\n`)
        .join('');
      await route.fulfill({
        status: 200,
        headers: {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
        },
        body: `${body}event: done\ndata: {}\n\n`,
      });
    },
  );
}
