import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { yCollab } from 'y-codemirror.next';
import type { Text as YText } from 'yjs';
import type { Awareness } from 'y-protocols/awareness';

export function createEditor(
  parent: HTMLElement,
  ytext: YText,
  awareness: Awareness,
) {
  const state = EditorState.create({
    doc: ytext.toString(),
    extensions: [
      keymap.of([]),
      basicSetup,
      EditorView.theme({
        '&': {
          height: '100%',
          fontSize: '16px',
        },
        '.cm-editor': { height: '100%' },
        '.cm-scroller': {
          overflow: 'auto',
          fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
        },
        '.cm-content': {
          caretColor: '#528bff',
          padding: '12px 0',
        },
        '.cm-gutters': {
          display: 'none',
        },
        '.cm-ySelectionInfo': {
          padding: '2px 6px',
          borderRadius: '4px',
          fontSize: '12px',
          fontFamily: 'system-ui, sans-serif',
          fontWeight: '600',
          opacity: '1',
          transitionProperty: 'opacity',
          transitionDuration: '200ms',
        },
      }),
      yCollab(ytext, awareness),
    ],
  });

  return new EditorView({ state, parent });
}
