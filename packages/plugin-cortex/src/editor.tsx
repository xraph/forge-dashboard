import { useEffect, useRef } from "react"
import { EditorState } from "@codemirror/state"
import { EditorView, keymap, lineNumbers } from "@codemirror/view"
import { defaultKeymap } from "@codemirror/commands"
import { json } from "@codemirror/lang-json"
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language"
import { search, searchKeymap } from "@codemirror/search"
export default function Editor({
  text,
  label,
  onChange,
  language = "text",
}: {
  text: string
  label: string
  onChange?: (text: string) => void
  language?: "text" | "json"
}) {
  const host = useRef<HTMLDivElement>(null),
    view = useRef<EditorView | null>(null),
    change = useRef(onChange)
  useEffect(() => {
    change.current = onChange
  }, [onChange])
  useEffect(() => {
    if (!host.current) return
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: text,
        extensions: [
          lineNumbers(),
          EditorView.lineWrapping,
          syntaxHighlighting(defaultHighlightStyle),
          ...(language === "json" ? [json()] : []),
          search({ top: true }),
          keymap.of([...defaultKeymap, ...searchKeymap]),
          EditorState.readOnly.of(!onChange),
          EditorView.contentAttributes.of({
            "aria-label": label,
            "aria-multiline": "true",
            role: "textbox",
          }),
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
              maxHeight: "24rem",
              overflow: "auto",
            },
            ".cm-gutters": {
              backgroundColor: "var(--muted)",
              color: "var(--muted-foreground)",
              borderRight: "1px solid var(--border)",
            },
            "&.cm-focused": { outline: "2px solid var(--ring)" },
          }),
        ],
      }),
    })
    view.current = editor
    return () => {
      view.current = null
      editor.destroy()
    }
    // The document is synchronized below. Changing the callback never rebuilds the editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [label, language, Boolean(onChange)])
  useEffect(() => {
    const editor = view.current
    if (editor && editor.state.doc.toString() !== text)
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: text },
      })
  }, [text])
  return <div ref={host} className="min-w-0 rounded-md border" />
}
