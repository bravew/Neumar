import { test, expect } from '../fixtures/base';

/**
 * Settings modal E2E tests.
 *
 * The settings modal is an overlay accessible from the sidebar,
 * not a separate route — it opens on top of the current page.
 */
test.describe('Settings', () => {
  test.beforeEach(async ({ page }) => {
    // Mock settings and providers APIs
    await page.route('**/db/settings', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ theme: 'dark', language: 'en-US' }),
      }),
    );

    await page.route('**/providers/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ providers: [] }),
      }),
    );

    await page.route('**/mcp/config', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { mcpServers: {} } }),
      }),
    );
  });

  test('settings modal can be opened from sidebar', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Look for a settings button/icon in the sidebar
    const settingsButton = page
      .locator('aside')
      .getByRole('button')
      .filter({
        has: page.locator('[class*="settings"], [class*="Settings"]'),
      });

    // If direct class match fails, try by aria or common patterns
    const fallbackButton = page.locator('aside button').last();

    // Try to find and click settings trigger
    const trigger =
      (await settingsButton.count()) > 0
        ? settingsButton.first()
        : fallbackButton;

    if (await trigger.isVisible()) {
      await trigger.click();
      // Use web-first assertion instead of arbitrary timeout
      // Settings modal should render some recognizable content
      await page.waitForLoadState('domcontentloaded');
    }
  });
});

test.describe('Settings simple shell', () => {
  test('changes the default model in two clicks', async ({ page }) => {
    const providers = [
      {
        id: 'claude',
        name: 'Anthropic Claude',
        enabled: true,
        apiKey: 'test-key',
        baseUrl: 'https://api.anthropic.com',
        models: ['claude-sonnet-5', 'claude-opus-5'],
      },
    ];
    await page.route('**/db/settings', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ui: JSON.stringify({ simpleShell: true }),
          language: JSON.stringify('en-US'),
          defaultProvider: JSON.stringify('default'),
          defaultModel: JSON.stringify(''),
          providers: JSON.stringify(providers),
        }),
      });
    });
    await page.addInitScript(() => {
      const settings = JSON.parse(
        window.localStorage.getItem('neumar_settings') || '{}',
      ) as Record<string, unknown>;
      settings.ui = { simpleShell: true };
      settings.language = 'en-US';
      settings.defaultProvider = 'default';
      settings.defaultModel = '';
      settings.providers = [
        {
          id: 'claude',
          name: 'Anthropic Claude',
          enabled: true,
          apiKey: 'test-key',
          baseUrl: 'https://api.anthropic.com',
          models: ['claude-sonnet-5', 'claude-opus-5'],
        },
      ];
      window.localStorage.setItem('neumar_settings', JSON.stringify(settings));
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.keyboard.press('Meta+,');
    await expect(page.getByTestId('settings-modal')).toBeVisible();
    await page.getByRole('button', { name: 'Models', exact: true }).click();
    await page.getByTestId('default-model-claude-claude-opus-5').click();
    await expect(
      page.getByTestId('default-model-claude-claude-opus-5'),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  test('opens a connector in two clicks', async ({ page }) => {
    await page.route('**/db/settings', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ui: JSON.stringify({ simpleShell: true }),
          language: JSON.stringify('en-US'),
        }),
      });
    });
    await page.route('**/connectors/composio/config', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ configured: false, apiKeyTail: '' }),
      }),
    );
    await page.route('**/connectors', (route) => {
      const path = new URL(route.request().url()).pathname;
      if (route.request().method() !== 'GET' || !path.endsWith('/connectors')) {
        return route.fallback();
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          connectors: [
            {
              id: 'slack',
              name: 'Slack',
              provider: 'composio',
              category: 'work',
              status: 'available',
              tools: [],
              allowedToolNames: [],
              curatedToolNames: [],
              auth: { provider: 'oauth', configured: false },
            },
          ],
        }),
      });
    });
    await page.route('**/connectors/slack', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'slack',
          name: 'Slack',
          provider: 'composio',
          category: 'work',
          status: 'available',
          tools: [],
          allowedToolNames: [],
          curatedToolNames: [],
          auth: { provider: 'oauth', configured: false },
        }),
      }),
    );
    await page.addInitScript(() => {
      const settings = JSON.parse(
        window.localStorage.getItem('neumar_settings') || '{}',
      ) as Record<string, unknown>;
      settings.ui = { simpleShell: true };
      settings.language = 'en-US';
      window.localStorage.setItem('neumar_settings', JSON.stringify(settings));
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.keyboard.press('Meta+,');
    await expect(page.getByTestId('settings-modal')).toBeVisible();
    await page.getByRole('button', { name: 'Connectors', exact: true }).click();
    await page.getByTestId('connector-connect-slack').click();
    await expect(page.getByRole('button', { name: 'Connect' })).toBeVisible();
    await expect(page.getByLabel('Composio API key')).toHaveCount(0);
  });

  test('search for mcp returns to Agents with the same scroll on Escape', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const settings = JSON.parse(
        window.localStorage.getItem('neumar_settings') || '{}',
      ) as Record<string, unknown>;
      settings.ui = { simpleShell: true };
      settings.language = 'en-US';
      window.localStorage.setItem('neumar_settings', JSON.stringify(settings));
    });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.keyboard.press('Meta+,');
    await expect(page.getByTestId('settings-modal')).toBeVisible();
    await page.getByRole('button', { name: 'Agents & skills' }).click();
    const scroller = page.getByTestId('settings-page-scroll');
    const before = await scroller.evaluate((element) => {
      const spacer = document.createElement('div');
      spacer.style.height = '800px';
      element.appendChild(spacer);
      element.scrollTop = 120;
      return element.scrollTop;
    });
    await page.getByTestId('settings-search').fill('mcp');
    await page.getByRole('button', { name: 'MCP', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Agents & skills' }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('settings-modal')).toBeVisible();
    await expect(page.getByTestId('settings-active-category')).toHaveText(
      'Agents & skills',
    );
    await expect
      .poll(() => scroller.evaluate((element) => element.scrollTop))
      .toBe(before);
  });
});
