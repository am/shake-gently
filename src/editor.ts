import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { yCollab } from 'y-codemirror.next';
import { colorDecorations } from './colors';
import type { Text as YText } from 'yjs';
import type { Awareness } from 'y-protocols/awareness';

const neonTheme = EditorView.theme({
  '&': {
    height: '100%',
    background: 'transparent',
  },
  '.cm-scroller': {
    overflow: 'auto',
  },
  '.cm-content': {
    padding: '8px 0',
  },
  '.cm-gutters': {
    display: 'none',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeft: '2px solid #fff',
  },
  '.cm-ySelectionCaretDot': {
    display: 'none',
  },
});

export function createEditor(
  parent: HTMLElement,
  ytext: YText,
  awareness: Awareness,
) {
  const state = EditorState.create({
    doc: ytext.toString(),
    extensions: [
      basicSetup,
      neonTheme,
      yCollab(ytext, awareness),
      colorDecorations(),
    ],
  });

  return new EditorView({ state, parent });
}
