import { test, expect } from '../fixtures/base';
import { pressMod } from '../helpers/keys';

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
    await pressMod(page, 'j');
    await expect(page.getByTestId('chat-dock')).toBeVisible();
    // The dock opens on the latest session, whose messages may also say
    // "Library", so check the context chip itself.
    await expect(page.getByTestId('dock-context-chip')).toContainText(
      'Library',
    );
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
    await pressMod(page, 'j');
    const remove = page.getByRole('button', { name: 'Remove context' });
    await expect(remove).toBeVisible();
    await remove.click();
    await expect(remove).toHaveCount(0);
  });
});
