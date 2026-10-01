import { test, expect } from '../fixtures/base';

test.describe('Shell v2', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const settings = JSON.parse(
        window.localStorage.getItem('neumar_settings') || '{}',
      ) as Record<string, unknown>;
      settings.ui = { simpleShell: true };
      settings.language = 'en-US';
      window.localStorage.setItem('neumar_settings', JSON.stringify(settings));
    });
  });

  test('shows the rail and keeps library scroll', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const rail = page.getByTestId('app-rail');
    await expect(rail).toBeVisible();
    await rail.getByRole('button', { name: 'Library' }).click();
    const scroller = page.getByTestId('library-scroll');
    await scroller.evaluate((element) => {
      const spacer = document.createElement('div');
      spacer.style.height = '1200px';
      element.appendChild(spacer);
      element.scrollTop = 180;
    });
    await rail.getByRole('button', { name: 'Tasks' }).click();
    await rail.getByRole('button', { name: 'Library' }).click();
    await expect
      .poll(() => scroller.evaluate((element) => element.scrollTop))
      .toBe(180);
  });
});
