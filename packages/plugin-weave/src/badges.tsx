import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { ageSeconds, formatAge } from "./format"
import type { DocumentRow, DocumentState } from "./types"

/**
 * Proportion first, per the playbook. Ready is the majority in any healthy
 * collection, so it recedes. Pending is transient. Processing is worth a
 * second look, because ingest runs inside one request. Failed is what an
 * operator came to find.
 */
const STATE_VARIANT: Record<DocumentState, "outline" | "secondary" | "default" | "destructive"> = {
  ready: "outline",
  pending: "secondary",
  processing: "default",
  failed: "destructive",
}

export function DocumentStateBadge({ state }: { state: DocumentState }) {
  return <Badge variant={STATE_VARIANT[state] ?? "outline"}>{state}</Badge>
}

/**
 * The age of a processing document's last update. Weave has no heartbeat, so
 * this states the age and does not call the document dead.
 */
export function StalledMarker({ updatedAt, now }: { updatedAt: string; now?: number }) {
  return (
    <Badge
      variant="destructive"
      title="Ingest runs inside one request, so a document still processing after this long has probably lost its process. Weave has no heartbeat to say for sure."
    >
      no update for {formatAge(ageSeconds(updatedAt, now))}
    </Badge>
  )
}

/** The state badge, plus the marker when the server says the row looks stalled. */
export function DocumentStateCell({ doc }: { doc: Pick<DocumentRow, "state" | "stalled" | "updated_at"> }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <DocumentStateBadge state={doc.state} />
      {doc.stalled ? <StalledMarker updatedAt={doc.updated_at} /> : null}
    </span>
  )
}
