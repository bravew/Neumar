import { test, expect } from '../fixtures/base';

test.describe('Chat dock', () => {
  test('stays open while navigating', async ({ page }) => {
    await page.addInitScript(() => {
      const settings = JSON.parse(
        window.localStorage.getItem('neumar_settings') || '{}',
      ) as Record<string, unknown>;
      settings.ui = { simpleShell: true };
      settings.language = 'en-US';
      window.localStorage.setItem('neumar_settings', JSON.stringify(settings));
    });

    await page.goto('/library');
    await page.waitForLoadState('networkidle');
    await page.keyboard.press('Meta+j');
    await expect(page.getByTestId('chat-dock')).toBeVisible();
    await expect(page.getByText('Library')).toBeVisible();
    await page
      .getByTestId('app-rail')
      .getByRole('button', { name: 'Tasks' })
      .click();
    await expect(page.getByTestId('chat-dock')).toBeVisible();
  });

  test('a library side-chat chip can be removed', async ({ page }) => {
    await page.addInitScript(() => {
      const settings = JSON.parse(
        window.localStorage.getItem('neumar_settings') || '{}',
      ) as Record<string, unknown>;
      settings.ui = { simpleShell: true };
      settings.language = 'en-US';
      window.localStorage.setItem('neumar_settings', JSON.stringify(settings));
    });
    await page.goto('/library');
    await page.waitForLoadState('networkidle');
    await page.keyboard.press('Meta+j');
    const remove = page.getByRole('button', { name: 'Remove context' });
    await expect(remove).toBeVisible();
    await remove.click();
    await expect(remove).toHaveCount(0);
  });
});
