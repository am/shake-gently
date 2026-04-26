import { test, expect, type Page, type Browser } from '@playwright/test';
import type { WebSocketServer } from 'ws';
import { startIsolatedServer, stopServer } from './helpers/ws-server';
import { TEST_WS_PORT, APP_URL } from './helpers/constants';
import { SHADES } from '../src/awareness';

const SHADE_NAMES = SHADES.map((s) => s.name);

let wss: WebSocketServer;

test.beforeAll(async () => {
  wss = await startIsolatedServer(TEST_WS_PORT);
});

test.afterAll(async () => {
  await stopServer(wss);
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

// ── US1: Solo user opens the app ──

test.describe('US1: Solo user opens the app', () => {
  test('status shows live, badge has a known shade name, presence shows self, editor renders', async ({ browser }) => {
    const page = await openApp(browser);

    await expect(page).toHaveTitle('Shake gently');
    await expect(page.locator('#status-text')).toHaveText('live');
    await expect(page.locator('.status-dot')).toHaveClass(/connected/);

    const badge = page.locator('#user-label');
    await expect(badge).toBeVisible();
    const badgeText = await badge.textContent();
    expect(SHADE_NAMES).toContain(badgeText);

    const presenceUsers = page.locator('.presence-user');
    await expect(presenceUsers).toHaveCount(1);

    const editor = page.locator('#editor .cm-editor');
    await expect(editor).toBeVisible();

    await page.close();
  });
});

// ── US2: Solo user types and text is colored ──

test.describe('US2: Solo user types and text is colored', () => {
  test('typed text appears and acquires per-user color attribute', async ({ browser }) => {
    const page = await openApp(browser);

    const content = editorContent(page);
    await content.click();
    await page.keyboard.type('hello world');

    await expect(content).toContainText('hello world');

    await expect.poll(async () => {
      return content.evaluate((el) => el.querySelectorAll('[style*="color"]').length > 0);
    }, { timeout: 5_000 }).toBe(true);

    await page.close();
  });
});

// ── US3: Second user joins and sees shared state ──

test.describe('US3: Second user joins and sees shared state', () => {
  test('second user sees first user text and both presences show 2 users', async ({ browser }) => {
    const pageA = await openApp(browser);

    const contentA = editorContent(pageA);
    await contentA.click();
    await pageA.keyboard.type('from user A');
    await expect(contentA).toContainText('from user A');

    const pageB = await openApp(browser);

    const contentB = editorContent(pageB);
    await expect(contentB).toContainText('from user A');

    await expect(pageA.locator('.presence-user')).toHaveCount(2, { timeout: 10_000 });
    await expect(pageB.locator('.presence-user')).toHaveCount(2, { timeout: 10_000 });

    await pageA.close();
    await pageB.close();
  });
});

// ── US4: Real-time sync between two users ──

test.describe('US4: Real-time sync between two users', () => {
  test('text typed by A appears on B and vice versa', async ({ browser }) => {
    const pageA = await openApp(browser);
    const pageB = await openApp(browser);

    const contentA = editorContent(pageA);
    const contentB = editorContent(pageB);

    await contentA.click();
    await pageA.keyboard.type('alpha');
    await expect(contentB).toContainText('alpha', { timeout: 5_000 });

    await contentB.click();
    await pageB.keyboard.type('beta');
    await expect(contentA).toContainText('beta', { timeout: 5_000 });

    // Compare actual document text via Yjs, not DOM textContent
    // (DOM includes remote cursor label overlay elements)
    const textA = await pageA.evaluate(() => window.__yProvider!.doc.getText('codemirror').toString());
    const textB = await pageB.evaluate(() => window.__yProvider!.doc.getText('codemirror').toString());
    expect(textA).toBe(textB);

    await pageA.close();
    await pageB.close();
  });
});

// ── US5: Each user gets a unique identity ──

test.describe('US5: Each user gets a unique identity', () => {
  test('two users have different names and colors', async ({ browser }) => {
    const pageA = await openApp(browser);
    const pageB = await openApp(browser);

    await expect(pageA.locator('.presence-user')).toHaveCount(2, { timeout: 10_000 });
    await expect(pageB.locator('.presence-user')).toHaveCount(2, { timeout: 10_000 });

    const nameA = await pageA.locator('#user-label').textContent();
    const nameB = await pageB.locator('#user-label').textContent();
    expect(nameA).not.toBe(nameB);
    expect(SHADE_NAMES).toContain(nameA);
    expect(SHADE_NAMES).toContain(nameB);

    const colorsA = await pageA.locator('.presence-dot').evaluateAll((dots) =>
      dots.map((d) => (d as HTMLElement).style.background),
    );
    const uniqueColors = new Set(colorsA);
    expect(uniqueColors.size).toBe(2);

    await pageA.close();
    await pageB.close();
  });
});

// ── US6: Identity collision resolution ──

test.describe('US6: Identity collision resolution', () => {
  test('forced duplicate name triggers re-pick on the higher clientID', async ({ browser }) => {
    const pageA = await openApp(browser);
    const pageB = await openApp(browser);

    await expect(pageA.locator('.presence-user')).toHaveCount(2, { timeout: 5_000 });

    const nameA = await pageA.locator('#user-label').textContent();

    // Force pageB to use the same name as pageA
    await pageB.evaluate((forcedName) => {
      const provider = window.__yProvider;
      if (!provider) return;
      const localState = provider.awareness.getLocalState();
      if (localState?.user) {
        provider.awareness.setLocalStateField('user', {
          ...localState.user,
          name: forcedName,
        });
      }
    }, nameA);

    // Poll until the collision guard resolves and names diverge
    await expect.poll(async () => {
      const a = await pageA.locator('#user-label').textContent();
      const b = await pageB.locator('#user-label').textContent();
      return a !== b;
    }, { timeout: 10_000 }).toBe(true);

    const finalNameA = await pageA.locator('#user-label').textContent();
    const finalNameB = await pageB.locator('#user-label').textContent();
    expect(SHADE_NAMES).toContain(finalNameA);
    expect(SHADE_NAMES).toContain(finalNameB);

    await pageA.close();
    await pageB.close();
  });
});

// ── US7: Disconnect and reconnect ──

test.describe('US7: Disconnect and reconnect', () => {
  test('disconnected user shows status change, other presence drops, reconnect restores', async ({ browser }) => {
    const pageA = await openApp(browser);
    const pageB = await openApp(browser);

    await expect(pageA.locator('.presence-user')).toHaveCount(2, { timeout: 10_000 });
    await expect(pageB.locator('.presence-user')).toHaveCount(2, { timeout: 10_000 });

    // Disconnect page B by closing its raw WebSocket
    await pageB.evaluate(() => {
      const provider = window.__yProvider!;
      provider.shouldConnect = false;
      provider.ws?.close();
    });

    await expect(pageB.locator('#status-text')).toHaveText('connecting...', { timeout: 5_000 });
    await expect(pageB.locator('.status-dot')).toHaveClass(/disconnected/);

    // Page A presence should drop to 1 (awareness cleanup is async)
    await expect(pageA.locator('.presence-user')).toHaveCount(1, { timeout: 15_000 });

    // Reconnect page B by re-enabling auto-connect
    await pageB.evaluate(() => {
      const provider = window.__yProvider!;
      provider.shouldConnect = true;
      provider.connect();
    });

    await expect(pageB.locator('#status-text')).toHaveText('live', { timeout: 10_000 });
    await expect(pageB.locator('.status-dot')).toHaveClass(/connected/);

    await expect(pageA.locator('.presence-user')).toHaveCount(2, { timeout: 15_000 });
    await expect(pageB.locator('.presence-user')).toHaveCount(2, { timeout: 15_000 });

    await pageA.close();
    await pageB.close();
  });
});
