import { test, expect, type Page, type Browser } from '@playwright/test';
import { startIsolatedServer, type TestServer } from './helpers/ws-server';
import { TEST_WS_PORT, APP_URL } from './helpers/constants';

let server: TestServer;

test.beforeAll(async () => {
  server = await startIsolatedServer(TEST_WS_PORT);
});

test.afterAll(async () => {
  await server.close();
});

async function openApp(browser: Browser): Promise<Page> {
  const page = await browser.newPage();
  await page.goto(APP_URL);
  await page.waitForSelector('.status-dot.connected', { timeout: 10_000 });
  await page.waitForSelector('#editor .cm-editor', { timeout: 5_000 });
  return page;
}

function editorContent(page: Page) {
  return page.locator('#editor .cm-content');
}

async function typeAndCreateSnapshots(page: Page, text: string): Promise<void> {
  const content = editorContent(page);
  await content.click();
  await page.keyboard.type(text);
  await page.waitForTimeout(300);

  await page.evaluate(() => {
    const provider = window.__yProvider!;
    provider.shouldConnect = false;
    provider.ws?.close();
  });
  await expect(page.locator('.status-dot')).toHaveClass(/disconnected/, { timeout: 5_000 });

  await page.evaluate(() => {
    const provider = window.__yProvider!;
    provider.shouldConnect = true;
    provider.connect();
  });
  await expect(page.locator('.status-dot')).toHaveClass(/connected/, { timeout: 10_000 });

  await expect.poll(async () => {
    return page.locator('.timeline-slider').evaluate(
      (el) => Number((el as HTMLInputElement).max),
    );
  }, { timeout: 5_000 }).toBeGreaterThan(0);
}

// ── US8: Timeline UI is visible on load ──

test.describe('US8: Timeline UI is visible on load', () => {
  test('slider, labels, and live indicator render correctly', async ({ browser }) => {
    const page = await openApp(browser);

    await expect(page.locator('.timeline-slider')).toBeVisible();
    await expect(page.locator('.timeline-meta')).toBeVisible();
    await expect(page.locator('.timeline-label')).toHaveText('history');
    await expect(page.locator('.timeline-live')).toHaveText('live');
    await expect(page.locator('.timeline-live')).not.toHaveClass(/hidden/);

    const sliderState = await page.locator('.timeline-slider').evaluate((el) => {
      const input = el as HTMLInputElement;
      return { value: input.value, max: input.max };
    });
    expect(sliderState.value).toBe(sliderState.max);

    await page.close();
  });
});

// ── US9: Snapshots appear after editing and reconnecting ──

test.describe('US9: Snapshots appear after editing and reconnecting', () => {
  test('slider max increases after text is typed and provider re-syncs', async ({ browser }) => {
    const page = await openApp(browser);

    await typeAndCreateSnapshots(page, 'snapshot test content');

    await expect(page.locator('.timeline-live')).not.toHaveClass(/hidden/);

    const sliderMax = await page.locator('.timeline-slider').evaluate(
      (el) => Number((el as HTMLInputElement).max),
    );
    expect(sliderMax).toBeGreaterThan(0);

    await page.close();
  });
});

// ── US10: Sliding to a snapshot shows preview overlay ──

test.describe('US10: Sliding to a snapshot shows preview overlay', () => {
  test('moving slider to a historical position shows read-only overlay with snapshot text', async ({ browser }) => {
    const page = await openApp(browser);

    await typeAndCreateSnapshots(page, 'history preview test');

    await page.locator('.timeline-slider').evaluate((el) => {
      const input = el as HTMLInputElement;
      input.value = '0';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await expect(page.locator('.history-overlay')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#editor-wrap')).toHaveClass(/history-preview/);
    await expect(page.locator('.timeline-live')).toHaveClass(/hidden/);

    const overlayText = await page.locator('.history-overlay').textContent();
    expect(overlayText).toBeTruthy();

    await page.close();
  });
});

// ── US11: Sliding back to max returns to live view ──

test.describe('US11: Sliding back to max returns to live view', () => {
  test('moving slider to max hides overlay and restores live editor', async ({ browser }) => {
    const page = await openApp(browser);

    await typeAndCreateSnapshots(page, 'back to live test');

    await page.locator('.timeline-slider').evaluate((el) => {
      const input = el as HTMLInputElement;
      input.value = '0';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(page.locator('.history-overlay')).toBeVisible({ timeout: 5_000 });

    await page.locator('.timeline-slider').evaluate((el) => {
      const input = el as HTMLInputElement;
      input.value = input.max;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await expect(page.locator('.history-overlay')).toHaveCount(0, { timeout: 5_000 });
    await expect(page.locator('#editor-wrap')).not.toHaveClass(/history-preview/);
    await expect(page.locator('.timeline-live')).not.toHaveClass(/hidden/);
    await expect(page.locator('.timeline-live')).toHaveText('live');

    await page.close();
  });
});
