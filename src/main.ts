import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { createEditor } from './editor';
import { createUserIdentity } from './awareness';
import './style.css';

const doc = new Y.Doc();
const ytext = doc.getText('codemirror');

const provider = new WebsocketProvider(
  'ws://localhost:1234',
  'multinput-room',
  doc,
);

const user = createUserIdentity();
provider.awareness.setLocalStateField('user', user);

const statusDot = document.getElementById('status-dot')!;
const statusText = document.getElementById('status-text')!;

function updateStatus(connected: boolean) {
  statusDot.className = `status-dot ${connected ? 'connected' : 'disconnected'}`;
  statusText.textContent = connected ? 'Connected' : 'Connecting...';
}

provider.on('status', ({ status }: { status: string }) => {
  updateStatus(status === 'connected');
});

const editorContainer = document.getElementById('editor')!;
createEditor(editorContainer, ytext, provider.awareness);

const userLabel = document.getElementById('user-label')!;
userLabel.textContent = user.name;
userLabel.style.setProperty('--user-color', user.color);
