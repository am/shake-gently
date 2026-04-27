import * as Y from 'yjs';
import type { WebsocketProvider } from 'y-websocket';

interface Snapshot {
  id: number;
  created_at: string;
  user_name: string | null;
  user_color: string | null;
  preview: string | null;
}

const POLL_INTERVAL = 30_000;

function httpBaseFromProvider(provider: WebsocketProvider): string {
  return provider.url.replace(/^ws(s?):\/\//, 'http$1://');
}

function formatTime(iso: string): string {
  const d = new Date(`${iso}Z`);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function setupHistory(
  container: HTMLElement,
  _doc: Y.Doc,
  provider: WebsocketProvider,
  editorContainer: HTMLElement,
): void {
  const httpBase = httpBaseFromProvider(provider);

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.className = 'timeline-slider';
  slider.min = '0';
  slider.max = '0';
  slider.value = '0';

  const meta = document.createElement('div');
  meta.className = 'timeline-meta';

  const label = document.createElement('span');
  label.className = 'timeline-label';
  label.textContent = 'history';

  const timeLabel = document.createElement('span');
  timeLabel.className = 'timeline-time';

  const liveIndicator = document.createElement('span');
  liveIndicator.className = 'timeline-live';
  liveIndicator.textContent = 'live';

  meta.appendChild(label);
  meta.appendChild(timeLabel);
  meta.appendChild(liveIndicator);

  container.appendChild(slider);
  container.appendChild(meta);

  let snapshots: Snapshot[] = [];
  let snapshotCache = new Map<number, string>();
  let isLive = true;

  function updateSlider(): void {
    const total = snapshots.length;
    slider.max = String(total);
    if (isLive) {
      slider.value = String(total);
    }
  }

  async function fetchSnapshots(): Promise<void> {
    try {
      const res = await fetch(`${httpBase}/history`);
      if (!res.ok) return;
      const data: Snapshot[] = await res.json();
      snapshots = data.reverse();
      updateSlider();
    } catch {
      // Network failures silently ignored — timeline stays stale.
    }
  }

  async function loadSnapshotText(snap: Snapshot): Promise<string | null> {
    const cached = snapshotCache.get(snap.id);
    if (cached !== undefined) return cached;

    try {
      const res = await fetch(`${httpBase}/history/${snap.id}`);
      if (!res.ok) return null;
      const buf = await res.arrayBuffer();

      const tempDoc = new Y.Doc();
      Y.applyUpdate(tempDoc, new Uint8Array(buf));
      const text = tempDoc.getText('codemirror').toString();
      tempDoc.destroy();

      snapshotCache.set(snap.id, text);
      return text;
    } catch {
      return null;
    }
  }

  function showPreview(text: string, snap: Snapshot): void {
    clearOverlay();

    const overlay = document.createElement('pre');
    overlay.className = 'history-overlay';
    overlay.textContent = text;
    editorContainer.appendChild(overlay);
    editorContainer.classList.add('history-preview');

    const userName = snap.user_name ?? 'unknown';
    timeLabel.textContent = `${userName} · ${formatTime(snap.created_at)}`;
    liveIndicator.classList.add('hidden');
    isLive = false;
  }

  function goLive(): void {
    clearOverlay();
    isLive = true;
    slider.value = slider.max;
    timeLabel.textContent = '';
    liveIndicator.classList.remove('hidden');
  }

  function clearOverlay(): void {
    editorContainer.querySelector('.history-overlay')?.remove();
    editorContainer.classList.remove('history-preview');
  }

  slider.addEventListener('input', async () => {
    const idx = Number(slider.value);
    if (idx >= snapshots.length) {
      goLive();
      return;
    }
    const snap = snapshots[idx];
    const text = await loadSnapshotText(snap);
    if (text !== null) {
      showPreview(text, snap);
    }
  });

  fetchSnapshots();
  provider.on('sync', () => fetchSnapshots());
  setInterval(fetchSnapshots, POLL_INTERVAL);
}
