import { useEffect, useRef } from "react"
import { EditorState } from "@codemirror/state"
import { EditorView, lineNumbers, keymap } from "@codemirror/view"
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands"
import { json } from "@codemirror/lang-json"
export default function JsonEditor({
  label,
  initial,
  onChange,
}: {
  label: string
  initial: string
  onChange: (text: string) => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const change = useRef(onChange)
  useEffect(() => {
    change.current = onChange
  })
  useEffect(() => {
    if (!host.current) return
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: initial,
        extensions: [
          lineNumbers(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          json(),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ "aria-label": label }),
          EditorView.theme({
            "&": { fontSize: "12px", backgroundColor: "transparent" },
            ".cm-scroller": { maxHeight: "240px", overflow: "auto" },
            ".cm-content": {
              minHeight: "80px",
              fontFamily: "var(--font-mono,monospace)",
            },
            ".cm-gutters": {
              backgroundColor: "transparent",
              color: "var(--muted-foreground)",
              border: "none",
            },
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) change.current(update.state.doc.toString())
          }),
        ],
      }),
    })
    return () => view.destroy()
    // Each editor belongs to one keyed draft field. Parent writes do not replace an in-progress document.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <div
      ref={host}
      className="min-w-0 overflow-hidden rounded-md border bg-muted/10"
    />
  )
}
