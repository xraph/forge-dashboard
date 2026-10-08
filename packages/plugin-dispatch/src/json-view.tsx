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
import { search, searchKeymap } from "@codemirror/search"
import { defaultKeymap } from "@codemirror/commands"

const theme = EditorView.theme({
  "&": {
    fontSize: "12px",
    color: "var(--foreground)",
    backgroundColor: "transparent",
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
  "&.cm-focused": { outline: "2px solid var(--ring)", outlineOffset: "2px" },
  ".cm-panels": { backgroundColor: "var(--muted)", color: "var(--foreground)" },
})
export default function JsonView({
  text,
  label,
}: {
  text: string
  label: string
}) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!host.current) return
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: text,
        extensions: [
          // Keep carriage returns in the document, including mixed line endings.
          EditorState.lineSeparator.of("\n"),
          lineNumbers(),
          codeFolding(),
          foldGutter(),
          syntaxHighlighting(defaultHighlightStyle),
          json(),
          search({ top: true }),
          keymap.of([...defaultKeymap, ...searchKeymap, ...foldKeymap]),
          EditorState.readOnly.of(true),
          EditorView.contentAttributes.of({
            "aria-label": label,
            "aria-readonly": "true",
          }),
          theme,
        ],
      }),
    })
    return () => view.destroy()
  }, [text, label])
  return <div ref={host} className="max-h-80 overflow-auto rounded-md border" />
}
