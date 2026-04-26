import {
  ViewPlugin,
  Decoration,
  type DecorationSet,
  type EditorView,
  type ViewUpdate,
} from '@codemirror/view';
import { RangeSetBuilder, type Extension } from '@codemirror/state';
import { ySyncFacet } from 'y-codemirror.next';
import type { Text as YText } from 'yjs';

const COLOR_ORIGIN = 'color-format';

function glowFor(hex: string): string {
  return `0 0 8px ${hex}80, 0 0 20px ${hex}30`;
}

function buildDecorations(ytext: YText): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const delta = ytext.toDelta();
  let pos = 0;
  for (const op of delta) {
    if (typeof op.insert === 'string') {
      const len = op.insert.length;
      const color = op.attributes?.color as string | undefined;
      if (color && len > 0) {
        builder.add(
          pos,
          pos + len,
          Decoration.mark({
            attributes: {
              style: `color: ${color}; text-shadow: ${glowFor(color)};`,
            },
          }),
        );
      }
      pos += len;
    }
  }
  return builder.finish();
}

class ColorDecorationsPlugin {
  decorations: DecorationSet;
  private ytext: YText;
  private observer: () => void;
  private view: EditorView;
  private pending = false;

  constructor(view: EditorView) {
    this.view = view;
    this.ytext = view.state.facet(ySyncFacet).ytext;
    this.decorations = buildDecorations(this.ytext);
    this.observer = () => {
      if (!this.pending) {
        this.pending = true;
        requestAnimationFrame(() => {
          this.pending = false;
          this.decorations = buildDecorations(this.ytext);
          this.view.dispatch({});
        });
      }
    };
    this.ytext.observe(this.observer);
  }

  update(_update: ViewUpdate) {
    this.decorations = buildDecorations(this.ytext);
  }

  destroy() {
    this.ytext.unobserve(this.observer);
  }
}

export function colorDecorations(): Extension {
  return ViewPlugin.fromClass(ColorDecorationsPlugin, {
    decorations: (v) => v.decorations,
  });
}

export function setupColorWriter(ytext: YText, getColor: () => string, clientID: number) {
  ytext.observe((event, transaction) => {
    if (!transaction.local) return;
    if (transaction.origin === COLOR_ORIGIN) return;

    const ranges: { pos: number; len: number }[] = [];
    let pos = 0;
    for (const op of event.delta) {
      if (op.retain != null) {
        pos += op.retain;
      } else if (op.delete != null) {
        // deleted text doesn't move pos
      } else if (op.insert != null && typeof op.insert === 'string') {
        ranges.push({ pos, len: op.insert.length });
        pos += op.insert.length;
      }
    }

    if (ranges.length > 0) {
      const color = getColor();
      setTimeout(() => {
        ytext.doc!.transact(() => {
          for (const r of ranges) {
            ytext.format(r.pos, r.len, { color, author: clientID });
          }
        }, COLOR_ORIGIN);
      }, 0);
    }
  });
}

export function recolorOwnText(ytext: YText, clientID: number, newColor: string) {
  const delta = ytext.toDelta();
  const ranges: { pos: number; len: number }[] = [];
  let pos = 0;
  for (const op of delta) {
    if (typeof op.insert === 'string') {
      if (op.attributes?.author === clientID) {
        ranges.push({ pos, len: op.insert.length });
      }
      pos += op.insert.length;
    }
  }
  if (ranges.length > 0) {
    ytext.doc!.transact(() => {
      for (const r of ranges) {
        ytext.format(r.pos, r.len, { color: newColor });
      }
    }, COLOR_ORIGIN);
  }
}
