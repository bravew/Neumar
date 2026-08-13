import { test, expect } from '../fixtures/base';
import { apiDelete } from '../helpers/api-client';

/**
 * Video Mode happy-path E2E — the html-video flow reachable from the UI.
 *
 * Full-stack against the running dev server (same pattern as design-mode.spec):
 * exercise the real entry → create → editor round trip and clean up created
 * projects through the API.
 *
 * This is the acceptance-gate #8 coverage (a happy-path Video Mode session);
 * the deeper render path is covered by the VIDEO_EVAL=1 integration test.
 */
test.describe('Video Mode happy path', () => {
  test.setTimeout(120_000);

  const createdProjectIds: string[] = [];

  test.afterEach(async () => {
    while (createdProjectIds.length > 0) {
      const id = createdProjectIds.pop();
      if (id) await apiDelete(`/video/projects/${id}`).catch(() => {});
    }
  });

  test('entry page renders and opens the new-project form', async ({
    page,
  }) => {
    await page.goto('/video');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByText('Something went wrong')).not.toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Video projects' }),
    ).toBeVisible();

    const configure = page.getByRole('button', { name: 'Configure' });
    await expect(configure).toBeVisible();
    await configure.click();

    await expect(page.getByTestId('video-project-name-input')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Create project' }),
    ).toBeVisible();
  });

  test('creates a project and lands in the editor', async ({ page }) => {
    await page.goto('/video');
    await page.waitForLoadState('domcontentloaded');

    const configure = page.getByRole('button', { name: 'Configure' });
    await expect(configure).toBeVisible();
    await configure.click();

    const name = `E2E video ${crypto.randomUUID()}`;
    await page.getByTestId('video-project-name-input').fill(name);
    await page.getByRole('button', { name: 'Create project' }).click();

    // createVideoProject → onCreated → navigate(`/video/<id>`).
    await page.waitForURL(/\/video\/[^/?#]+$/, { timeout: 30_000 });
    const id = page.url().match(/\/video\/([^/?#]+)$/)?.[1];
    expect(id, 'editor URL should carry a project id').toBeTruthy();
    if (id) createdProjectIds.push(id);

    // The editor header shows the project name once the project loads.
    await expect(page.getByRole('heading', { name })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText('Something went wrong')).not.toBeVisible();
  });
});
