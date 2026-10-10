import { IconButton } from "@forge-go/dashboard-kit/components/icon-button"
import { useState } from "react"
import type { ComponentType } from "react"
import { PluginLink, useNavigateTo, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { DescriptionList } from "@forge-go/dashboard-kit/components/detail-layout"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { CurrentBadge, ResultStatusBadge } from "../badges"
import { DeleteBaselineDialog } from "../components/delete-baseline-dialog"
import { SettledBoundary } from "../components/settled-boundary"
import {
  casePath,
  formatScore,
  plural,
  runPath,
  shortRunId,
  suitePath,
  suiteTabPath,
} from "../format"
import type { BaselineDetail, BaselineResult } from "../types"

/** /baselines/:id. Guards the id, then keys the body on it. */
export const BaselineDetailPage: ComponentType<PluginPageProps> = ({
  params,
}) => {
  const id = params.id
  if (!id)
    return (
      <p className="text-sm text-muted-foreground">No baseline selected.</p>
    )
  return <BaselineDetailBody key={id} baselineId={id} />
}

function BaselineDetailBody({ baselineId }: { baselineId: string }) {
  const baseline = useQuery<BaselineDetail>("baselines.detail", { baselineId })
  const navigate = useNavigateTo()
  const [deleting, setDeleting] = useState(false)
  const [target, setTarget] = useState<BaselineDetail | null>(null)
  return (
    <section className="flex min-w-0 flex-col gap-4">
      <SettledBoundary title="Baseline" query={baseline} skeletonRows={6}>
        {(b) => (
          <div className="flex min-w-0 flex-col gap-4">
            <PageHeader
              title={b.name}
              description={
                b.isCurrent
                  ? `${b.suiteName}'s current baseline: its runs are compared with this one.`
                  : `A past baseline of ${b.suiteName}. Runs are not compared with it.`
              }
              actions={
                <IconButton
                  variant="outline"
                  onClick={() => {
                    setTarget(b)
                    setDeleting(true)
                  }}
                  label="Delete"
                />
              }
            />
            <DescriptionList
              items={[
                {
                  term: "Suite",
                  value: (
                    <PluginLink to={suitePath(b.suiteId)}>
                      {b.suiteName}
                    </PluginLink>
                  ),
                },
                {
                  term: "From run",
                  value: (
                    <PluginLink to={runPath(b.runId)}>
                      <span className="font-mono text-xs">
                        {shortRunId(b.runId)}
                      </span>
                    </PluginLink>
                  ),
                },
                {
                  term: "Current",
                  value: b.isCurrent ? <CurrentBadge /> : "No",
                },
                { term: "Pass rate", value: formatScore(b.passRate) },
                { term: "Avg score", value: formatScore(b.avgScore) },
                {
                  term: "Saved",
                  value: <Timestamp value={b.createdAt} label="save time" />,
                },
              ]}
            />
            <BaselineDimensions scores={b.dimensionScores} />
            <section
              aria-labelledby="sentinel-baseline-results"
              className="flex min-w-0 flex-col gap-2"
            >
              <h2
                id="sentinel-baseline-results"
                className="text-sm font-medium"
              >
                Saved results
              </h2>
              <ResourceTable<BaselineResult>
                columns={resultColumns(b.suiteId)}
                rows={b.results}
                rowKey={(r) => r.caseId}
                caption={`${plural(b.results.length, "result", "results")}, errors included`}
                emptyMessage="This baseline saved no results."
              />
            </section>
          </div>
        )}
      </SettledBoundary>
      {target && (
        <DeleteBaselineDialog
          open={deleting}
          onOpenChange={setDeleting}
          baseline={target}
          onDeleted={() => navigate(suiteTabPath(target.suiteId, "baselines"))}
        />
      )}
    </section>
  )
}

function resultColumns(suiteId: string): Column<BaselineResult>[] {
  return [
    {
      id: "case",
      header: "Case",
      className: "font-medium",
      // The case may have been deleted since; the link then lands on its
      // not-found page, which says so.
      cell: (r) => (
        <PluginLink to={casePath(suiteId, r.caseId)}>{r.caseName}</PluginLink>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (r) => <ResultStatusBadge status={r.status} />,
    },
    {
      id: "score",
      header: "Score",
      align: "end",
      className: "tabular-nums",
      cell: (r) => formatScore(r.score),
    },
  ]
}

function BaselineDimensions({ scores }: { scores: Record<string, number> }) {
  const entries = Object.entries(scores)
  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        The run this came from measured no dimensions.
      </p>
    )
  }
  return (
    <section
      aria-labelledby="sentinel-baseline-dimensions"
      className="flex min-w-0 flex-col gap-2"
    >
      <h2 id="sentinel-baseline-dimensions" className="text-sm font-medium">
        Dimension scores
      </h2>
      <DescriptionList
        items={entries.map(([dim, v]) => ({
          term: dim,
          value: formatScore(v),
        }))}
      />
    </section>
  )
}
