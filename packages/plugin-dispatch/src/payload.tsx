import { lazy, Suspense } from "react"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { Section } from "./components"

export type Payload =
  | { kind: "json"; json?: unknown; jsonText?: string }
  | { kind: "gob" | "binary"; bytes: number }
const JsonView = lazy(() => import("./json-view"))
export function PayloadView({
  value,
  label,
}: {
  value: Payload
  label: string
}) {
  return (
    <Section title={label}>
      {value.kind === "json" ? (
        typeof value.jsonText === "string" ? (
          <Suspense
            fallback={
              <p role="status" className="text-xs text-muted-foreground">
                Loading JSON viewer…
              </p>
            }
          >
            <JsonView text={value.jsonText} label={label} />
          </Suspense>
        ) : (
          <p className="text-xs text-muted-foreground">
            Original JSON text is unavailable. Update the Dispatch server to
            inspect this payload without losing numeric precision.
          </p>
        )
      ) : value.bytes === 0 ? (
        <NoneCell label={label.toLowerCase()} />
      ) : (
        <p className="text-xs text-muted-foreground">
          {value.kind === "gob" ? "Gob" : "Binary"} payload ·{" "}
          {value.bytes.toLocaleString()} bytes · Not viewable as JSON
        </p>
      )}
    </Section>
  )
}
