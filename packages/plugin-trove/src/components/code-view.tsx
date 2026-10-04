import { useEffect, useRef } from "react"
import { EditorState } from "@codemirror/state"
import { EditorView, keymap, lineNumbers } from "@codemirror/view"
import { json } from "@codemirror/lang-json"
import { codeFolding, defaultHighlightStyle, foldGutter, foldKeymap, syntaxHighlighting } from "@codemirror/language"
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search"
import { defaultKeymap } from "@codemirror/commands"

// The kit's tokens, so the view follows light and dark with the shell.
const theme = EditorView.theme({
  "&": { fontSize: "12px", backgroundColor: "transparent", color: "var(--foreground)" },
  ".cm-scroller": { fontFamily: "var(--font-mono, ui-monospace, monospace)", lineHeight: "1.55" },
  ".cm-gutters": { backgroundColor: "transparent", color: "var(--muted-foreground)", borderRight: "1px solid var(--border)" },
  ".cm-activeLineGutter, .cm-activeLine": { backgroundColor: "transparent" },
  "&.cm-focused": { outline: "2px solid var(--ring)", outlineOffset: "2px" },
  ".cm-panels": { backgroundColor: "var(--muted)", color: "var(--foreground)" },
})

/**
 * Read-only CodeMirror: line numbers, folding and search, nothing editable.
 * The only file in this package that names CodeMirror, and loaded through
 * lazy() by the preview, so it never reaches the shell's entry chunk.
 */
export default function CodeView({ text, language, label }: { text: string; language: "json" | "text"; label: string }) {
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
          ...(language === "json" ? [json()] : []),
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
  }, [text, language, label])
  return <div ref={host} className="max-h-96 overflow-auto rounded-md border" />
}
