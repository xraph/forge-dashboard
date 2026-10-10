import type { Diagnostic } from "../wire"
import { FIELD_LABEL } from "./fields"

function Problem({ d }: { d: Diagnostic }) {
  return (
    <span
      className={
        d.severity === "error" ? "text-destructive" : "text-muted-foreground"
      }
    >
      <span aria-hidden="true">{d.severity === "error" ? "✕ " : "⚠ "}</span>
      <span className="sr-only">
        {d.severity === "error" ? "Error: " : "Warning: "}
      </span>
      {d.field !== "" && (
        <span className="font-mono text-xs">
          {FIELD_LABEL[d.field]}
          {d.line > 0
            ? ` ${d.line}${d.column > 0 ? `:${d.column}` : ""}`
            : ""}{" "}
        </span>
      )}
      {d.message}
    </span>
  )
}

/**
 * Every problem in the last render. One with a field and a line is a button
 * that takes you there; a missing or unprovided variable belongs to no field
 * and is plain text.
 */
export function ProblemsList({
  diagnostics,
  rendered,
  onSelect,
}: {
  diagnostics: Diagnostic[]
  rendered: boolean
  onSelect: (d: Diagnostic) => void
}) {
  return (
    <section aria-label="Problems" className="flex min-w-0 flex-col gap-1.5">
      <p className="text-sm font-medium">
        {rendered ? `Problems (${diagnostics.length})` : "Problems"}
      </p>
      {!rendered ? (
        <p className="text-sm text-muted-foreground">
          Checked on the first render.
        </p>
      ) : diagnostics.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          None in the last render.
        </p>
      ) : (
        <ul className="flex min-w-0 flex-col gap-1 text-sm">
          {diagnostics.map((d, i) => (
            <li key={i}>
              {d.field !== "" && d.line > 0 ? (
                <button
                  type="button"
                  className="text-left hover:underline focus-visible:underline"
                  onClick={() => onSelect(d)}
                >
                  <Problem d={d} />
                </button>
              ) : (
                <Problem d={d} />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
