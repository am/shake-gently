import { DurableObject } from 'cloudflare:workers';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

const MSG_SYNC = 0;
const MSG_AWARENESS = 1;

interface Env {
  ASSETS: Fetcher;
  ROOMS: DurableObjectNamespace<RoomDurableObject>;
}

type AwarenessChanges = {
  added: number[];
  updated: number[];
  removed: number[];
};

export class RoomDurableObject extends DurableObject<Env> {
  private readonly doc = new Y.Doc();
  private readonly awareness = new awarenessProtocol.Awareness(this.doc);
  private readonly clientIds = new Map<WebSocket, Set<number>>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.awareness.setLocalState(null);
    this.awareness.on('update', (changes: AwarenessChanges, origin: unknown) => {
      this.broadcastAwareness(changes, origin);
    });
  }

  fetch(request: Request): Response {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    this.clientIds.set(server, new Set());

    this.sendSyncStep1(server);
    this.sendAwarenessSnapshot(server);

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(socket: WebSocket, data: string | ArrayBuffer) {
    if (typeof data === 'string') return;

    const message = new Uint8Array(data);
    const decoder = decoding.createDecoder(message);
    const msgType = decoding.readVarUint(decoder);

    switch (msgType) {
      case MSG_SYNC: {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MSG_SYNC);
        syncProtocol.readSyncMessage(decoder, encoder, this.doc, null);
        if (encoding.length(encoder) > 1) {
          socket.send(encoding.toUint8Array(encoder));
        }
        this.broadcast(message, socket);
        break;
      }
      case MSG_AWARENESS: {
        const update = decoding.readVarUint8Array(decoder);
        awarenessProtocol.applyAwarenessUpdate(this.awareness, update, socket);
        break;
      }
    }
  }

  webSocketClose(socket: WebSocket) {
    this.removePeer(socket);
  }

  webSocketError(socket: WebSocket) {
    this.removePeer(socket);
  }

  private sendSyncStep1(socket: WebSocket) {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_SYNC);
    syncProtocol.writeSyncStep1(encoder, this.doc);
    socket.send(encoding.toUint8Array(encoder));
  }

  private sendAwarenessSnapshot(socket: WebSocket) {
    const states = this.awareness.getStates();
    if (states.size === 0) return;

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_AWARENESS);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(this.awareness, Array.from(states.keys())),
    );
    socket.send(encoding.toUint8Array(encoder));
  }

  private broadcast(message: Uint8Array, except: WebSocket) {
    for (const ws of this.ctx.getWebSockets()) {
      if (ws !== except) {
        ws.send(message);
      }
    }
  }

  private broadcastAwareness(
    changes: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) {
    const changedClients = changes.added.concat(changes.updated).concat(changes.removed);
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_AWARENESS);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(this.awareness, changedClients),
    );
    const message = encoding.toUint8Array(encoder);

    for (const ws of this.ctx.getWebSockets()) {
      if (ws !== origin) {
        ws.send(message);
      }
    }

    if (origin instanceof WebSocket) {
      const ids = this.clientIds.get(origin);
      if (ids) {
        for (const id of changes.added) ids.add(id);
        for (const id of changes.updated) ids.add(id);
      }
    }
  }

  private removePeer(socket: WebSocket) {
    const ids = this.clientIds.get(socket);
    this.clientIds.delete(socket);

    if (ids && ids.size > 0) {
      awarenessProtocol.removeAwarenessStates(
        this.awareness,
        Array.from(ids),
        null,
      );
    }
  }
}

function roomNameFromPath(pathname: string): string {
  const roomName = decodeURIComponent(pathname.replace(/^\/+/, ''));
  return roomName || 'default';
}

export default {
  fetch(request: Request, env: Env): Response | Promise<Response> {
    const url = new URL(request.url);
    const roomName = roomNameFromPath(url.pathname);

    if (request.headers.get('Upgrade') !== 'websocket') {
      return env.ASSETS.fetch(request);
    }

    const room = env.ROOMS.getByName(roomName);
    return room.fetch(request);
  },
};
