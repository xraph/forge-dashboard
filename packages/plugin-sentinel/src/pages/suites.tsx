import { useState } from "react"
import type { ComponentType } from "react"
import { PluginLink, useNavigateTo, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
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
    cell: (s) => s.model || <NoneCell label="model" />,
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
      s.currentPromptVersion ? `Version ${s.currentPromptVersion.version}` : "Suite prompt",
  },
  {
    id: "baseline",
    header: "Current baseline",
    cell: (s) => s.currentBaseline?.name ?? <NoneCell label="current baseline" />,
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
  // Outside the QueryBoundary: the create invalidates suites.list, and the
  // boundary unmounts its children while that refetches.
  const [creating, setCreating] = useState(false)
  const create = <Button onClick={() => setCreating(true)}>Create suite</Button>
  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title="Suites"
        description="A suite is a set of test cases, run against a target and scored."
        actions={create}
      />
      <QueryBoundary title="Suites" query={list} skeletonRows={5}>
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
      </QueryBoundary>
      <SuiteFormDialog
        open={creating}
        onOpenChange={setCreating}
        // A new suite has no cases, and its page is where they are added.
        onSaved={(suite) => navigate(suitePath(suite.id))}
      />
    </section>
  )
}
