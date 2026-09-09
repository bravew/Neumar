import fs from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import { createHtmlAdapter } from '@/shared/video/engines/html-adapter';
import { createHyperframesAdapter } from '@/shared/video/engines/hyperframes-adapter';
import { HyperframesStudioBridge } from '@/shared/video/hyperframes-studio';

const ArgsSchema = z.object({
  fixtureDir: z.string().min(1),
  outputDir: z.string().min(1),
  durationSec: z.number().positive().max(600),
  selectionOnly: z.boolean(),
});

function parseArgs() {
  const values: Record<string, string> = {};
  for (const arg of process.argv.slice(2)) {
    if (arg === '--selection-only') {
      values['selection-only'] = 'true';
      continue;
    }
    const [key, value] = arg.split('=', 2);
    if (key?.startsWith('--') && value) values[key.slice(2)] = value;
  }
  return ArgsSchema.parse({
    fixtureDir: values['fixture-dir'],
    outputDir: values['output-dir'],
    durationSec: Number(values['duration-sec']),
    selectionOnly: values['selection-only'] === 'true',
  });
}

async function main() {
  const args = parseArgs();
  const fixtureDir = path.resolve(args.fixtureDir);
  const outputDir = path.resolve(args.outputDir);
  const sourcePath = path.join(fixtureDir, 'index.html');
  const hyperframesCommand = path.resolve(
    'src-video/node_modules/.bin/hyperframes',
  );
  await fs.mkdir(outputDir, { recursive: true });

  if (args.selectionOnly) {
    const studioSelection = await selectStudioFixtureElement({
      fixtureDir,
      hyperframesCommand,
    });
    process.stdout.write(
      `VIDEO_ACCEPTANCE_RESULT=${JSON.stringify({ studioSelection })}\n`,
    );
    return;
  }

  const htmlOutput = path.join(outputDir, 'html.mp4');
  const hyperframesOutput = path.join(outputDir, 'hyperframes.mp4');
  const htmlWorkDir = path.join(outputDir, 'html-work');
  const hyperframesWorkDir = path.join(outputDir, 'hyperframes-work');
  await Promise.all([
    fs.mkdir(htmlWorkDir, { recursive: true }),
    fs.mkdir(hyperframesWorkDir, { recursive: true }),
  ]);
  const baseConfig = {
    format: 'mp4' as const,
    resolution: { width: 1920, height: 1080 },
    fps: { num: 30, den: 1 },
    duration: args.durationSec,
    quality: 'draft' as const,
  };

  const playwrightLoader = await acceptancePlaywrightLoader();
  const html = await createHtmlAdapter({ playwrightLoader }).render(
    {
      template: { id: 'video-parity-v1', engineId: 'html', sourcePath },
      config: { ...baseConfig, outputPath: htmlOutput },
    },
    { workDir: htmlWorkDir },
  );
  const hyperframes = await createHyperframesAdapter({
    command: hyperframesCommand,
  }).render(
    {
      template: {
        id: 'video-parity-v1',
        engineId: 'hyperframes',
        sourcePath,
      },
      config: { ...baseConfig, outputPath: hyperframesOutput },
    },
    { workDir: hyperframesWorkDir },
  );
  const studioSelection = await selectStudioFixtureElement({
    fixtureDir,
    hyperframesCommand,
  });

  process.stdout.write(
    `VIDEO_ACCEPTANCE_RESULT=${JSON.stringify({ html, hyperframes, studioSelection })}\n`,
  );
}

async function acceptancePlaywrightLoader(): Promise<() => Promise<unknown>> {
  const loaded = await import('@playwright/test');
  const systemChrome =
    process.platform === 'darwin'
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : undefined;
  if (!systemChrome || !(await fs.stat(systemChrome).catch(() => null))) {
    return async () => loaded;
  }
  return async () => ({
    chromium: {
      executablePath: () => systemChrome,
      launch: (options: { headless?: boolean; args?: string[] }) =>
        loaded.chromium.launch({ ...options, executablePath: systemChrome }),
    },
  });
}

async function selectStudioFixtureElement(input: {
  fixtureDir: string;
  hyperframesCommand: string;
}) {
  const bridge = new HyperframesStudioBridge(input.hyperframesCommand);
  const subscriberId = crypto.randomUUID();
  const session = await bridge.acquire(input.fixtureDir, subscriberId);
  const loaded = await import('@playwright/test');
  const systemChrome =
    process.platform === 'darwin'
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : undefined;
  let browser: Awaited<ReturnType<typeof loaded.chromium.launch>> | undefined;
  try {
    browser = await loaded.chromium.launch({
      headless: true,
      ...(systemChrome ? { executablePath: systemChrome } : {}),
    });
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    await page.goto(session.studioUrl, { waitUntil: 'domcontentloaded' });
    await page
      .frameLocator('iframe')
      .locator('[data-hf-id="parity-card"]')
      .waitFor({ state: 'visible', timeout: 60_000 });
    await page.getByText('Layers', { exact: true }).click();
    await page.getByText('2 layers', { exact: true }).waitFor({
      state: 'visible',
      timeout: 20_000,
    });
    await page
      .getByText('Card', { exact: true })
      .first()
      .click({ timeout: 20_000 });
    const selection = await bridge.getSelection(input.fixtureDir);
    if (selection.stableTarget !== 'parity-card') {
      throw new Error(
        `Studio selected ${selection.stableTarget ?? 'no target'}, expected parity-card`,
      );
    }
    return {
      stableTarget: selection.stableTarget,
      sourceFile: selection.sourceFile,
      label: selection.label,
      tagName: selection.tagName,
    };
  } finally {
    await browser?.close();
    await bridge.release(input.fixtureDir, subscriberId).catch(() => false);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
