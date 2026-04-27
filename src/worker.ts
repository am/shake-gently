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

  private saveTimeout: ReturnType<typeof setTimeout> | null = null;
  private periodicInterval: ReturnType<typeof setInterval> | null = null;
  private lastSavedStateVector: Uint8Array | null = null;
  private dirty = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS doc_state (
        id     INTEGER PRIMARY KEY DEFAULT 1,
        data   BLOB NOT NULL
      );
      CREATE TABLE IF NOT EXISTS snapshots (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT    NOT NULL DEFAULT (datetime('now')),
        user_name  TEXT,
        user_color TEXT,
        preview    TEXT,
        data       BLOB   NOT NULL
      );
    `);

    const rows = this.ctx.storage.sql.exec("SELECT data FROM doc_state WHERE id = 1").toArray();
    if (rows.length > 0) {
      Y.applyUpdate(this.doc, new Uint8Array(rows[0].data as ArrayBuffer));
      this.lastSavedStateVector = Y.encodeStateVector(this.doc);
    }

    this.awareness.setLocalState(null);
    this.awareness.on('update', (changes: AwarenessChanges, origin: unknown) => {
      this.broadcastAwareness(changes, origin);
    });
  }

  fetch(request: Request): Response {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (request.headers.get('Upgrade') !== 'websocket') {
      const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
      };

      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders });
      }

      if (pathname.endsWith('/history')) {
        const before = url.searchParams.get('before');
        const rows = this.ctx.storage.sql
          .exec(
            "SELECT id, created_at, user_name, user_color, preview FROM snapshots WHERE (?1 IS NULL OR id < ?1) ORDER BY id DESC LIMIT 50",
            before ? Number(before) : null,
          )
          .toArray();
        return new Response(JSON.stringify(rows), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      const snapshotMatch = pathname.match(/\/history\/(\d+)$/);
      if (snapshotMatch) {
        const row = this.ctx.storage.sql
          .exec("SELECT data FROM snapshots WHERE id = ?", Number(snapshotMatch[1]))
          .one();
        if (!row) {
          return new Response('Not found', { status: 404 });
        }
        return new Response(row.data as ArrayBuffer, {
          headers: { 'Content-Type': 'application/octet-stream', ...corsHeaders },
        });
      }

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
        this.scheduleSave();
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

    if (this.ctx.getWebSockets().length === 0) {
      this.stopTimers();
      this.save();
    }
  }

  private save() {
    const update = Y.encodeStateAsUpdate(this.doc);
    const currentVector = Y.encodeStateVector(this.doc);

    if (
      this.lastSavedStateVector &&
      currentVector.length === this.lastSavedStateVector.length &&
      currentVector.every((v, i) => v === this.lastSavedStateVector![i])
    ) {
      this.dirty = false;
      return;
    }

    const preview = this.doc.getText('codemirror').toString().slice(0, 100);

    let userName: string | null = null;
    let userColor: string | null = null;
    for (const state of this.awareness.getStates().values()) {
      if (state.user) {
        userName = state.user.name ?? null;
        userColor = state.user.color ?? null;
        break;
      }
    }

    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO doc_state (id, data) VALUES (1, ?)",
      update,
    );
    this.ctx.storage.sql.exec(
      "INSERT INTO snapshots (user_name, user_color, preview, data) VALUES (?, ?, ?, ?)",
      userName,
      userColor,
      preview,
      update,
    );

    this.lastSavedStateVector = currentVector;
    this.dirty = false;
  }

  private scheduleSave() {
    this.dirty = true;

    if (this.saveTimeout !== null) {
      clearTimeout(this.saveTimeout);
    }
    this.saveTimeout = setTimeout(() => {
      this.saveTimeout = null;
      this.save();
    }, 5000);

    if (this.periodicInterval === null) {
      this.periodicInterval = setInterval(() => {
        if (this.dirty) this.save();
      }, 60_000);
    }
  }

  private stopTimers() {
    if (this.saveTimeout !== null) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    if (this.periodicInterval !== null) {
      clearInterval(this.periodicInterval);
      this.periodicInterval = null;
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
    const pathname = url.pathname;

    const isWebSocket = request.headers.get('Upgrade') === 'websocket';
    const isHistory = /\/history(\/\d+)?$/.test(pathname);

    if (!isWebSocket && !isHistory) {
      return env.ASSETS.fetch(request);
    }

    const roomPath = isHistory
      ? pathname.replace(/\/history(\/\d+)?$/, '') || '/'
      : pathname;
    const roomName = roomNameFromPath(roomPath);
    const room = env.ROOMS.getByName(roomName);
    return room.fetch(request);
  },
};
