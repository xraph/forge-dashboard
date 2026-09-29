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
import {
  highlightSelectionMatches,
  search,
  searchKeymap,
} from "@codemirror/search"
import { defaultKeymap } from "@codemirror/commands"

// The kit's tokens, so the viewer follows light and dark with the shell.
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
 * Read-only CodeMirror for JSON: folding and search, nothing editable. Loaded
 * lazily by JsonView, so none of this is in the shell's entry chunk.
 */
export default function JsonEditor({
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
          lineNumbers(),
          codeFolding(),
          foldGutter(),
          syntaxHighlighting(defaultHighlightStyle),
          json(),
          search({ top: true }),
          highlightSelectionMatches(),
          keymap.of([...defaultKeymap, ...searchKeymap, ...foldKeymap]),
          EditorState.readOnly.of(true),
          EditorView.contentAttributes.of({ "aria-label": label }),
          theme,
        ],
      }),
    })
    return () => view.destroy()
  }, [text, label])
  return <div ref={host} className="max-h-96 overflow-auto rounded-md border" />
}
