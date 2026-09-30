import { NativeSelect, NativeSelectOption } from "@forge-go/dashboard-kit/components/native-select"
import { useNavigateTo } from "@forge-go/dashboard-plugin"
import type { StreamSummary } from "../types"
import { formatSeq } from "../format"

/** How a chain is named to a person: its tenant, or the app itself. */
export function chainLabel(s: StreamSummary): string {
  return s.tenantId ? `Tenant ${s.tenantId}` : "App level"
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
}: {
  streams: StreamSummary[]
  selectedId?: string
  basePath: "/chain" | "/checkpoints/in"
}) {
  const navigate = useNavigateTo()
  return (
    <label className="flex items-center gap-2 text-sm">
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
  )
}
