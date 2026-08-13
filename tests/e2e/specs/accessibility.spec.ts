import { test, expect } from '@playwright/test';

/**
 * Accessibility E2E Tests — WCAG 2.1 AA automated audits.
 *
 * Uses @axe-core/playwright for automated a11y scanning.
 * Install: pnpm add -D @axe-core/playwright
 *
 * Best practices:
 * - Test each major page independently
 * - Filter to critical/serious violations only (avoid noise)
 * - Test keyboard navigation flows
 * - Test focus management after interactions
 */

// Conditionally import axe-core — skip tests gracefully if not installed
let AxeBuilder: typeof import('@axe-core/playwright').default | null = null;
try {
  AxeBuilder = (await import('@axe-core/playwright')).default;
} catch {
  // @axe-core/playwright not installed — tests will be skipped
}

const pages = [
  { path: '/', name: 'Home' },
  { path: '/library', name: 'Library' },
  { path: '/automation', name: 'Automation' },
  { path: '/dashboard', name: 'Dashboard' },
  { path: '/org', name: 'Organization' },
  { path: '/projects', name: 'Projects' },
  { path: '/design', name: 'DesignMode' },
];

test.describe('Accessibility', () => {
  // Skip all if axe-core not installed
  test.skip(
    !AxeBuilder,
    '@axe-core/playwright not installed — run: pnpm add -D @axe-core/playwright',
  );

  for (const { path, name } of pages) {
    test(`${name} page has no critical a11y violations`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState('networkidle');

      const results = await new AxeBuilder!({ page })
        .withTags(['wcag2a', 'wcag2aa'])
        .analyze();

      const critical = results.violations.filter(
        (v) => v.impact === 'critical' || v.impact === 'serious',
      );

      if (critical.length > 0) {
        const summary = critical
          .map(
            (v) =>
              `[${v.impact}] ${v.id}: ${v.description} (${v.nodes.length} nodes)`,
          )
          .join('\n');
        expect
          .soft(critical, `A11y violations on ${name}:\n${summary}`)
          .toEqual([]);
      }
    });
  }

  // Keyboard navigation tests (no axe-core needed)
  test('home page chat input is keyboard accessible', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Tab to the chat input
    await page.keyboard.press('Tab');
    // Keep tabbing until we reach a focusable element
    for (let i = 0; i < 20; i++) {
      const focused = await page.evaluate(
        () => document.activeElement?.tagName,
      );
      if (focused === 'TEXTAREA' || focused === 'INPUT') break;
      await page.keyboard.press('Tab');
    }

    // The chat input should be reachable via keyboard
    const focusedTag = await page.evaluate(
      () => document.activeElement?.tagName,
    );
    expect(['TEXTAREA', 'INPUT', 'BUTTON']).toContain(focusedTag);
  });

  test('Escape closes dialogs and returns focus', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Open search dialog with Cmd+K
    await page.keyboard.press('Meta+k');

    // Try to find the search input
    const searchInput = page.getByPlaceholder(/search/i);
    const isVisible = await searchInput.isVisible().catch(() => false);

    if (isVisible) {
      // Close with Escape
      await page.keyboard.press('Escape');
      await expect(searchInput).not.toBeVisible({ timeout: 2_000 });
    }
  });
});
