import { useEffect, useRef } from "react"

/**
 * The form's own refusals, shown before anything is sent. A failed parse moves
 * focus here, so a keyboard or screen-reader user hears the problems instead
 * of hunting for them above the form. Give `heading` for a long form where a
 * lead line helps; without it each problem is a line of its own.
 */
export function ProblemsAlert({ problems, heading }: { problems: string[]; heading?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (problems.length > 0) ref.current?.focus()
  }, [problems])
  if (problems.length === 0) return null
  return (
    <div ref={ref} tabIndex={-1} role="alert" className="flex flex-col gap-0.5 rounded-md border border-destructive/50 px-3 py-2 text-sm text-destructive">
      {heading ? (
        <>
          <span className="font-medium">{heading}</span>
          <ul className="list-disc pl-5">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </>
      ) : (
        problems.map((p) => <span key={p}>{p}</span>)
      )}
    </div>
  )
}
