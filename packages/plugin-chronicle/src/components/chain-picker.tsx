import { NativeSelect, NativeSelectOption } from "@forge-go/dashboard-kit/components/native-select"
import { useNavigateTo } from "@forge-go/dashboard-plugin"
import type { StreamListResponse, StreamSummary } from "../types"
import { LIMITS } from "../types"
import { formatSeq } from "../format"

/** How a chain is named to a person: its tenant, or the app itself. */
export function chainLabel(s: StreamSummary): string {
  return s.tenantId ? `Tenant ${s.tenantId}` : "App level"
}

/**
 * Whether the list stops short of every chain. The pages ask for the first
 * 200, and a picker that silently holds fewer than exist reads as "these are
 * all the chains".
 */
export function listTruncated(l: StreamListResponse): boolean {
  return l.hasMore || l.total > l.streams.length
}

/**
 * For an app-wide operator, who has one chain per tenant. A tenant operator
 * has exactly one chain and never sees this: the page does not render it
 * when there is nothing to choose.
 */
export function ChainPicker({
  streams,
  selectedId,
  basePath,
  truncated = false,
}: {
  streams: StreamSummary[]
  selectedId?: string
  basePath: "/chain" | "/checkpoints/in"
  truncated?: boolean
}) {
  const navigate = useNavigateTo()
  return (
    <span className="flex flex-wrap items-center gap-2 text-sm">
      <label className="flex items-center gap-2">
        <span>Chain</span>
        <NativeSelect
          aria-label="Chain"
          value={selectedId ?? ""}
          onChange={(e) => navigate(`${basePath}/${encodeURIComponent(e.target.value)}`)}
        >
          {selectedId === undefined && <NativeSelectOption value="">Choose a chain</NativeSelectOption>}
          {streams.map((s) => (
            <NativeSelectOption key={s.id} value={s.id}>
              {`${chainLabel(s)}, head ${formatSeq(s.headSeq)}`}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </label>
      {truncated && <span className="text-muted-foreground">{`Showing the first ${formatSeq(LIMITS.pageMaxStreamsCheckpoints)} chains.`}</span>}
    </span>
  )
}
