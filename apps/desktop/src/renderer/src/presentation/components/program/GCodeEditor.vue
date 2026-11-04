<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { syntaxHighlighting } from '@codemirror/language';
import { lintGutter, setDiagnostics, type Diagnostic as EditorDiagnostic } from '@codemirror/lint';
import { Compartment, EditorSelection, EditorState, StateEffect, StateField, type Range } from '@codemirror/state';
import { Decoration, EditorView, keymap, lineNumbers, type DecorationSet } from '@codemirror/view';
import { DiagnosticSeverity, type Diagnostic } from '@rezets/core';
import { describeDiagnostic } from '@/presentation/messages';
import { gcodeHighlightStyle, gcodeLanguage } from './gcodeLanguage';

const props = defineProps<{
  modelValue: string;
  diagnostics: readonly Diagnostic[];
  /** Line the machine is executing, highlighted and kept in view; `null` when no program runs. */
  executingLine: number | null;
  isReadOnly: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [text: string];
  /** The line under the caret changed. */
  caretLineChange: [line: number];
}>();

const containerElement = ref<HTMLElement | null>(null);
let editorView: EditorView | null = null;
const readOnlyCompartment = new Compartment();

const setExecutingLineEffect = StateEffect.define<number | null>();
const executingLineDecoration = Decoration.line({ class: 'cm-executing-line' });

/** Keeps the highlight of the executing line attached to the document. */
const executingLineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, transaction) {
    let updated = decorations.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(setExecutingLineEffect)) {
        const line = effect.value;
        const ranges: Range<Decoration>[] =
          line !== null && line >= 1 && line <= transaction.state.doc.lines
            ? [executingLineDecoration.range(transaction.state.doc.line(line).from)]
            : [];
        updated = Decoration.set(ranges);
      }
    }
    return updated;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const editorTheme = EditorView.theme({
  '&': { height: '100%', fontSize: '13px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.6', overflow: 'auto' },
  '.cm-content': { userSelect: 'text' },
  '.cm-gutters': { background: 'transparent', border: 'none', color: 'var(--color-text-tertiary)' },
  '.cm-activeLine': { background: 'var(--color-surface-muted)' },
  '.cm-executing-line': { background: 'var(--color-accent)' },
});

function toEditorDiagnostics(view: EditorView, diagnostics: readonly Diagnostic[]): EditorDiagnostic[] {
  const { doc } = view.state;
  return diagnostics
    .filter((diagnostic) => diagnostic.line <= doc.lines)
    .map((diagnostic) => {
      const line = doc.line(diagnostic.line);
      const from = Math.min(line.from + diagnostic.column - 1, line.to);
      return {
        from,
        to: line.to,
        severity: diagnostic.severity === DiagnosticSeverity.Error ? 'error' : 'warning',
        message: describeDiagnostic(diagnostic),
      };
    });
}

function createEditor(parent: HTMLElement): EditorView {
  return new EditorView({
    parent,
    state: EditorState.create({
      doc: props.modelValue,
      extensions: [
        lineNumbers(),
        lintGutter(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        gcodeLanguage,
        syntaxHighlighting(gcodeHighlightStyle),
        executingLineField,
        editorTheme,
        readOnlyCompartment.of(EditorState.readOnly.of(props.isReadOnly)),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) emit('update:modelValue', update.state.doc.toString());
          if (update.selectionSet || update.docChanged) {
            emit('caretLineChange', update.state.doc.lineAt(update.state.selection.main.head).number);
          }
        }),
      ],
    }),
  });
}

onMounted(() => {
  if (!containerElement.value) return;
  const view = createEditor(containerElement.value);
  editorView = view;
  view.dispatch(setDiagnostics(view.state, toEditorDiagnostics(view, props.diagnostics)));

  watch(
    () => props.modelValue,
    (text) => {
      if (text !== view.state.doc.toString()) {
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
      }
    },
  );
  watch(
    () => props.diagnostics,
    (diagnostics) => view.dispatch(setDiagnostics(view.state, toEditorDiagnostics(view, diagnostics))),
  );
  watch(
    () => props.isReadOnly,
    (isReadOnly) => view.dispatch({ effects: readOnlyCompartment.reconfigure(EditorState.readOnly.of(isReadOnly)) }),
  );
  watch(
    () => props.executingLine,
    (line) => {
      const effects: StateEffect<unknown>[] = [setExecutingLineEffect.of(line)];
      if (line !== null && line >= 1 && line <= view.state.doc.lines) {
        effects.push(EditorView.scrollIntoView(view.state.doc.line(line).from, { y: 'center' }));
      }
      view.dispatch({ effects });
    },
  );
});

onBeforeUnmount(() => editorView?.destroy());

defineExpose({
  /** Moves the caret to a line and scrolls to it. */
  revealLine(line: number): void {
    const view = editorView;
    if (!view || line < 1 || line > view.state.doc.lines) return;
    const { from } = view.state.doc.line(line);
    view.dispatch({ selection: EditorSelection.cursor(from), scrollIntoView: true });
    view.focus();
  },
});
</script>

<template>
  <div ref="containerElement" class="gcode-editor" data-testid="gcode-editor" />
</template>

<style scoped>
.gcode-editor {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
</style>
