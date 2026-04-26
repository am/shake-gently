import { WebSocketServer } from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

const MSG_SYNC = 0;
const MSG_AWARENESS = 1;

const PORT = Number(process.env.PORT) || 1234;

/** @type {Map<string, { doc: Y.Doc, awareness: awarenessProtocol.Awareness, conns: Set<import('ws').WebSocket> }>} */
const rooms = new Map();

function getRoom(name) {
  let room = rooms.get(name);
  if (room) return room;

  const doc = new Y.Doc();
  const awareness = new awarenessProtocol.Awareness(doc);
  awareness.setLocalState(null);
  room = { doc, awareness, conns: new Set() };
  rooms.set(name, room);
  return room;
}

function broadcastBuf(room, buf, exclude) {
  for (const ws of room.conns) {
    if (ws !== exclude && ws.readyState === 1) {
      ws.send(buf);
    }
  }
}

const wss = new WebSocketServer({ port: PORT });

wss.on('connection', (ws, req) => {
  const roomName = new URL(req.url, 'http://localhost').pathname.slice(1) || 'default';
  const room = getRoom(roomName);
  room.conns.add(ws);

  // Send sync step 1
  {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_SYNC);
    syncProtocol.writeSyncStep1(encoder, room.doc);
    ws.send(encoding.toUint8Array(encoder));
  }

  // Send current awareness states
  {
    const states = awarenessProtocol.encodeAwarenessUpdate(
      room.awareness,
      Array.from(room.awareness.getStates().keys()),
    );
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_AWARENESS);
    encoding.writeVarUint8Array(encoder, states);
    ws.send(encoding.toUint8Array(encoder));
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
        // Broadcast the original message to other clients
        broadcastBuf(room, buf, ws);
        break;
      }
      case MSG_AWARENESS: {
        const update = decoding.readVarUint8Array(decoder);
        awarenessProtocol.applyAwarenessUpdate(room.awareness, update, ws);
        broadcastBuf(room, buf, ws);
        break;
      }
    }
  });

  ws.on('close', () => {
    room.conns.delete(ws);
    if (room.conns.size === 0) {
      room.awareness.destroy();
      room.doc.destroy();
      rooms.delete(roomName);
    }
  });
});

console.log(`y-websocket server running on ws://localhost:${PORT}`);
