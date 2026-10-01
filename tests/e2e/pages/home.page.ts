import type { Locator, Page } from '@playwright/test';

/**
 * Page Object for the Home page (/).
 *
 * Playwright best practices:
 * - Prefer role-based and text-based selectors over CSS/testid
 * - The placeholder follows the active mode, so find the input by role
 * - Use getByRole('navigation') for nav elements
 * - Locators are lazy — they don't query the DOM until an action/assertion
 */
export class HomePage {
  /** The main chat input textarea */
  readonly chatInput: Locator;
  /** The left sidebar <aside> element */
  readonly sidebar: Locator;
  /** Navigation section within the sidebar */
  readonly nav: Locator;

  constructor(private page: Page) {
    this.chatInput = page
      .getByTestId('home-composer-frame')
      .getByRole('textbox');
    this.sidebar = page.locator('aside').first();
    this.nav = page.locator('nav').first();
  }

  async goto() {
    await this.page.goto('/');
    // Wait for the app to finish loading (lazy routes + setup guard)
    await this.page.waitForLoadState('networkidle');
  }

  async submitPrompt(text: string) {
    await this.chatInput.fill(text);
    await this.chatInput.press('Enter');
  }

  async waitForNavigation() {
    await this.page.waitForURL(/\/task-v2\//);
  }
}
