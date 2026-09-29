import { Suspense, lazy } from "react"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"

// One lazy chunk for every place structured data appears: response bodies,
// event payloads, DLQ payloads, schemas and examples.
const JsonEditor = lazy(() => import("./json-editor"))

/** Pretty JSON when the text parses, the text as it came when it does not. */
export function prettyJSON(value: unknown): string {
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2)
    } catch {
      return value
    }
  }
  return JSON.stringify(value, null, 2)
}

/**
 * Structured data, readable at once as preformatted text, then upgraded to a
 * folding, searchable viewer when its chunk has loaded. The fallback is the
 * same text, so nothing on the page waits on the editor.
 */
export function JsonView({ value, label }: { value: unknown; label: string }) {
  if (value === undefined || value === null || value === "")
    return <NoneCell label={label} />
  const text = prettyJSON(value)
  return (
    <Suspense
      fallback={
        <pre
          aria-label={label}
          className="max-h-96 overflow-auto rounded-md border p-3 font-mono text-xs"
        >
          {text}
        </pre>
      }
    >
      <JsonEditor text={text} label={label} />
    </Suspense>
  )
}
