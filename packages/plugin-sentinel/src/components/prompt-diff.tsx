import { useEffect, useRef } from "react"
import { EditorState } from "@codemirror/state"
import { EditorView, lineNumbers } from "@codemirror/view"
import { unifiedMergeView } from "@codemirror/merge"

export interface PromptDiffProps {
  /** The older prompt. Lines only here are drawn as removed. */
  was: string
  /** The newer prompt. Lines only here are drawn as added. */
  now: string
  /** Names the diff for a screen reader. */
  label: string
}

// The kit's tokens, so the diff follows light and dark with the shell.
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
 * Two texts compared in one read-only view, as plain text with long lines
 * wrapped: what was removed, what was added, and unchanged stretches folded
 * away. Prompts on the prompt version page, outputs on the comparison page;
 * both reach it lazily, from lazy routes, so `@codemirror/merge` is not in the
 * shell's entry chunk. Copied in shape from plugin-vault's json-diff, without
 * the JSON language.
 */
export default function PromptDiff({ was, now, label }: PromptDiffProps) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!host.current) return
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: now,
        extensions: [
          lineNumbers(),
          EditorView.lineWrapping,
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
  return <div ref={host} className="max-h-[32rem] overflow-auto rounded-md border" />
}

