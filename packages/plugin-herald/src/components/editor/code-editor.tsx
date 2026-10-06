import { useEffect, useRef } from "react"
import { EditorState, RangeSetBuilder } from "@codemirror/state"
import type { Extension } from "@codemirror/state"
import { Decoration, EditorView, ViewPlugin, keymap, lineNumbers } from "@codemirror/view"
import type { DecorationSet, ViewUpdate } from "@codemirror/view"
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language"
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands"
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search"
import { autocompletion, completionKeymap } from "@codemirror/autocomplete"
import type { CompletionContext, CompletionResult, CompletionSource } from "@codemirror/autocomplete"
import { lintGutter, setDiagnostics } from "@codemirror/lint"
import type { Diagnostic as LintDiagnostic } from "@codemirror/lint"
import { html } from "@codemirror/lang-html"
import { json } from "@codemirror/lang-json"
import { findActions, inAction } from "../../editor/actions"
import { diagnosticRange, offsetOf } from "../../editor/positions"
import type { CodeEditorProps, EditorDiagnostic } from "./types"

const actionMark = Decoration.mark({ class: "cm-herald-action" })

function actionDecorations(doc: string): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  for (const a of findActions(doc)) if (a.to > a.from) builder.add(a.from, a.to, actionMark)
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
      if (update.docChanged) this.decorations = actionDecorations(update.state.doc.toString())
    }
  },
  { decorations: (plugin) => plugin.decorations },
)

/** Inside an action only: `.name` for each declared variable, and Herald's function names. */
export function actionCompletions(variables: () => string[], funcs: () => string[]): CompletionSource {
  return (context: CompletionContext): CompletionResult | null => {
    if (!inAction(context.state.doc.toString(), context.pos)) return null
    const word = context.matchBefore(/\.?[A-Za-z_][A-Za-z0-9_]*|\./)
    if (!word && !context.explicit) return null
    return {
      from: word ? word.from : context.pos,
      options: [...variables().map((name) => ({ label: `.${name}`, type: "variable" })), ...funcs().map((name) => ({ label: name, type: "function" }))],
      validFor: /^\.?[A-Za-z0-9_]*$/,
    }
  }
}

export function lintDiagnostics(doc: string, items: EditorDiagnostic[]): LintDiagnostic[] {
  return items.map((d) => {
    const { from, to } = diagnosticRange(doc, d.line, d.column)
    return { from, to, severity: d.severity, message: d.message, source: "herald" }
  })
}

/** A typed or pasted newline is dropped. Text that already had lines keeps them. */
const oneLine = EditorState.transactionFilter.of((tr) => (tr.docChanged && tr.newDoc.lines > Math.max(1, tr.startState.doc.lines) ? [] : tr))

// The kit's tokens, so the editor follows light and dark with the shell. An
// action takes the info tint and nothing else; problems take destructive and
// warning. Never the success token: it's green.
const theme = EditorView.theme({
  "&": { fontSize: "12px", backgroundColor: "transparent", color: "var(--foreground)" },
  ".cm-scroller": { fontFamily: "var(--font-mono, ui-monospace, monospace)", lineHeight: "1.55" },
  ".cm-gutters": { backgroundColor: "transparent", color: "var(--muted-foreground)", borderRight: "1px solid var(--border)" },
  ".cm-activeLineGutter, .cm-activeLine": { backgroundColor: "transparent" },
  "&.cm-focused": { outline: "2px solid var(--ring)", outlineOffset: "2px" },
  ".cm-panels": { backgroundColor: "var(--muted)", color: "var(--foreground)" },
  ".cm-herald-action": { backgroundColor: "color-mix(in oklab, var(--info) 14%, transparent)", color: "var(--info)", borderRadius: "3px" },
  ".cm-lintRange-error": { backgroundImage: "none", textDecoration: "underline wavy var(--destructive)", textUnderlineOffset: "3px" },
  ".cm-lintRange-warning": { backgroundImage: "none", textDecoration: "underline wavy var(--warning)", textUnderlineOffset: "3px" },
  ".cm-tooltip": { backgroundColor: "var(--popover)", color: "var(--popover-foreground)", border: "1px solid var(--border)" },
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
export default function CodeEditor({ label, initial, language, singleLine = false, diagnostics = NONE, variables = NO_NAMES, funcs = NO_NAMES, focus, onChange }: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  // The listeners live as long as the editor, so they read the latest props through a ref.
  const latest = useRef({ onChange, variables, funcs })
  useEffect(() => {
    latest.current = { onChange, variables, funcs }
  }, [onChange, variables, funcs])

  useEffect(() => {
    if (!host.current) return
    const extensions: Extension[] = [
      history(),
      syntaxHighlighting(defaultHighlightStyle),
      templateActions,
      highlightSelectionMatches(),
      autocompletion(),
      EditorState.languageData.of(() => [{ autocomplete: actionCompletions(() => latest.current.variables, () => latest.current.funcs) }]),
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, ...completionKeymap]),
      EditorView.contentAttributes.of({ "aria-label": label, spellcheck: "false" }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) latest.current.onChange(update.state.doc.toString())
      }),
      theme,
    ]
    if (singleLine) extensions.push(oneLine)
    else extensions.push(lineNumbers(), lintGutter(), search({ top: true }), EditorView.lineWrapping)
    if (language === "html") extensions.push(html())
    if (language === "json") extensions.push(json())
    const v = new EditorView({ parent: host.current, state: EditorState.create({ doc: initial, extensions }) })
    view.current = v
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
    if (v) v.dispatch(setDiagnostics(v.state, lintDiagnostics(v.state.doc.toString(), diagnostics)))
  }, [diagnostics])

  useEffect(() => {
    const v = view.current
    if (!v || !focus) return
    const at = offsetOf(v.state.doc.toString(), focus.line, focus.column)
    v.dispatch({ selection: { anchor: at }, scrollIntoView: true })
    v.focus()
  }, [focus])

  return <div ref={host} className={singleLine ? "rounded-md border px-1" : "max-h-[28rem] min-h-40 overflow-auto rounded-md border"} />
}
