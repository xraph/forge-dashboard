import { useEffect, useRef } from "react"
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
import { defaultKeymap } from "@codemirror/commands"
import { search, searchKeymap } from "@codemirror/search"

export default function JsonEditor({
  value,
  onChange,
  label,
}: {
  value: string
  onChange?: (value: string) => void
  label: string
}) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const change = useRef(onChange)
  useEffect(() => {
    change.current = onChange
  }, [onChange])
  useEffect(() => {
    if (!host.current) return
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          json(),
          codeFolding(),
          foldGutter(),
          syntaxHighlighting(defaultHighlightStyle),
          search({ top: true }),
          keymap.of([...defaultKeymap, ...searchKeymap, ...foldKeymap]),
          EditorState.readOnly.of(!onChange),
          EditorView.contentAttributes.of({ "aria-label": label }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) change.current?.(update.state.doc.toString())
          }),
          EditorView.theme({
            "&": {
              fontSize: "12px",
              backgroundColor: "transparent",
              color: "var(--foreground)",
            },
            ".cm-scroller": {
              fontFamily: "var(--font-mono)",
              overflow: "auto",
            },
            ".cm-gutters": {
              backgroundColor: "var(--muted)",
              color: "var(--muted-foreground)",
            },
            "&.cm-focused": { outline: "2px solid var(--ring)" },
          }),
        ],
      }),
    })
    view.current = editor
    return () => {
      editor.destroy()
      view.current = null
    }
    // The editor owns its document while mounted. External changes are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [label, !!onChange])
  useEffect(() => {
    const editor = view.current
    if (editor && editor.state.doc.toString() !== value)
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: value },
      })
  }, [value])
  return (
    <div
      ref={host}
      className="max-h-72 min-h-20 overflow-auto rounded-md border"
    />
  )
}
