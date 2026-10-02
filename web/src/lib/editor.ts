// The code editor, on CodeMirror. Loaded on first use, as its own chunk. Code is coloured by the
// map's own tokenizer (highlight.ts), so the editor and the cards look the same; only visible lines are
// decorated, so typing stays fast in long files.
import { Compartment, EditorState, RangeSetBuilder, StateEffect, StateField } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { hl, type TokenClass } from './highlight';

const marks: Record<TokenClass, Decoration> = {
  k: Decoration.mark({ class: 'tk-k' }),
  s: Decoration.mark({ class: 'tk-s' }),
  c: Decoration.mark({ class: 'tk-c' }),
  n: Decoration.mark({ class: 'tk-n' }),
};

function decorate(view: EditorView): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges)
    for (let pos = from; pos <= to;) {
      const line = view.state.doc.lineAt(pos);
      let at = line.from;
      for (const t of hl(line.text)) {
        if (t.c) b.add(at, at + t.t.length, marks[t.c]);
        at += t.t.length;
      }
      pos = line.to + 1;
    }
  return b.finish();
}

const highlighter = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = decorate(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged) this.decorations = decorate(u.view);
    }
  },
  { decorations: v => v.decorations },
);

/**
 * An agent's change to this file, shown inline: its added lines, by line number in the text, and its
 * removed lines, by the line number they were removed before (one past the last line for the end).
 */
export interface InlineDiff {
  added: number[];
  removed: Map<number, string[]>;
}

class Removed extends WidgetType {
  constructor(readonly lines: string[]) {
    super();
  }
  override eq(o: Removed) {
    return o.lines.join('\n') === this.lines.join('\n');
  }
  toDOM() {
    const el = document.createElement('div');
    el.className = 'cm-removed';
    el.setAttribute('aria-label', `${this.lines.length} removed`);
    for (const l of this.lines) el.appendChild(document.createElement('div')).textContent = l || ' ';
    return el;
  }
}

const setDiff = StateEffect.define<InlineDiff | null>();
const diffField = StateField.define({
  create: () => Decoration.none,
  update(deco, tr) {
    // An edit of their own replaces the agent's change on screen; the run stays to keep or revert.
    if (tr.docChanged) deco = Decoration.none;
    for (const e of tr.effects)
      if (e.is(setDiff)) {
        const doc = tr.state.doc,
          b = new RangeSetBuilder<Decoration>(),
          d = e.value;
        if (d)
          for (let n = 1; n <= doc.lines + 1; n++) {
            const rm = d.removed.get(n);
            const at = n <= doc.lines ? doc.line(n).from : doc.length;
            if (rm) b.add(at, at, Decoration.widget({ widget: new Removed(rm), block: true, side: -1 }));
            if (n <= doc.lines && d.added.includes(n)) b.add(at, at, Decoration.line({ class: 'cm-added' }));
          }
        deco = b.finish();
      }
    return deco;
  },
  provide: f => EditorView.decorations.from(f),
});

export interface EditorHooks {
  onChange(text: string): void;
  /** The selected lines (1-based, inclusive), or null when nothing is selected. */
  onSelect(lines: [number, number] | null): void;
  onSave(): void;
  onClose(): void;
  /** ⌘K with lines selected: write an instruction for them. */
  onInstruct(): void;
}

export interface Editor {
  view: EditorView;
  setReadOnly(readOnly: boolean): void;
  /** Replaces the whole text, as when the file changed on disk; the undo history starts again. */
  reset(text: string): void;
  /** Shows an agent's change inline, or clears it. */
  showDiff(diff: InlineDiff | null): void;
}

export function createEditor(parent: HTMLElement, text: string, readOnly: boolean, hooks: EditorHooks): Editor {
  const lock = new Compartment();
  // Read-only keeps the code focusable, so it can still be read, scrolled and selected by keyboard.
  const locked = (ro: boolean) => [
    EditorState.readOnly.of(ro),
    EditorView.contentAttributes.of({ 'aria-readonly': String(ro) }),
  ];
  const extensions = [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightActiveLine(),
    drawSelection(),
    history(),
    highlighter,
    diffField,
    lock.of(locked(readOnly)),
    keymap.of([
      { key: 'Mod-s', preventDefault: true, run: () => (hooks.onSave(), true) },
      { key: 'Escape', run: () => (hooks.onClose(), true) },
      { key: 'Mod-k', run: v => !v.state.selection.main.empty && (hooks.onInstruct(), true) },
      ...defaultKeymap,
      ...historyKeymap,
      indentWithTab,
    ]),
    EditorView.updateListener.of(u => {
      if (u.docChanged) hooks.onChange(u.state.doc.toString());
      if (u.docChanged || u.selectionSet) {
        const r = u.state.selection.main;
        hooks.onSelect(
          r.empty
            ? null
            : [u.state.doc.lineAt(r.from).number, u.state.doc.lineAt(r.to - (r.to > r.from ? 1 : 0)).number],
        );
      }
    }),
  ];
  const view = new EditorView({ parent, state: EditorState.create({ doc: text, extensions }) });
  return {
    view,
    setReadOnly: ro => view.dispatch({ effects: lock.reconfigure(locked(ro)) }),
    reset: next => view.setState(EditorState.create({ doc: next, extensions })),
    // The change is brought into view, so it is seen without scrolling for it.
    showDiff: diff => {
      const first = diff && Math.min(...diff.added, ...diff.removed.keys());
      const doc = view.state.doc;
      view.dispatch({
        effects: [
          setDiff.of(diff),
          ...(first && Number.isFinite(first)
            ? [EditorView.scrollIntoView(doc.line(Math.min(first, doc.lines)).from, { y: 'center' })]
            : []),
        ],
      });
    },
  };
}
