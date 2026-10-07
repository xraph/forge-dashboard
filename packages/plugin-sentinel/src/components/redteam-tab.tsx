import { useState } from "react"
import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { TagList } from "@forge-go/dashboard-kit/components/tag-list"
import { attackLabel, casePath, plural, runPath, shortRunId } from "../format"
import type { CasesList, GenerateResult, RunsList, TestCase } from "../types"
import { GenerateDialog } from "./generate-dialog"
import { RedTeamReportSection } from "./redteam-report"
import { SettledBoundary } from "./settled-boundary"

function columns(suiteId: string): Column<TestCase>[] {
  return [
    {
      id: "name",
      header: "Name",
      className: "font-medium",
      cell: (c) => <PluginLink to={casePath(suiteId, c.id)}>{c.name}</PluginLink>,
    },
    { id: "type", header: "Attack type", cell: (c) => attackLabel(c.redTeam?.attackType ?? "") },
    {
      id: "input",
      header: "Input",
      // One line, as text: this is the attack.
      cell: (c) => <span className="line-clamp-1 max-w-md break-all">{c.input}</span>,
    },
    {
      id: "scorers",
      header: "Own scorers",
      cell: (c) => <TagList values={[...new Set(c.scorers.map((s) => s.name))]} label="scorers of its own" />,
    },
  ]
}

/**
 * A suite's red team: generating cases, how the newest completed run fared
 * against them, and the cases themselves. Red-team cases are ordinary cases
 * with the red team tag, so they also appear on the Cases tab.
 */
export function RedTeamTab({ suiteId }: { suiteId: string }) {
  const cases = useQuery<CasesList>("cases.list", { suiteId })
  const latest = useQuery<RunsList>("runs.list", { suiteId, state: "completed", limit: 1 })
  const [generating, setGenerating] = useState(false)
  const [added, setAdded] = useState<GenerateResult | null>(null)
  const run = latest.data?.items[0]
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Attacks on the target, as cases. A run scores them with the rest, and a failed one is a bypass.
        </p>
        <Button
          onClick={() => {
            setAdded(null)
            setGenerating(true)
          }}
        >
          Generate cases
        </Button>
      </div>
      {added && (
        <p role="status" className="text-sm">
          {added.created === 0
            ? "No case was added."
            : `Added ${plural(added.created, "red-team case", "red-team cases")}. Start a run to score them.`}
        </p>
      )}
      {run && (
        <RedTeamReportSection
          key={run.id}
          runId={run.id}
          title="In the newest completed run"
          intro={
            <p className="text-sm text-muted-foreground">
              {"From the newest completed run, "}
              <PluginLink to={runPath(run.id)}>
                <span className="font-mono text-xs">{shortRunId(run.id)}</span>
              </PluginLink>
              .
            </p>
          }
        />
      )}
      <SettledBoundary title="Red-team cases" query={cases} skeletonRows={4}>
        {(data) => {
          const red = data.items.filter((c) => c.redTeam)
          return (
            <ResourceTable<TestCase>
              columns={columns(suiteId)}
              rows={red}
              rowKey={(c) => c.id}
              caption={plural(red.length, "red-team case", "red-team cases")}
              emptyMessage="No red-team cases yet. Generate some to see how the target holds up."
            />
          )
        }}
      </SettledBoundary>
      <GenerateDialog open={generating} onOpenChange={setGenerating} suiteId={suiteId} onGenerated={setAdded} />
    </div>
  )
}
