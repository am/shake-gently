import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { createEditor } from './editor';
import { createUserIdentity, setupCollisionGuard } from './awareness';
import { setupColorWriter, recolorOwnText } from './colors';
import './style.css';

const doc = new Y.Doc();
const ytext = doc.getText('codemirror');

const wsUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:1234';

const provider = new WebsocketProvider(
  wsUrl,
  'multinput-room',
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

function applyIdentity(identity: typeof user) {
  user = identity;
  editorContainer.style.setProperty('--cursor-color', user.color);
  editorContainer.style.setProperty('--cursor-glow', user.colorLight);
  userLabel.textContent = user.name;
  userLabel.style.setProperty('--user-color', user.color);
  userLabel.style.setProperty('--user-glow', user.colorLight);
}

applyIdentity(user);

function updateStatus(connected: boolean) {
  statusDot.className = `status-dot ${connected ? 'connected' : 'disconnected'}`;
  statusText.textContent = connected ? 'live' : 'connecting...';
}

provider.on('status', ({ status }: { status: string }) => {
  updateStatus(status === 'connected');
});

const view = createEditor(editorContainer, ytext, provider.awareness);
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
    dot.style.boxShadow = `0 0 6px ${u.colorLight}`;
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
