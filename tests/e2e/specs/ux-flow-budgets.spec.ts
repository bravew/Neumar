import { expect, test } from '../fixtures/base';

/**
 * Flow budgets from the simple-UX plan (02 §7.3).
 * Hover preloads the route chunk, so the click should only paint.
 */
test.describe('UX flow budgets', () => {
  test('nav click paints the library skeleton or page within 100ms', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByTestId('home-page')).toBeVisible();

    const library = page.getByRole('button', { name: 'Library', exact: true });
    const preload = page
      .waitForResponse(
        (response) =>
          response.url().includes('/Library') && response.status() < 400,
        { timeout: 5_000 },
      )
      .catch(() => null);
    await library.hover();
    await preload;

    const elapsed = await page.evaluate(async () => {
      const button = [...document.querySelectorAll('button')].find(
        (node) => node.textContent?.trim() === 'Library',
      );
      if (!button) return Number.POSITIVE_INFINITY;
      const started = new Promise<number>((resolve) => {
        const observer = new MutationObserver(() => {
          const painted = document.querySelector(
            '[data-testid="library-page"], [data-testid="route-skeleton-library"]',
          );
          if (!painted) return;
          observer.disconnect();
          resolve(performance.now());
        });
        observer.observe(document.body, { childList: true, subtree: true });
        button.addEventListener(
          'click',
          () => {
            (window as Window & { __navClickAt?: number }).__navClickAt =
              performance.now();
          },
          { once: true },
        );
      });
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const paintedAt = await started;
      const clickAt =
        (window as Window & { __navClickAt?: number }).__navClickAt ??
        paintedAt;
      return paintedAt - clickAt;
    });

    await expect(page.getByTestId('library-page')).toBeVisible();
    expect(elapsed).toBeLessThan(100);
  });

  test('a route change has no frame where both pages are more than half opaque', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByTestId('home-page')).toBeVisible();

    await page.evaluate(() => {
      const samples: boolean[] = [];
      const stopAt = performance.now() + 1_500;
      const tick = () => {
        let oldOpacity = 0;
        let newOpacity = 0;
        let sawOld = false;
        let sawNew = false;
        for (const anim of document.getAnimations()) {
          if (!(anim instanceof CSSAnimation)) continue;
          if (
            anim.animationName !== 'vt-fade-out' &&
            anim.animationName !== 'vt-fade-in'
          ) {
            continue;
          }
          const effect = anim.effect;
          if (!(effect instanceof KeyframeEffect) || !effect.target) continue;
          const pseudo = effect.pseudoElement ?? '';
          const opacity = Number.parseFloat(
            getComputedStyle(effect.target, pseudo || null).opacity,
          );
          if (!Number.isFinite(opacity)) continue;
          if (anim.animationName === 'vt-fade-out') {
            sawOld = true;
            oldOpacity = Math.max(oldOpacity, opacity);
          }
          if (anim.animationName === 'vt-fade-in') {
            sawNew = true;
            newOpacity = Math.max(newOpacity, opacity);
          }
        }
        if (sawOld && sawNew) {
          samples.push(oldOpacity > 0.5 && newOpacity > 0.5);
        }
        if (performance.now() < stopAt) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      (window as Window & { __vtOverlap?: boolean[] }).__vtOverlap = samples;
    });

    await page.getByRole('button', { name: 'Library', exact: true }).click();
    await expect(page.getByTestId('library-page')).toBeVisible();
    await page.waitForTimeout(400);

    const overlap = await page.evaluate(
      () => (window as Window & { __vtOverlap?: boolean[] }).__vtOverlap ?? [],
    );
    expect(overlap.length).toBeGreaterThan(0);
    expect(overlap.some(Boolean)).toBe(false);
  });
});
