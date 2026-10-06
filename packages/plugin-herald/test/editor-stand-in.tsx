import type { CodeEditorProps, FieldDiffProps } from "../src/components/editor/types"

/**
 * The editor's props on a textarea, so workspace tests drive it with
 * fireEvent.change. What the real editor would draw lands on data attributes:
 * diagnostics as JSON, a focus request as line:column:seq. The real editor is
 * tested on its own in code-editor.test.tsx.
 */
export function EditorStandIn({ label, initial, onChange, diagnostics, focus, singleLine, language }: CodeEditorProps) {
  return (
    <textarea
      aria-label={label}
      defaultValue={initial}
      data-language={language}
      data-single-line={singleLine ? "true" : "false"}
      data-diagnostics={JSON.stringify(diagnostics ?? [])}
      data-focus={focus ? `${focus.line}:${focus.column}:${focus.seq}` : ""}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

export function DiffStandIn({ label, was, now }: FieldDiffProps) {
  return <pre aria-label={label}>{`- ${was}\n+ ${now}`}</pre>
}
