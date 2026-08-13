import { chromium } from 'playwright';

import fs from 'fs/promises';
import path from 'path';

const SCREENSHOTS_DIR = path.resolve(
  import.meta.dirname,
  '../public/screenshots',
);
const APP_URL = 'http://localhost:3420';
const VIEWPORT_1080P = { width: 1920, height: 1080 } as const;

interface ScreenshotSpec {
  name: string;
  path: string;
  viewport: { width: number; height: number };
  waitFor?: string;
  actions?: Array<{
    type: 'click' | 'fill' | 'wait';
    selector?: string;
    value?: string;
    ms?: number;
  }>;
  clip?: { x: number; y: number; width: number; height: number };
}

const specs: ScreenshotSpec[] = [
  {
    name: 'home-empty',
    path: '/',
    viewport: VIEWPORT_1080P,
    waitFor: "[data-testid='home-page']",
  },
  {
    name: 'home-with-tasks',
    path: '/',
    viewport: VIEWPORT_1080P,
    waitFor: "[data-testid='task-list']",
  },
  {
    name: 'task-detail-streaming',
    path: '/task/demo-task-1',
    viewport: VIEWPORT_1080P,
    waitFor: "[data-testid='message-list']",
  },
  {
    name: 'task-detail-artifacts',
    path: '/task/demo-task-1',
    viewport: VIEWPORT_1080P,
    waitFor: "[data-testid='artifact-preview']",
  },
  {
    name: 'library',
    path: '/library',
    viewport: VIEWPORT_1080P,
    waitFor: "[data-testid='library-page']",
  },
  {
    name: 'dashboard',
    path: '/dashboard',
    viewport: VIEWPORT_1080P,
    waitFor: "[data-testid='dashboard-page']",
  },
  {
    name: 'automation',
    path: '/automation',
    viewport: VIEWPORT_1080P,
    waitFor: "[data-testid='automation-page']",
  },
  {
    name: 'approvals',
    path: '/approvals',
    viewport: VIEWPORT_1080P,
    waitFor: "[data-testid='approvals-page']",
  },
  {
    name: 'projects',
    path: '/projects',
    viewport: VIEWPORT_1080P,
    waitFor: "[data-testid='projects-page']",
  },
  {
    name: 'setup',
    path: '/setup',
    viewport: VIEWPORT_1080P,
    waitFor: "[data-testid='setup-page']",
  },
];

async function captureAll() {
  await fs.mkdir(SCREENSHOTS_DIR, { recursive: true });

  console.log(`Capturing ${specs.length} screenshots...\n`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    colorScheme: 'dark',
  });

  for (const spec of specs) {
    const page = await context.newPage();
    await page.setViewportSize(spec.viewport);

    try {
      await page.goto(`${APP_URL}${spec.path}`, {
        waitUntil: 'load',
        timeout: 15000,
      });

      if (spec.waitFor) {
        await page
          .waitForSelector(spec.waitFor, { timeout: 10000 })
          .catch(() => {
            console.warn(
              `  ! ${spec.name}: selector ${spec.waitFor} not found, capturing anyway`,
            );
          });
      }

      if (spec.actions) {
        for (const action of spec.actions) {
          if (action.type === 'click' && action.selector) {
            await page.click(action.selector);
          } else if (
            action.type === 'fill' &&
            action.selector &&
            action.value
          ) {
            await page.fill(action.selector, action.value);
          } else if (action.type === 'wait' && action.ms) {
            await page.waitForTimeout(action.ms);
          }
        }
      }

      await page.screenshot({
        path: path.join(SCREENSHOTS_DIR, `${spec.name}.png`),
        clip: spec.clip,
        type: 'png',
      });

      console.log(`  + ${spec.name}.png`);
    } catch (err) {
      console.error(`  x ${spec.name}: ${err}`);
    }

    await page.close();
  }

  await browser.close();
  console.log('\nDone.');
}

captureAll();
