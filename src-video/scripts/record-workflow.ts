import { chromium } from 'playwright';

import fs from 'fs/promises';
import path from 'path';

const RECORDINGS_DIR = path.resolve(
  import.meta.dirname,
  '../public/recordings',
);
const APP_URL = 'http://localhost:3420';
const VIEWPORT_1080P = { width: 1920, height: 1080 } as const;
const IS_CI = !!process.env.CI;

interface RecordingSpec {
  name: string;
  startPath: string;
  viewport: { width: number; height: number };
  warmupMs?: number;
  steps: Array<{
    action: 'navigate' | 'click' | 'fill' | 'wait' | 'scroll' | 'type';
    selector?: string;
    value?: string;
    ms?: number;
    url?: string;
    typeDelay?: number;
  }>;
}

const workflows: RecordingSpec[] = [
  {
    name: 'task-creation-flow',
    startPath: '/',
    viewport: VIEWPORT_1080P,
    warmupMs: 2000,
    steps: [
      { action: 'wait', ms: 1000 },
      {
        action: 'type',
        selector: "[data-testid='chat-input']",
        value: 'Research competitor pricing and create a summary report',
        typeDelay: 40,
      },
      { action: 'wait', ms: 500 },
      { action: 'click', selector: "[data-testid='send-button']" },
      { action: 'wait', ms: 8000 },
    ],
  },
  {
    name: 'feature-mcp-tools',
    startPath: '/setup',
    viewport: VIEWPORT_1080P,
    warmupMs: 2000,
    steps: [
      { action: 'wait', ms: 1000 },
      { action: 'click', selector: "[data-testid='mcp-tab']" },
      { action: 'wait', ms: 2000 },
      { action: 'scroll', ms: 400 },
      { action: 'wait', ms: 2000 },
    ],
  },
  {
    name: 'automation-setup',
    startPath: '/automation',
    viewport: VIEWPORT_1080P,
    warmupMs: 2000,
    steps: [
      { action: 'wait', ms: 1500 },
      { action: 'click', selector: "[data-testid='create-automation']" },
      { action: 'wait', ms: 1000 },
      {
        action: 'type',
        selector: "[data-testid='automation-name']",
        value: 'Daily Analytics Report',
        typeDelay: 50,
      },
      { action: 'wait', ms: 3000 },
    ],
  },
];

async function recordWorkflow(spec: RecordingSpec) {
  const browser = await chromium.launch({ headless: IS_CI });
  const context = await browser.newContext({
    recordVideo: {
      dir: RECORDINGS_DIR,
      size: spec.viewport,
    },
    colorScheme: 'dark',
    viewport: spec.viewport,
  });

  const page = await context.newPage();

  try {
    await page.goto(`${APP_URL}${spec.startPath}`, {
      waitUntil: 'load',
    });

    if (spec.warmupMs) {
      await page.waitForTimeout(spec.warmupMs);
    }

    for (const step of spec.steps) {
      await page.waitForTimeout(600); // Natural pacing

      switch (step.action) {
        case 'click':
          if (step.selector) {
            await page.hover(step.selector);
            await page.waitForTimeout(200);
            await page.click(step.selector);
          }
          break;
        case 'type':
          if (step.selector && step.value) {
            await page.click(step.selector);
            await page.type(step.selector, step.value, {
              delay: step.typeDelay ?? 50,
            });
          }
          break;
        case 'fill':
          if (step.selector && step.value) {
            await page.fill(step.selector, step.value);
          }
          break;
        case 'wait':
          await page.waitForTimeout(step.ms ?? 1000);
          break;
        case 'navigate':
          if (step.url) {
            await page.goto(step.url, { waitUntil: 'load' });
          }
          break;
        case 'scroll':
          await page.evaluate(
            (px) => window.scrollBy({ top: px, behavior: 'smooth' }),
            step.ms ?? 300,
          );
          break;
      }
    }

    // Hold final frame
    await page.waitForTimeout(2000);
  } finally {
    // Grab the video handle before closing the page
    const video = page.video();
    await page.close();

    if (video) {
      const videoPath = await video.path();
      const finalPath = path.join(RECORDINGS_DIR, `${spec.name}.webm`);
      await fs.rename(videoPath, finalPath);
      console.log(`  + ${spec.name}.webm`);
    }

    await browser.close();
  }
}

async function recordAll() {
  await fs.mkdir(RECORDINGS_DIR, { recursive: true });

  const target = process.argv[2];
  const toRecord = target
    ? workflows.filter((w) => w.name === target)
    : workflows;

  if (toRecord.length === 0) {
    console.error(`Unknown workflow: ${target}`);
    console.error('Available:', workflows.map((w) => w.name).join(', '));
    process.exit(1);
  }

  console.log(`Recording ${toRecord.length} workflow(s)...\n`);

  for (const spec of toRecord) {
    try {
      await recordWorkflow(spec);
    } catch (err) {
      console.error(`  x ${spec.name}: ${err}`);
    }
  }

  console.log('\nDone.');
}

recordAll();
