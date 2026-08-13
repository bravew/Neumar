import type { BrowserContext, Page } from 'playwright';

import type { DocMediaPrivacyMask, DocMediaStep } from '../../docs.config';
import type { NormalizedDocMediaEntry } from './docs-media-config';

export const FIXED_CAPTURE_TIME = '2026-05-04T12:00:00.000Z';
const FIXED_UUID = '11111111-2222-4333-8444-555555555555';

export async function installDeterministicBrowserState(
  context: BrowserContext,
) {
  await context.addInitScript(
    ({ fixedTime, fixedUuid }) => {
      const OriginalDate = Date;

      class FixedDate extends OriginalDate {
        constructor(value?: string | number | Date) {
          if (value === undefined) {
            super(fixedTime);
          } else {
            super(value);
          }
        }

        static now() {
          return new OriginalDate(fixedTime).getTime();
        }
      }

      window.Date = FixedDate as DateConstructor;
      Math.random = () => 0.42;

      Object.defineProperty(window.crypto, 'randomUUID', {
        configurable: true,
        value: () => fixedUuid,
      });
    },
    {
      fixedTime: FIXED_CAPTURE_TIME,
      fixedUuid: FIXED_UUID,
    },
  );
}

export async function preparePageForCapture(
  page: Page,
  entry: NormalizedDocMediaEntry,
  options: { still: boolean },
) {
  await page.setViewportSize(entry.viewport);

  if (options.still) {
    await disableAnimationsAndCarets(page);
  }

  await waitForFontsReady(page);
  await applyPrivacyMasks(page, entry.privacyMasks);
}

export async function waitForFontsReady(page: Page) {
  await page.evaluate(async () => {
    await document.fonts?.ready;
  });
}

export async function disableAnimationsAndCarets(page: Page) {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-delay: 0s !important;
        animation-duration: 0s !important;
        caret-color: transparent !important;
        transition-delay: 0s !important;
        transition-duration: 0s !important;
      }
    `,
  });
}

export async function applyPrivacyMasks(
  page: Page,
  masks: DocMediaPrivacyMask[],
) {
  for (const mask of masks) {
    await page.locator(mask.selector).evaluateAll((nodes, replacement) => {
      for (const node of nodes) {
        if (node instanceof HTMLElement) {
          node.dataset.docsMasked = 'true';
          node.textContent = replacement;
        }
        if (
          node instanceof HTMLInputElement ||
          node instanceof HTMLTextAreaElement
        ) {
          node.value = replacement;
        }
      }
    }, mask.replacement);
  }
}

export async function executeStep(page: Page, step: DocMediaStep) {
  switch (step.action) {
    case 'click':
      if (!step.selector) return;
      await page.locator(step.selector).first().waitFor({ state: 'attached' });
      await page
        .locator(step.selector)
        .first()
        .evaluate((node) => {
          node.scrollIntoView({ block: 'center', inline: 'nearest' });
          if (node instanceof HTMLElement) node.click();
        });
      await page.waitForTimeout(150);
      return;
    case 'fill':
      if (!step.selector) return;
      await page.locator(step.selector).first().waitFor({ state: 'visible' });
      await page
        .locator(step.selector)
        .first()
        .fill(step.value ?? '');
      return;
    case 'type':
      if (!step.selector) return;
      await page.locator(step.selector).first().waitFor({ state: 'visible' });
      await page.locator(step.selector).first().focus();
      await page.keyboard.type(step.value ?? '', {
        delay: step.typeDelay ?? 35,
      });
      return;
    case 'navigate':
      if (!step.url) return;
      await page.goto(new URL(step.url, page.url()).toString(), {
        waitUntil: 'load',
      });
      return;
    case 'clear-state-reload':
      await page.evaluate(() => {
        window.history.replaceState(null, '', window.location.href);
      });
      await page.reload({ waitUntil: 'load' });
      return;
    case 'scroll':
      await page.mouse.wheel(0, step.ms ?? 500);
      return;
    case 'wait':
      await page.waitForTimeout(step.ms ?? 700);
      return;
  }
}
