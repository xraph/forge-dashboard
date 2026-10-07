import { usePoll, useQuery } from "@forge-go/dashboard-plugin"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { ScaleBars } from "../charts/bars"
import { ChartFrame } from "../charts/chart-frame"
import { attackLabel, plural } from "../format"
import type { RedTeamReport, RedTeamTally } from "../types"
import { RUN_POLL_MS } from "./runs-list"

/** Results that were judged: an errored one says nothing about a bypass. */
function judged(t: Pick<RedTeamTally, "total" | "unscored">): number {
  return t.total - t.unscored
}

function bypassLabel(t: RedTeamTally): string {
  const scored = judged(t)
  const base = scored === 0 ? "none judged" : `${t.bypassed} of ${scored} bypassed`
  return t.unscored > 0 ? `${base}, ${t.unscored} not scored` : base
}

const columns: Column<RedTeamTally>[] = [
  { id: "type", header: "Attack type", className: "font-medium", cell: (t) => attackLabel(t.attackType) },
  { id: "total", header: "Cases", align: "end", className: "tabular-nums", cell: (t) => t.total },
  { id: "bypassed", header: "Bypassed", align: "end", className: "tabular-nums", cell: (t) => t.bypassed },
  { id: "unscored", header: "Not scored", align: "end", className: "tabular-nums", cell: (t) => t.unscored },
]

/**
 * How a run's red-team cases fared, by attack type. A bypass is a red-team
 * case whose scoring failed, so the rate is only as good as the scorers that
 * judged it, and the section names them: a rate judged by an exact match
 * means something different from one an LLM judged. Nothing is drawn for a
 * suite with no red-team case (the server answers null).
 */
export function RedTeamReportSection({
  runId,
  running = false,
  title = "Red team",
}: {
  runId: string
  /** While true the report refreshes with the run. */
  running?: boolean
  title?: string
}) {
  const report = useQuery<RedTeamReport | null>("redteam.report", { runId })
  usePoll(() => {
    if (running) report.refetch()
  }, RUN_POLL_MS)
  if (report.error) {
    return (
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">{title}</h2>
        <p role="alert" className="text-sm text-destructive">{`The red-team report could not be read. ${report.error.message}`}</p>
      </section>
    )
  }
  const data = report.data
  if (!data) return null
  if (data.total === 0) {
    return (
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">{title}</h2>
        <p className="text-sm text-muted-foreground">No red-team case has a result in this run yet.</p>
      </section>
    )
  }
  const judgedBy =
    data.judgedBy.length > 0 ? `Judged by ${data.judgedBy.join(", ")}.` : "No scorer is recorded as judging these cases."
  return (
    <ChartFrame
      title={title}
      description={`${data.bypassed} of ${judged(data)} judged red-team cases bypassed the target's defences${
        data.unscored > 0 ? `, and ${plural(data.unscored, "case", "cases")} could not be scored` : ""
      }. ${judgedBy}`}
      table={
        <ResourceTable<RedTeamTally>
          columns={columns}
          rows={data.byType}
          rowKey={(t) => t.attackType}
          caption={plural(data.byType.length, "attack type", "attack types")}
          emptyMessage="No attack types."
        />
      }
    >
      <ScaleBars
        rows={data.byType.map((t) => ({
          key: t.attackType,
          label: attackLabel(t.attackType),
          value: judged(t) === 0 ? 0 : t.bypassed / judged(t),
          valueLabel: bypassLabel(t),
        }))}
        label="Bypass rate by attack type"
        valueColumn
      />
    </ChartFrame>
  )
}
