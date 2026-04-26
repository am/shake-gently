import { WebSocketServer } from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

const MSG_SYNC = 0;
const MSG_AWARENESS = 1;

export function startIsolatedServer(port: number): Promise<WebSocketServer> {
  return new Promise((resolve, reject) => {
    let doc = new Y.Doc();
    let awareness = new awarenessProtocol.Awareness(doc);
    awareness.setLocalState(null);

    const conns = new Map<import('ws').WebSocket, Set<number>>();

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

    const wss = new WebSocketServer({ port });

    wss.on('error', reject);

    wss.on('connection', (ws) => {
      // Recreate doc/awareness if they were destroyed after all previous connections closed
      if (doc.isDestroyed) {
        doc = new Y.Doc();
        awareness = new awarenessProtocol.Awareness(doc);
        awareness.setLocalState(null);
        setupAwareness();
      }

      conns.set(ws, new Set());

      // Send sync step 1
      {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MSG_SYNC);
        syncProtocol.writeSyncStep1(encoder, doc);
        ws.send(encoding.toUint8Array(encoder));
      }

      // Send current awareness states to the new connection
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

export async function stopServer(wss: WebSocketServer): Promise<void> {
  await new Promise<void>((resolve) => {
    wss.clients.forEach((ws) => { ws.close(); });
    wss.close(() => resolve());
  });
}
