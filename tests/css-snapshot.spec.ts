import { test, expect } from '@playwright/test';
import { WebSocketServer } from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

const MSG_SYNC = 0;
const MSG_AWARENESS = 1;
const TEST_WS_PORT = 4321;

// SVG feTurbulence noise + font sub-pixel rendering create ~1-2% pixel
// variance between browser launches. Threshold set above that noise floor
// but well below any meaningful style change.
const VISUAL_TOLERANCE = 0.02;

function startIsolatedServer(port: number): Promise<WebSocketServer> {
  return new Promise((resolve, reject) => {
    const doc = new Y.Doc();
    const awareness = new awarenessProtocol.Awareness(doc);
    awareness.setLocalState(null);

    const conns = new Map<import('ws').WebSocket, Set<number>>();

    awareness.on('update', (changes: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      const changed = [...changes.added, ...changes.updated, ...changes.removed];
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MSG_AWARENESS);
      encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(awareness, changed));
      const buf = encoding.toUint8Array(encoder);

      conns.forEach((_, ws) => {
        if (ws !== origin && ws.readyState === 1) ws.send(buf);
      });

      if (origin instanceof Object && conns.has(origin as import('ws').WebSocket)) {
        const ids = conns.get(origin as import('ws').WebSocket)!;
        for (const id of changes.added) ids.add(id);
        for (const id of changes.updated) ids.add(id);
      }
    });

    const wss = new WebSocketServer({ port });

    wss.on('error', reject);

    wss.on('connection', (ws) => {
      conns.set(ws, new Set());

      {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MSG_SYNC);
        syncProtocol.writeSyncStep1(encoder, doc);
        ws.send(encoding.toUint8Array(encoder));
      }

      ws.on('message', (data) => {
        const buf = new Uint8Array(data as ArrayBuffer);
        const decoder = decoding.createDecoder(buf);
        const msgType = decoding.readVarUint(decoder);

        if (msgType === MSG_SYNC) {
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, MSG_SYNC);
          syncProtocol.readSyncMessage(decoder, encoder, doc, null);
          if (encoding.length(encoder) > 1) ws.send(encoding.toUint8Array(encoder));
          conns.forEach((_, peer) => {
            if (peer !== ws && peer.readyState === 1) peer.send(buf);
          });
        } else if (msgType === MSG_AWARENESS) {
          awarenessProtocol.applyAwarenessUpdate(awareness, decoding.readVarUint8Array(decoder), ws);
        }
      });

      ws.on('close', () => {
        const ids = conns.get(ws);
        conns.delete(ws);
        if (ids?.size) {
          awarenessProtocol.removeAwarenessStates(awareness, [...ids], null);
        }
        if (conns.size === 0) {
          awareness.destroy();
          doc.destroy();
        }
      });
    });

    wss.on('listening', () => resolve(wss));
  });
}

let wss: WebSocketServer;

test.beforeAll(async () => {
  wss = await startIsolatedServer(TEST_WS_PORT);
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => {
    wss.clients.forEach((ws) => ws.close());
    wss.close(() => resolve());
  });
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

    await page.goto('http://localhost:5199');
    await page.waitForSelector('.status-dot.connected', { timeout: 10_000 });
    await page.waitForSelector('#editor .cm-editor', { timeout: 5_000 });
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
