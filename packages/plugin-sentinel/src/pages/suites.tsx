import { useState } from "react"
import type { ComponentType } from "react"
import { PluginLink, useNavigateTo, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { SettledBoundary } from "../components/settled-boundary"
import { SuiteFormDialog } from "../components/suite-form-dialog"
import { plural, suitePath } from "../format"
import type { Suite, SuitesList } from "../types"

const columns: Column<Suite>[] = [
  {
    id: "name",
    header: "Name",
    className: "font-medium",
    cell: (s) => <PluginLink to={suitePath(s.id)}>{s.name}</PluginLink>,
  },
  {
    id: "model",
    header: "Model",
    className: "font-mono text-xs",
    // Empty means the engine's model decides, said as the detail page says it.
    cell: (s) =>
      s.model || (
        <span className="font-sans text-sm text-muted-foreground">
          Engine default
        </span>
      ),
  },
  {
    id: "cases",
    header: "Cases",
    align: "end",
    className: "tabular-nums",
    cell: (s) => s.caseCount,
  },
  {
    id: "prompt",
    header: "Prompt",
    cell: (s) =>
      s.currentPromptVersion
        ? `Version ${s.currentPromptVersion.version}`
        : "The suite's own prompt",
  },
  {
    id: "baseline",
    header: "Current baseline",
    cell: (s) =>
      s.currentBaseline?.name ?? <NoneCell label="current baseline" />,
  },
  {
    id: "updated",
    header: "Updated",
    cell: (s) => <Timestamp value={s.updatedAt} label="update" />,
  },
]

/** Every suite in the app, oldest first, as suites.list answers them. */
export const SuitesPage: ComponentType<PluginPageProps> = () => {
  const list = useQuery<SuitesList>("suites.list")
  const navigate = useNavigateTo()
  // Outside the boundary: the create invalidates suites.list, and the dialog
  // must stay up while that refetches. SettledBoundary keeps the table on
  // screen through the refetch as well.
  const [creating, setCreating] = useState(false)
  const create = <Button onClick={() => setCreating(true)}>Create suite</Button>
  return (
    <section className="flex min-w-0 flex-col gap-4">
      <PageHeader
        title="Suites"
        description="A suite is a set of test cases, run against a target and scored."
        actions={create}
      />
      <SettledBoundary title="Suites" query={list} skeletonRows={5}>
        {(data) => (
          <ResourceTable<Suite>
            columns={columns}
            rows={data.items}
            rowKey={(s) => s.id}
            caption={plural(data.items.length, "suite", "suites")}
            emptyMessage="No suites yet."
            emptyAction={create}
          />
        )}
      </SettledBoundary>
      <SuiteFormDialog
        open={creating}
        onOpenChange={setCreating}
        // A new suite has no cases, and its page is where they are added.
        onSaved={(suite) => navigate(suitePath(suite.id))}
      />
    </section>
  )
}
