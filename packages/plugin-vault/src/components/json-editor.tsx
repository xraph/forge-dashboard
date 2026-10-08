import { useEffect, useRef, useState } from "react"
import { EditorState } from "@codemirror/state"
import { EditorView, keymap, lineNumbers } from "@codemirror/view"
import { json } from "@codemirror/lang-json"
import {
  codeFolding,
  defaultHighlightStyle,
  foldGutter,
  foldKeymap,
  syntaxHighlighting,
} from "@codemirror/language"
import {
  highlightSelectionMatches,
  search,
  searchKeymap,
} from "@codemirror/search"
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands"
import { parseJsonText } from "../json-text"
import type { JsonParse } from "../json-text"

/** What the editor reports on every change: the text, and what it parses to. */
export interface JsonEdit {
  text: string
  result: JsonParse
}

export interface JsonEditorProps {
  /** Names the editing area for a screen reader. */
  label: string
  /**
   * The text to start from. Read once, when the editor mounts: after that the
   * editor owns what is on screen. To start it over, mount it again with a
   * different `key`.
   */
  initial: string
  onChange: (edit: JsonEdit) => void
}

// The kit's tokens, so the editor follows light and dark with the shell.
const theme = EditorView.theme({
  "&": {
    fontSize: "12px",
    backgroundColor: "transparent",
    color: "var(--foreground)",
  },
  ".cm-scroller": {
    fontFamily: "var(--font-mono, ui-monospace, monospace)",
    lineHeight: "1.55",
  },
  ".cm-gutters": {
    backgroundColor: "transparent",
    color: "var(--muted-foreground)",
    borderRight: "1px solid var(--border)",
  },
  ".cm-activeLineGutter, .cm-activeLine": { backgroundColor: "transparent" },
  "&.cm-focused": { outline: "2px solid var(--ring)", outlineOffset: "2px" },
  ".cm-panels": { backgroundColor: "var(--muted)", color: "var(--foreground)" },
})

/**
 * A CodeMirror editor for one JSON value.
 *
 * It parses as you type and says, under the editor, where the text stops being
 * JSON. The page decides what to do with that: it is told the parse result on
 * every change and gates Save on it. Loaded lazily by the config page, so none
 * of this is in the shell's entry chunk.
 */
export default function JsonEditor({
  label,
  initial,
  onChange,
}: JsonEditorProps) {
  const host = useRef<HTMLDivElement>(null)
  const [problem, setProblem] = useState(() => {
    const first = parseJsonText(initial)
    return first.ok ? undefined : first.error
  })

  // The listener lives as long as the editor, so it reads the latest callback
  // through a ref instead of being rebuilt with each render.
  const latest = useRef(onChange)
  useEffect(() => {
    latest.current = onChange
  }, [onChange])

  useEffect(() => {
    if (!host.current) return
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: initial,
        extensions: [
          lineNumbers(),
          codeFolding(),
          foldGutter(),
          history(),
          syntaxHighlighting(defaultHighlightStyle),
          json(),
          search({ top: true }),
          highlightSelectionMatches(),
          keymap.of([
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
            ...foldKeymap,
          ]),
          EditorView.contentAttributes.of({
            "aria-label": label,
            spellcheck: "false",
          }),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return
            const text = update.state.doc.toString()
            const result = parseJsonText(text)
            setProblem(result.ok ? undefined : result.error)
            latest.current({ text, result })
          }),
          theme,
        ],
      }),
    })
    return () => view.destroy()
    // `initial` is read once by design: a new starting text means a new editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [label])

  return (
    <div className="flex flex-col gap-1.5">
      <div ref={host} className="max-h-96 overflow-auto rounded-md border" />
      {problem === undefined ? null : (
        <p role="status" className="text-sm text-destructive">
          {`Line ${problem.line}, column ${problem.column}: ${problem.message}`}
        </p>
      )}
    </div>
  )
}
