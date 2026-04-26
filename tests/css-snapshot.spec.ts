import { test, expect } from '@playwright/test';
import { WebSocketServer } from 'ws';
import { startIsolatedServer, stopServer } from './helpers/ws-server';
import { TEST_WS_PORT, APP_URL } from './helpers/constants';

// SVG feTurbulence noise + font sub-pixel rendering create ~1-2% pixel
// variance between browser launches. Threshold set above that noise floor
// but well below any meaningful style change.
const VISUAL_TOLERANCE = 0.02;

let wss: WebSocketServer;

test.beforeAll(async () => {
  wss = await startIsolatedServer(TEST_WS_PORT);
});

test.afterAll(async () => {
  await stopServer(wss);
});

test.describe('CSS visual regression', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      let seed = 42;
      Math.random = () => {
        seed = (seed * 16807 + 0) % 2147483647;
        return (seed - 1) / 2147483646;
      };
    });

    await page.goto(APP_URL);
    await page.waitForSelector('.status-dot.connected', { timeout: 10_000 });
    await page.waitForSelector('#editor .cm-editor', { timeout: 5_000 });
    // Settle time for font loading and SVG noise filter rendering;
    // no stable visual-ready signal exists for these.
    await page.waitForTimeout(1000);
  });

  test('full page', async ({ page }) => {
    await expect(page).toHaveScreenshot('full-page.png', {
      fullPage: true,
      maxDiffPixelRatio: VISUAL_TOLERANCE,
    });
  });

  test('editor area', async ({ page }) => {
    const editor = page.locator('#editor-wrap');
    await expect(editor).toHaveScreenshot('editor-area.png', {
      maxDiffPixelRatio: VISUAL_TOLERANCE,
    });
  });

  test('chrome bar', async ({ page }) => {
    const chrome = page.locator('.chrome');
    await expect(chrome).toHaveScreenshot('chrome-bar.png', {
      maxDiffPixelRatio: VISUAL_TOLERANCE,
    });
  });

  test('computed styles snapshot', async ({ page }) => {
    const styles = await page.evaluate(() => {
      const PROPS = [
        'display', 'flex-direction', 'align-items', 'justify-content',
        'gap', 'padding', 'margin', 'min-height',
        'max-width', 'background-color',
        'font-family', 'font-size', 'font-weight', 'letter-spacing',
        'text-transform', 'border-radius', 'overflow', 'position',
        'backdrop-filter', '-webkit-backdrop-filter', 'flex',
        'box-sizing', 'line-height', 'flex-wrap',
      ];

      function grab(selector: string): Record<string, string> | null {
        const el = document.querySelector(selector);
        if (!el) return null;
        const cs = getComputedStyle(el);
        const result: Record<string, string> = {};
        for (const p of PROPS) {
          const v = cs.getPropertyValue(p);
          if (v && v !== 'none' && v !== 'normal' && v !== '0px' && v !== 'auto') {
            result[p] = v;
          }
        }
        return result;
      }

      const selectors = [
        'body', '#app', '.chrome', '.status', '.status-dot',
        'main', '#editor-wrap', '#editor',
        '#editor .cm-editor', '#editor .cm-scroller',
        '#editor .cm-content', 'footer', '#presence',
      ];

      const snapshot: Record<string, Record<string, string> | null> = {};
      for (const s of selectors) {
        snapshot[s] = grab(s);
      }
      return snapshot;
    });

    expect(JSON.stringify(styles, null, 2)).toMatchSnapshot('computed-styles.json');
  });
});
