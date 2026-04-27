import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocketServer } from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

const MSG_SYNC = 0;
const MSG_AWARENESS = 1;

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

export interface TestServer {
  wss: WebSocketServer;
  close(): Promise<void>;
}

interface MemorySnapshot {
  id: number;
  created_at: string;
  user_name: string | null;
  user_color: string | null;
  preview: string | null;
  data: Uint8Array;
}

export function startIsolatedServer(port: number): Promise<TestServer> {
  return new Promise((resolve, reject) => {
    let doc = new Y.Doc();
    let awareness = new awarenessProtocol.Awareness(doc);
    awareness.setLocalState(null);
    let savedDocState: Uint8Array | null = null;

    const conns = new Map<import('ws').WebSocket, Set<number>>();

    const snapshots: MemorySnapshot[] = [];
    let nextSnapshotId = 1;
    let lastSnapshotText = '';

    function maybeSaveSnapshot() {
      const text = doc.getText('codemirror').toString();
      if (text === lastSnapshotText || text === '') return;

      let user_name: string | null = null;
      let user_color: string | null = null;
      for (const state of awareness.getStates().values()) {
        if (state?.user) {
          user_name = state.user.name ?? null;
          user_color = state.user.color ?? null;
          break;
        }
      }

      snapshots.push({
        id: nextSnapshotId++,
        created_at: new Date().toISOString().slice(0, -1),
        user_name,
        user_color,
        preview: text.slice(0, 200) || null,
        data: Y.encodeStateAsUpdate(doc),
      });

      lastSnapshotText = text;
    }

    function setupAwareness() {
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
    }

    setupAwareness();

    function handleHttp(req: IncomingMessage, res: ServerResponse) {
      const url = req.url ?? '/';

      if (req.method === 'OPTIONS') {
        res.writeHead(204, CORS_HEADERS);
        res.end();
        return;
      }

      const historyItemMatch = url.match(/\/history\/(\d+)$/);
      if (req.method === 'GET' && historyItemMatch) {
        const id = parseInt(historyItemMatch[1], 10);
        const snap = snapshots.find((s) => s.id === id);
        if (!snap) {
          res.writeHead(404, CORS_HEADERS);
          res.end();
          return;
        }
        res.writeHead(200, { ...CORS_HEADERS, 'Content-Type': 'application/octet-stream' });
        res.end(Buffer.from(snap.data));
        return;
      }

      if (req.method === 'GET' && /\/history$/.test(url)) {
        const metadata = snapshots
          .map(({ data: _, ...rest }) => rest)
          .sort((a, b) => b.id - a.id);
        res.writeHead(200, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
        res.end(JSON.stringify(metadata));
        return;
      }

      res.writeHead(426, CORS_HEADERS);
      res.end();
    }

    const httpServer = createServer(handleHttp);
    const wss = new WebSocketServer({ server: httpServer });

    httpServer.on('error', reject);
    wss.on('error', reject);

    wss.on('connection', (ws) => {
      if (doc.isDestroyed) {
        doc = new Y.Doc();
        awareness = new awarenessProtocol.Awareness(doc);
        awareness.setLocalState(null);
        if (savedDocState) Y.applyUpdate(doc, savedDocState);
        lastSnapshotText = doc.getText('codemirror').toString();
        setupAwareness();
      }

      conns.set(ws, new Set());

      {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MSG_SYNC);
        syncProtocol.writeSyncStep1(encoder, doc);
        ws.send(encoding.toUint8Array(encoder));
      }

      {
        const states = awareness.getStates();
        if (states.size > 0) {
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, MSG_AWARENESS);
          encoding.writeVarUint8Array(
            encoder,
            awarenessProtocol.encodeAwarenessUpdate(awareness, Array.from(states.keys())),
          );
          ws.send(encoding.toUint8Array(encoder));
        }
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
          maybeSaveSnapshot();
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
        maybeSaveSnapshot();
        if (conns.size === 0) {
          savedDocState = Y.encodeStateAsUpdate(doc);
          awareness.destroy();
          doc.destroy();
        }
      });
    });

    httpServer.listen(port, () => {
      resolve({
        wss,
        close: () => new Promise<void>((res) => {
          wss.clients.forEach((ws) => { ws.close(); });
          wss.close(() => httpServer.close(() => res()));
        }),
      });
    });
  });
}
