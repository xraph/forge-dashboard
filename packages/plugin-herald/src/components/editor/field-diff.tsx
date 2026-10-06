import { useEffect, useRef } from "react"
import { EditorState } from "@codemirror/state"
import type { Extension } from "@codemirror/state"
import { EditorView, lineNumbers } from "@codemirror/view"
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language"
import { unifiedMergeView } from "@codemirror/merge"
import { html } from "@codemirror/lang-html"
import { json } from "@codemirror/lang-json"
import type { FieldDiffProps } from "./types"

const theme = EditorView.theme({
  "&": { fontSize: "12px", backgroundColor: "transparent", color: "var(--foreground)" },
  ".cm-scroller": { fontFamily: "var(--font-mono, ui-monospace, monospace)", lineHeight: "1.55" },
  ".cm-gutters": { backgroundColor: "transparent", color: "var(--muted-foreground)", borderRight: "1px solid var(--border)" },
})

/**
 * What's saved against the draft, in one read-only view: removed lines,
 * added lines, and unchanged stretches folded away. Nothing here is accepted
 * or rejected; it's a comparison. Loaded lazily through ./lazy.
 */
export default function FieldDiff({ was, now, label, language }: FieldDiffProps) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!host.current) return
    const extensions: Extension[] = [
      lineNumbers(),
      syntaxHighlighting(defaultHighlightStyle),
      unifiedMergeView({ original: was, mergeControls: false, collapseUnchanged: { margin: 2, minSize: 4 } }),
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ "aria-label": label }),
      theme,
    ]
    if (language === "html") extensions.push(html())
    if (language === "json") extensions.push(json())
    const view = new EditorView({ parent: host.current, state: EditorState.create({ doc: now, extensions }) })
    return () => view.destroy()
  }, [was, now, label, language])
  return <div ref={host} className="max-h-80 overflow-auto rounded-md border" />
}
