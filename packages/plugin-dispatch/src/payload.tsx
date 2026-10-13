import { lazy, Suspense } from "react"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"

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
    <div className="flex min-w-0 flex-col gap-2">
      <h3 className="text-sm font-medium">{label}</h3>
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
    </div>
  )
}
