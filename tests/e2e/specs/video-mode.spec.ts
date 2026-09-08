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

  test('idle video tabs leave picker requests unblocked', async ({
    context,
    page,
  }) => {
    const assetEventRequests: string[] = [];
    let fileDialogRequests = 0;
    let folderDialogRequests = 0;
    context.on('request', (request) => {
      if (new URL(request.url()).pathname === '/assets/events') {
        assetEventRequests.push(request.url());
      }
    });
    await context.route('**/assets/native-file-dialog', async (route) => {
      fileDialogRequests += 1;
      await route.fulfill({ status: 200, json: { paths: [] } });
    });
    await context.route('**/assets/native-folder-dialog', async (route) => {
      folderDialogRequests += 1;
      await route.fulfill({ status: 200, json: { path: null } });
    });

    await page.goto('/video');
    await page.getByRole('button', { name: 'Configure' }).click();
    const name = `E2E picker ${crypto.randomUUID()}`;
    await page.getByTestId('video-project-name-input').fill(name);
    await page.getByRole('button', { name: 'Create project' }).click();
    await page.waitForURL(/\/video\/[^/?#]+$/, { timeout: 30_000 });
    const id = page.url().match(/\/video\/([^/?#]+)$/)?.[1];
    expect(id, 'editor URL should carry a project id').toBeTruthy();
    if (id) createdProjectIds.push(id);

    const second = await context.newPage();
    const third = await context.newPage();
    await Promise.all([second.goto(page.url()), third.goto(page.url())]);
    await Promise.all(
      [page, second, third].map((tab) =>
        expect(tab.getByRole('button', { name: 'Add assets' })).toBeVisible({
          timeout: 30_000,
        }),
      ),
    );
    await page.waitForTimeout(500);
    expect(assetEventRequests).toEqual([]);

    const addAssets = page.getByRole('button', { name: 'Add assets' });
    await addAssets.click();
    await page.getByRole('menuitem', { name: 'Add file(s)' }).click();
    await expect.poll(() => fileDialogRequests).toBe(1);
    await addAssets.click();
    await expect(
      page.getByRole('menuitem', { name: 'Add file(s)' }),
    ).toBeEnabled();
    await page.keyboard.press('Escape');

    await addAssets.click();
    await page.getByRole('menuitem', { name: 'Add folder' }).click();
    await expect.poll(() => folderDialogRequests).toBe(1);
    await addAssets.click();
    await expect(
      page.getByRole('menuitem', { name: 'Add folder' }),
    ).toBeEnabled();
  });
});
