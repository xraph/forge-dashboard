import { useEffect, useRef } from "react"
import { EditorState } from "@codemirror/state"
import { EditorView, lineNumbers } from "@codemirror/view"
import { json } from "@codemirror/lang-json"
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language"
import { unifiedMergeView } from "@codemirror/merge"

export interface JsonDiffProps {
  /** The older text: what the value was. Lines only here are drawn as removed. */
  was: string
  /** The newer text: what the value is now. Lines only here are drawn as added. */
  now: string
  /** Names the diff for a screen reader. */
  label: string
}

// The same tokens as the editor, so the diff follows light and dark too.
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
})

/**
 * Two JSON texts compared in one read-only view: what was removed, what was
 * added, and the unchanged stretches folded away. Loaded lazily by the config
 * page, so `@codemirror/merge` is not in the shell's entry chunk.
 */
export default function JsonDiff({ was, now, label }: JsonDiffProps) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!host.current) return
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: now,
        extensions: [
          lineNumbers(),
          syntaxHighlighting(defaultHighlightStyle),
          json(),
          unifiedMergeView({
            original: was,
            // Nothing here is accepted or rejected: it is a comparison.
            mergeControls: false,
            collapseUnchanged: { margin: 2, minSize: 4 },
          }),
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          EditorView.contentAttributes.of({ "aria-label": label }),
          theme,
        ],
      }),
    })
    return () => view.destroy()
  }, [was, now, label])
  return <div ref={host} className="max-h-96 overflow-auto rounded-md border" />
}
