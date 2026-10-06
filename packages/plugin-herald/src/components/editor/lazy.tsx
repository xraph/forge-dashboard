import { Suspense, lazy } from "react"
import type { CodeEditorProps, FieldDiffProps } from "./types"

// The only way into CodeMirror: one chunk for the editor, one for the diff,
// fetched the first time a page draws them.
const CodeEditorChunk = lazy(() => import("./code-editor"))
const FieldDiffChunk = lazy(() => import("./field-diff"))

/** The editor, loaded on first use. Until its chunk arrives the text shows as it is, so nothing on the page waits on it or jumps. */
export function CodeEditor(props: CodeEditorProps) {
  return (
    <Suspense fallback={<pre aria-busy="true" className="min-h-9 overflow-auto rounded-md border p-2 font-mono text-xs whitespace-pre-wrap">{props.initial}</pre>}>
      <CodeEditorChunk {...props} />
    </Suspense>
  )
}

export function FieldDiff(props: FieldDiffProps) {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground" aria-busy="true">Loading the comparison…</p>}>
      <FieldDiffChunk {...props} />
    </Suspense>
  )
}
