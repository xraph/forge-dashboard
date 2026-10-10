import { useState } from "react"
import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { TagList } from "@forge-go/dashboard-kit/components/tag-list"
import { RedTeamBadge, ScenarioBadge } from "../badges"
import { casePath, plural } from "../format"
import type { CasesList, TestCase } from "../types"
import { CaseFormDialog } from "./case-form-dialog"
import { ImportCasesDialog } from "./import-cases-dialog"
import { SettledBoundary } from "./settled-boundary"

function columns(suiteId: string): Column<TestCase>[] {
  return [
    {
      id: "name",
      header: "Name",
      className: "font-medium",
      cell: (c) => (
        <PluginLink to={casePath(suiteId, c.id)}>{c.name}</PluginLink>
      ),
    },
    {
      id: "input",
      header: "Input",
      // One line of the input, as text: it may be an attack, and nothing here
      // interprets it.
      cell: (c) => (
        <span className="line-clamp-1 max-w-md break-all">{c.input}</span>
      ),
    },
    {
      id: "scenario",
      header: "Scenario",
      cell: (c) => <ScenarioBadge type={c.scenarioType} />,
    },
    {
      id: "tags",
      header: "Tags",
      cell: (c) => <TagList values={c.tags} label="tags" />,
    },
    {
      id: "scorers",
      header: "Own scorers",
      // A case may hold the same scorer twice with different config; the
      // column names it once.
      cell: (c) => (
        <TagList
          values={[...new Set(c.scorers.map((s) => s.name))]}
          label="scorers of its own"
        />
      ),
    },
    {
      id: "redteam",
      header: "Red team",
      cell: (c) =>
        c.redTeam ? (
          <RedTeamBadge attackType={c.redTeam.attackType} />
        ) : (
          <NoneCell label="attack type" />
        ),
    },
  ]
}

/**
 * A suite's cases, oldest first, with adding and importing. Kept mounted
 * through a refetch (SettledBoundary), because both writes invalidate
 * cases.list while their dialog, or the line reporting an import, is on
 * screen.
 */
export function CasesTab({ suiteId }: { suiteId: string }) {
  const list = useQuery<CasesList>("cases.list", { suiteId })
  const [adding, setAdding] = useState(false)
  const [importing, setImporting] = useState(false)
  const [imported, setImported] = useState<number | null>(null)
  const add = <Button onClick={() => setAdding(true)}>Add case</Button>
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {add}
        <Button variant="outline" onClick={() => setImporting(true)}>
          Import cases
        </Button>
        {imported !== null && (
          <p role="status" className="text-sm text-muted-foreground">
            {`Imported ${plural(imported, "case", "cases")}.`}
          </p>
        )}
      </div>
      <SettledBoundary title="Cases" query={list} skeletonRows={4}>
        {(data) => (
          <ResourceTable<TestCase>
            columns={columns(suiteId)}
            rows={data.items}
            rowKey={(c) => c.id}
            caption={plural(data.items.length, "case", "cases")}
            emptyMessage="No cases yet."
            emptyAction={add}
          />
        )}
      </SettledBoundary>
      <CaseFormDialog
        open={adding}
        onOpenChange={setAdding}
        suiteId={suiteId}
      />
      <ImportCasesDialog
        open={importing}
        onOpenChange={(next) => {
          if (next) setImported(null)
          setImporting(next)
        }}
        suiteId={suiteId}
        onImported={setImported}
      />
    </div>
  )
}
