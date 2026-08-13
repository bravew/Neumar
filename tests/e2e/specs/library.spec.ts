import { test, expect } from '../fixtures/base';

/**
 * Library page E2E tests — task history browsing.
 */
test.describe('Library Page', () => {
  test.beforeEach(async ({ page }) => {
    // Mock tasks list
    await page.route('**/db/tasks', (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            {
              id: 'task-1',
              title: 'Build a calculator',
              status: 'completed',
              prompt: 'Build a calculator app',
              created_at: '2026-04-05T10:00:00Z',
            },
            {
              id: 'task-2',
              title: 'Write tests',
              status: 'completed',
              prompt: 'Write unit tests',
              created_at: '2026-04-06T10:00:00Z',
            },
          ]),
        });
      }
      return route.continue();
    });
  });

  test('page loads and shows task list', async ({ page }) => {
    await page.goto('/library');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('Something went wrong')).not.toBeVisible();
  });

  test('displays task items', async ({ page }) => {
    await page.goto('/library');
    await page.waitForLoadState('networkidle');

    // Should show task titles
    await expect(page.getByText('Build a calculator')).toBeVisible();
    await expect(page.getByText('Write tests')).toBeVisible();
  });

  test('clicking a task navigates to task detail', async ({ page }) => {
    await page.goto('/library');
    await page.waitForLoadState('networkidle');

    // Mock single task and messages for task detail page
    await page.route('**/db/tasks/task-1', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'task-1',
          title: 'Build a calculator',
          status: 'completed',
        }),
      }),
    );

    await page.route('**/db/tasks/task-1/messages', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '[]',
      }),
    );

    // Click the first task
    await page.getByText('Build a calculator').click();

    // Should navigate to task detail
    await page.waitForURL(/\/task/, { timeout: 5_000 });
  });

  test('cloud storage tab renders media-grid results with attribution', async ({
    page,
  }) => {
    await page.route('**/health/dependencies', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, claudeCode: true }),
      }),
    );
    await page.route('**/cloud-storage/connections', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [
            {
              id: 'conn-openverse',
              provider: 'openverse',
              displayName: 'OpenVerse',
              status: 'active',
              capabilities: { preferredView: 'media-grid', readOnly: true },
            },
          ],
        }),
      }),
    );
    await page.route(
      '**/cloud-storage/connections/conn-openverse/items**',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ items: [] }),
        }),
    );
    await page.route(
      '**/cloud-storage/connections/conn-openverse/search**',
      (route) => {
        const url = new URL(route.request().url());
        expect(url.searchParams.get('media_kind')).toBe('video');
        expect(url.searchParams.get('limit')).toBe('50');
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            items: [
              {
                id: 'clip-1',
                name: 'clip.mp4',
                mimeType: 'video/mp4',
                isFolder: false,
                thumbnailUrl: 'https://example.test/clip.jpg',
                licenseInfo: {
                  provider: 'OpenVerse',
                  license: 'CC0',
                  creatorName: 'Avery',
                },
              },
            ],
          }),
        });
      },
    );

    await page.goto('/library?tab=cloud-storage');
    await page.getByRole('button', { name: 'Videos' }).click();

    await expect(page.getByText('clip.mp4')).toBeVisible();
    await expect(page.getByText('By Avery on OpenVerse')).toBeVisible();
  });
});
