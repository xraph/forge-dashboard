import { useEffect, useRef } from "react"
import { EditorState } from "@codemirror/state"
import type { Extension } from "@codemirror/state"
import { EditorView, lineNumbers } from "@codemirror/view"
import { unifiedMergeView } from "@codemirror/merge"
import { html } from "@codemirror/lang-html"
import { json } from "@codemirror/lang-json"
import { sharedTheme } from "./theme"
import type { FieldDiffProps } from "./types"

const ADDED = "color-mix(in oklab, var(--info) 14%, transparent)"
const REMOVED = "color-mix(in oklab, var(--destructive) 12%, transparent)"

// @codemirror/merge paints what the draft added green: the b side's changed
// line and changed text, and its changed-line gutter, in both light and dark.
// The no-green rule is the kit's (--success is green), so added takes the info
// tint, as an action does in the editor, and removed takes destructive. Each
// selector has at least the specificity of the merge theme's own and this
// theme loads after it, so it wins a tie. The merge theme's own class names
// are the ones overridden: cm-changedLine, cm-inlineChangedLine, cm-changedText,
// cm-changedLineGutter, cm-inlineChangedLineGutter (purple), cm-deletedChunk,
// cm-deletedText and cm-deletedLineGutter.
const theme = EditorView.theme({
  "&.cm-merge-b .cm-changedLine, .cm-inlineChangedLine": { backgroundColor: ADDED },
  "&.cm-merge-b .cm-changedText": { background: ADDED },
  "&.cm-merge-b .cm-changedLineGutter, .cm-inlineChangedLineGutter": { background: "var(--info)" },
  ".cm-deletedChunk": { backgroundColor: REMOVED },
  "&.cm-merge-b .cm-deletedText, &.cm-merge-b .cm-deletedChunk .cm-deletedText": { background: REMOVED },
  ".cm-deletedLineGutter": { background: "var(--destructive)" },
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
      sharedTheme,
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
