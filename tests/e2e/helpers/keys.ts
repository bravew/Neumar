import type { Page } from '@playwright/test';

/**
 * Press a `mod+<key>` app shortcut. The app resolves `mod` from the page's
 * reported platform, which can differ from the host OS under Playwright.
 * Shortcuts ignore editable targets, so blur an autofocused composer first.
 */
export async function pressMod(page: Page, key: string) {
  const isMac = await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    const nav = navigator as Navigator & {
      userAgentData?: { platform?: string };
    };
    return /Mac|iPhone|iPad|iPod/i.test(
      nav.userAgentData?.platform ?? nav.userAgent,
    );
  });
  await page.keyboard.press(`${isMac ? 'Meta' : 'Control'}+${key}`);
}
