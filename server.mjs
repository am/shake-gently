import { WebSocketServer } from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

const MSG_SYNC = 0;
const MSG_AWARENESS = 1;

const PORT = Number(process.env.PORT) || 1234;

/**
 * @typedef {{ doc: Y.Doc, awareness: awarenessProtocol.Awareness, conns: Map<import('ws').WebSocket, Set<number>> }} Room
 * @type {Map<string, Room>}
 */
const rooms = new Map();

function getRoom(name) {
  let room = rooms.get(name);
  if (room) return room;

  const doc = new Y.Doc();
  const awareness = new awarenessProtocol.Awareness(doc);
  awareness.setLocalState(null);

  room = { doc, awareness, conns: new Map() };

  awareness.on('update', (/** @type {{ added: number[], updated: number[], removed: number[] }} */ changes, origin) => {
    const changedClients = changes.added.concat(changes.updated).concat(changes.removed);
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_AWARENESS);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients),
    );
    const buf = encoding.toUint8Array(encoder);

    room.conns.forEach((_, ws) => {
      if (ws !== origin && ws.readyState === 1) {
        ws.send(buf);
      }
    });

    // Track which clientIDs belong to which connection
    if (origin instanceof Object && room.conns.has(origin)) {
      const ids = room.conns.get(origin);
      for (const id of changes.added) ids.add(id);
      for (const id of changes.updated) ids.add(id);
    }
  });

  rooms.set(name, room);
  return room;
}

const wss = new WebSocketServer({ port: PORT });

wss.on('connection', (ws, req) => {
  const roomName = new URL(req.url, 'http://localhost').pathname.slice(1) || 'default';
  const room = getRoom(roomName);
  room.conns.set(ws, new Set());

  // Send sync step 1
  {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_SYNC);
    syncProtocol.writeSyncStep1(encoder, room.doc);
    ws.send(encoding.toUint8Array(encoder));
  }

  // Send current awareness states
  {
    const states = room.awareness.getStates();
    if (states.size > 0) {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MSG_AWARENESS);
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(room.awareness, Array.from(states.keys())),
      );
      ws.send(encoding.toUint8Array(encoder));
    }
  }

  ws.on('message', (data) => {
    const buf = new Uint8Array(data);
    const decoder = decoding.createDecoder(buf);
    const msgType = decoding.readVarUint(decoder);

    switch (msgType) {
      case MSG_SYNC: {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MSG_SYNC);
        syncProtocol.readSyncMessage(decoder, encoder, room.doc, null);
        const reply = encoding.toUint8Array(encoder);
        if (encoding.length(encoder) > 1) {
          ws.send(reply);
        }
        room.conns.forEach((_, peer) => {
          if (peer !== ws && peer.readyState === 1) peer.send(buf);
        });
        break;
      }
      case MSG_AWARENESS: {
        const update = decoding.readVarUint8Array(decoder);
        awarenessProtocol.applyAwarenessUpdate(room.awareness, update, ws);
        break;
      }
    }
  });

  ws.on('close', () => {
    const clientIds = room.conns.get(ws);
    room.conns.delete(ws);

    if (clientIds && clientIds.size > 0) {
      awarenessProtocol.removeAwarenessStates(
        room.awareness,
        Array.from(clientIds),
        null,
      );
    }

    if (room.conns.size === 0) {
      room.awareness.destroy();
      room.doc.destroy();
      rooms.delete(roomName);
    }
  });
});

console.log(`y-websocket server running on ws://localhost:${PORT}`);
