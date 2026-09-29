import { useEffect, useState } from "react"
import { useQuery } from "@forge-go/dashboard-plugin"
import type { EventTypeSummary } from "../types"

function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return settled
}

/**
 * What each pattern matches in the catalog, under the field that takes them.
 * The templ form made you type globs blind; eventTypes.match answers it.
 *
 * A hint, not a gate: a pattern may name types registered later, so a
 * pattern that matches nothing is said plainly and still allowed. It stays
 * quiet while you type and says nothing at all if the lookup fails.
 */
export function PatternMatches({ patterns }: { patterns: string[] }) {
  const settled = useDebounced(patterns.slice(0, 5).join("\n"), 300)
  const list = settled ? settled.split("\n") : []
  if (list.length === 0) return null
  return (
    <ul
      aria-label="What these patterns match"
      className="flex flex-col gap-0.5 text-xs text-muted-foreground"
    >
      {list.map((p) => (
        <MatchLine key={p} pattern={p} />
      ))}
    </ul>
  )
}

function MatchLine({ pattern }: { pattern: string }) {
  const query = useQuery<{ types: EventTypeSummary[] }>("eventTypes.match", {
    pattern,
  })
  const types = query.data?.types
  if (!types) return null
  const names = types.map((t) => t.name)
  return (
    <li>
      <code className="font-mono">{pattern}</code>{" "}
      {names.length === 0
        ? "matches no registered type yet"
        : `matches ${names.slice(0, 4).join(", ")}${names.length > 4 ? ` and ${names.length - 4} more` : ""}`}
    </li>
  )
}
