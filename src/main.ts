import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { createEditor } from './editor';
import { createUserIdentity, setupCollisionGuard, type UserIdentity } from './awareness';
import { setupColorWriter, recolorOwnText } from './colors';
import { setupHistory } from './history';
import './style.css';

declare global {
  interface Window {
    __yProvider?: WebsocketProvider;
  }
}

const doc = new Y.Doc();
const ytext = doc.getText('codemirror');

function resolveWsUrl(): string {
  if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL;
  if (import.meta.env.DEV) return 'ws://localhost:8787';

  const { protocol, host } = window.location;
  return `${protocol === 'https:' ? 'wss:' : 'ws:'}//${host}`;
}

const wsUrl = resolveWsUrl();

const provider = new WebsocketProvider(
  wsUrl,
  'shake-gently-room',
  doc,
  { disableBc: true },
);

const statusDot = document.getElementById('status-dot')!;
const statusText = document.getElementById('status-text')!;
const editorContainer = document.getElementById('editor')!;
const userLabel = document.getElementById('user-label')!;
const presenceEl = document.getElementById('presence')!;

let user = createUserIdentity(provider.awareness);
provider.awareness.setLocalStateField('user', user);

function applyIdentity(identity: UserIdentity) {
  user = identity;
  editorContainer.style.setProperty('--cursor-color', user.color);
  userLabel.textContent = user.name;
  userLabel.style.setProperty('--user-color', user.color);
}

applyIdentity(user);

function updateStatus(connected: boolean) {
  statusDot.className = `status-dot ${connected ? 'connected' : 'disconnected'}`;
  statusText.textContent = connected ? 'live' : 'connecting...';
}

provider.on('status', ({ status }: { status: string }) => {
  updateStatus(status === 'connected');
  if (status === 'connected') {
    // Re-announce identity so the server accepts it (awareness clock must advance
    // past the stale value the server kept from the previous connection).
    provider.awareness.setLocalStateField('user', user);
  } else {
    // Drop cached clocks for remote clients so that when we reconnect and the
    // server sends its awareness snapshot, applyAwarenessUpdate sees currClock=0
    // and accepts the update instead of ignoring it as a duplicate clock.
    const localId = doc.clientID;
    for (const clientId of provider.awareness.meta.keys()) {
      if (clientId !== localId) {
        provider.awareness.meta.delete(clientId);
      }
    }
  }
});

createEditor(editorContainer, ytext, provider.awareness);
setupColorWriter(ytext, () => user.color, doc.clientID);

setupCollisionGuard(provider.awareness, (newIdentity) => {
  recolorOwnText(ytext, doc.clientID, newIdentity.color);
  applyIdentity(newIdentity);
});

function renderPresence() {
  const states = provider.awareness.getStates();
  presenceEl.innerHTML = '';
  states.forEach((state) => {
    const u = state.user;
    if (!u) return;
    const el = document.createElement('div');
    el.className = 'presence-user';
    const dot = document.createElement('span');
    dot.className = 'presence-dot';
    dot.style.background = u.color;
    const name = document.createElement('span');
    name.textContent = u.name;
    name.style.color = u.color;
    el.appendChild(dot);
    el.appendChild(name);
    presenceEl.appendChild(el);
  });
}

provider.awareness.on('change', renderPresence);
renderPresence();

const timelineEl = document.getElementById('timeline')!;
setupHistory(timelineEl, doc, provider, document.getElementById('editor-wrap')!);

window.__yProvider = provider;
