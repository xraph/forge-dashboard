import { useEffect, useRef } from "react"
import {
  ChangeSet,
  EditorSelection,
  EditorState,
  RangeSetBuilder,
  Transaction,
} from "@codemirror/state"
import type { Extension, TransactionSpec } from "@codemirror/state"
import {
  Decoration,
  EditorView,
  ViewPlugin,
  keymap,
  lineNumbers,
} from "@codemirror/view"
import type { DecorationSet, ViewUpdate } from "@codemirror/view"
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands"
import {
  highlightSelectionMatches,
  search,
  searchKeymap,
} from "@codemirror/search"
import { autocompletion, completionKeymap } from "@codemirror/autocomplete"
import type {
  CompletionContext,
  CompletionResult,
  CompletionSource,
} from "@codemirror/autocomplete"
import { lintGutter, setDiagnostics } from "@codemirror/lint"
import type { Diagnostic as LintDiagnostic } from "@codemirror/lint"
import { html } from "@codemirror/lang-html"
import { json } from "@codemirror/lang-json"
import { findActions, inAction } from "../../editor/actions"
import { diagnosticRange, offsetOf } from "../../editor/positions"
import { sharedTheme } from "./theme"
import type { CodeEditorProps, EditorDiagnostic } from "./types"

const actionMark = Decoration.mark({ class: "cm-herald-action" })

function actionDecorations(doc: string): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  for (const a of findActions(doc))
    if (a.to > a.from) builder.add(a.from, a.to, actionMark)
  return builder.finish()
}

/** Tints every {{ … }} so an action reads as code inside prose or markup. Templates are small, so the whole document is scanned on each change. */
export const templateActions = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = actionDecorations(view.state.doc.toString())
    }
    update(update: ViewUpdate) {
      if (update.docChanged)
        this.decorations = actionDecorations(update.state.doc.toString())
    }
  },
  { decorations: (plugin) => plugin.decorations }
)

/** Inside an action only: `.name` for each declared variable, and Herald's function names. */
export function actionCompletions(
  variables: () => string[],
  funcs: () => string[]
): CompletionSource {
  return (context: CompletionContext): CompletionResult | null => {
    if (!inAction(context.state.doc.toString(), context.pos)) return null
    const word = context.matchBefore(/\.?[A-Za-z_][A-Za-z0-9_]*|\./)
    if (!word && !context.explicit) return null
    return {
      from: word ? word.from : context.pos,
      options: [
        ...variables().map((name) => ({ label: `.${name}`, type: "variable" })),
        ...funcs().map((name) => ({ label: name, type: "function" })),
      ],
      validFor: /^\.?[A-Za-z0-9_]*$/,
    }
  }
}

export function lintDiagnostics(
  doc: string,
  items: EditorDiagnostic[]
): LintDiagnostic[] {
  return items.map((d) => {
    const { from, to } = diagnosticRange(doc, d.line, d.column)
    return {
      from,
      to,
      severity: d.severity,
      message: d.message,
      source: "herald",
    }
  })
}

/**
 * Subject and title are one line. Enter inserts exactly a newline and is
 * dropped. A paste that carries newlines keeps its text with each newline
 * turned into a space, rather than vanishing. A document that already had
 * lines keeps them: only a change that adds lines is touched.
 */
export const oneLine = EditorState.transactionFilter.of(
  (tr): Transaction | TransactionSpec | readonly TransactionSpec[] => {
    if (
      !tr.docChanged ||
      tr.newDoc.lines <= Math.max(1, tr.startState.doc.lines)
    )
      return tr
    const specs: { from: number; to: number; insert: string }[] = []
    tr.changes.iterChanges((from, to, _fromB, _toB, inserted) => {
      const text = inserted.toString()
      // Enter, as plain insertNewline or as insertNewlineAndIndent, which adds the line's leading whitespace.
      if (/^\r?\n[ \t]*$/.test(text)) return
      specs.push({ from, to, insert: text.replace(/\r?\n/g, " ") })
    })
    if (specs.length === 0) return []
    const changes = ChangeSet.of(specs, tr.startState.doc.length)
    const last = specs[specs.length - 1]
    return {
      changes,
      // A paste puts the cursor after what it inserted; the original selection was counted against the unflattened text.
      selection: tr.selection
        ? EditorSelection.cursor(changes.mapPos(last.to, 1))
        : undefined,
      effects: tr.effects,
      userEvent: tr.annotation(Transaction.userEvent),
      scrollIntoView: tr.scrollIntoView,
    }
  }
)

// On top of the shared theme: an action takes the info tint and nothing else;
// problems take destructive and warning. Never the success token: it's green.
const theme = EditorView.theme({
  ".cm-activeLineGutter, .cm-activeLine": { backgroundColor: "transparent" },
  "&.cm-focused": { outline: "2px solid var(--ring)", outlineOffset: "2px" },
  ".cm-panels": { backgroundColor: "var(--muted)", color: "var(--foreground)" },
  ".cm-herald-action": {
    backgroundColor: "color-mix(in oklab, var(--info) 14%, transparent)",
    color: "var(--info)",
    borderRadius: "3px",
  },
  ".cm-lintRange-error": {
    backgroundImage: "none",
    textDecoration: "underline wavy var(--destructive)",
    textUnderlineOffset: "3px",
  },
  ".cm-lintRange-warning": {
    backgroundImage: "none",
    textDecoration: "underline wavy var(--warning)",
    textUnderlineOffset: "3px",
  },
  ".cm-tooltip": {
    backgroundColor: "var(--popover)",
    color: "var(--popover-foreground)",
    border: "1px solid var(--border)",
  },
})

const NONE: EditorDiagnostic[] = []
const NO_NAMES: string[] = []

/**
 * One template field, or the preview's sample data.
 *
 * Server diagnostics are pushed in, never computed here: Herald's renderer is
 * the only judge of a template. They're placed from Herald's 1-based line and
 * character column. Loaded lazily through ./lazy, so none of this is in the
 * shell's entry chunk.
 */
export default function CodeEditor({
  label,
  initial,
  language,
  singleLine = false,
  diagnostics = NONE,
  variables = NO_NAMES,
  funcs = NO_NAMES,
  focus,
  onChange,
}: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  // The listeners live as long as the editor, so they read the latest props through a ref.
  // Diagnostics ride along so a rebuilt view (a new label, language or singleLine) starts with them.
  const latest = useRef({ onChange, variables, funcs, diagnostics })
  useEffect(() => {
    latest.current = { onChange, variables, funcs, diagnostics }
  }, [onChange, variables, funcs, diagnostics])

  useEffect(() => {
    if (!host.current) return
    const extensions: Extension[] = [
      history(),
      sharedTheme,
      templateActions,
      highlightSelectionMatches(),
      autocompletion(),
      EditorState.languageData.of(() => [
        {
          autocomplete: actionCompletions(
            () => latest.current.variables,
            () => latest.current.funcs
          ),
        },
      ]),
      // Search is a panel with its own lines and buttons: a one-line field has no room for it.
      keymap.of([
        ...defaultKeymap,
        ...historyKeymap,
        ...(singleLine ? [] : searchKeymap),
        ...completionKeymap,
      ]),
      EditorView.contentAttributes.of({
        "aria-label": label,
        spellcheck: "false",
        ...(singleLine ? { "aria-multiline": "false" } : {}),
      }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged)
          latest.current.onChange(update.state.doc.toString())
      }),
      theme,
    ]
    if (singleLine) extensions.push(oneLine)
    else
      extensions.push(
        lineNumbers(),
        lintGutter(),
        search({ top: true }),
        EditorView.lineWrapping
      )
    if (language === "html") extensions.push(html())
    if (language === "json") extensions.push(json())
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({ doc: initial, extensions }),
    })
    view.current = v
    // A rebuilt view has lost its marks, and the diagnostics effect won't run again for the same array.
    const marks = latest.current.diagnostics
    if (marks.length > 0)
      v.dispatch(
        setDiagnostics(v.state, lintDiagnostics(v.state.doc.toString(), marks))
      )
    return () => {
      v.destroy()
      view.current = null
    }
    // `initial` is read once by design: a new starting text means a new editor, through a new key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [label, language, singleLine])

  // Declared after the mount effect, so on the first render it runs once the view exists.
  useEffect(() => {
    const v = view.current
    if (v)
      v.dispatch(
        setDiagnostics(
          v.state,
          lintDiagnostics(v.state.doc.toString(), diagnostics)
        )
      )
  }, [diagnostics])

  useEffect(() => {
    const v = view.current
    if (!v || !focus) return
    const at = offsetOf(v.state.doc.toString(), focus.line, focus.column)
    v.dispatch({ selection: { anchor: at }, scrollIntoView: true })
    v.focus()
  }, [focus])

  return (
    <div
      ref={host}
      className={
        singleLine
          ? "rounded-md border px-1"
          : "max-h-[28rem] min-h-40 overflow-auto rounded-md border"
      }
    />
  )
}
