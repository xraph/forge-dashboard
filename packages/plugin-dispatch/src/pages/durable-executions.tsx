import { useState } from "react"
import { PluginLink } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { Frame, Section, Stamp } from "../components"
import { useCursor } from "../cursor"
import { Read } from "../read"
import { useDurableRead } from "../durable-read"
import { DurableTable } from "../durable-table"
import { runPath, displayState } from "../durable-types"
import type {
  DurableExecution,
  DurableNamespace,
  DurablePage,
} from "../durable-types"

const filterLabels = {
  workflow_id: "Workflow ID",
  workflow_type: "Workflow type",
  build_id: "Build",
  state: "State",
}
const blank = { workflow_id: "", workflow_type: "", build_id: "", state: "" }
export function DurableExecutionsPage() {
  const [namespace, setNamespace] = useState("")
  const discoveryPaging = useCursor("namespaces")
  const discovery = useDurableRead<DurablePage<DurableNamespace>>(
    "durable.namespaces",
    { limit: 25, cursor: discoveryPaging.cursor ?? "" }
  )
  return (
    <Frame
      title="Durable executions"
      description="Inspect persisted runs in an authorized namespace. Checkpoint workflows have separate state."
    >
      <Section title="Namespace access">
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            setNamespace(String(form.get("namespace") ?? "").trim())
          }}
        >
          <label className="flex min-w-0 flex-col gap-1 text-xs">
            Namespace
            <Input
              name="namespace"
              aria-label="Namespace"
              key={namespace}
              defaultValue={namespace}
              placeholder="Enter exact namespace"
              className="h-8 w-56 max-w-full"
              required
            />
          </label>
          <Button size="sm" variant="outline" type="submit">
            Inspect namespace
          </Button>
          <p className="text-xs text-muted-foreground">
            Discovery does not grant execution access.
          </p>
        </form>
        <details open={!namespace} className="text-xs">
          <summary className="cursor-pointer rounded-sm py-1 text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring">
            Browse namespace catalog
            {discovery.data && !discovery.data.complete
              ? " · Discovery incomplete"
              : ""}
          </summary>
          <Read title="Namespace discovery" query={discovery}>
            {(data) => (
              <DurableTable
                title="namespaces"
                data={data}
                paging={discoveryPaging}
                loading={discovery.loading}
                refresh={discovery.refetch}
                rowKey={(row) => row.namespace}
                columns={[
                  {
                    id: "namespace",
                    header: "Namespace",
                    cell: (row) => (
                      <Button
                        size="xs"
                        variant={
                          namespace === row.namespace ? "secondary" : "ghost"
                        }
                        onClick={() => setNamespace(row.namespace)}
                      >
                        <span className="font-mono text-xs">
                          {row.namespace}
                        </span>
                      </Button>
                    ),
                  },
                  {
                    id: "ownership",
                    header: "Ownership",
                    cell: (row) => (
                      <span className="text-xs">
                        {row.app_id} / {row.tenant_id}
                      </span>
                    ),
                  },
                ]}
              />
            )}
          </Read>
        </details>
      </Section>
      {namespace && <ExecutionList key={namespace} namespace={namespace} />}
    </Frame>
  )
}
function ExecutionList({ namespace }: { namespace: string }) {
  const [filters, setFilters] = useState(blank)
  const paging = useCursor(JSON.stringify({ namespace, ...filters }))
  const query = useDurableRead<DurablePage<DurableExecution>>(
    "durable.executions",
    { namespace, ...filters, limit: 25, cursor: paging.cursor ?? "" }
  )
  const filtered = Object.values(filters).some(Boolean)
  return (
    <Section title={`Executions in ${namespace}`}>
      <div className="flex flex-wrap items-end gap-2">
        {Object.keys(blank).map((key) => (
          <label key={key} className="flex min-w-0 flex-col gap-1 text-xs">
            {filterLabels[key as keyof typeof filterLabels]}
            <Input
              className="h-8 w-40 max-w-full"
              aria-label={`Filter ${filterLabels[key as keyof typeof filterLabels]}`}
              value={filters[key as keyof typeof blank]}
              onChange={(event) =>
                setFilters({ ...filters, [key]: event.target.value })
              }
            />
          </label>
        ))}
        <Button
          size="sm"
          variant="ghost"
          disabled={!filtered}
          onClick={() => setFilters(blank)}
        >
          Clear filters
        </Button>
      </div>
      <Read
        title="Durable executions"
        query={query}
        intervalMs={paging.cursor ? null : 10_000}
      >
        {(data) => (
          <DurableTable
            title="executions"
            data={data}
            paging={paging}
            loading={query.loading}
            refresh={query.refetch}
            filtered={filtered}
            reset={() => setFilters(blank)}
            rowKey={runPath}
            columns={[
              {
                id: "workflow",
                header: "Workflow / run",
                cell: (row) => (
                  <PluginLink
                    className="break-all text-primary hover:underline"
                    to={runPath(row)}
                  >
                    <span className="font-medium">{row.workflow_id}</span>
                    <span className="block font-mono text-xs">
                      {row.run_id}
                    </span>
                  </PluginLink>
                ),
              },
              {
                id: "type",
                header: "Type / build",
                cell: (row) => (
                  <>
                    <span>{row.workflow_type}</span>
                    <span className="block font-mono text-xs break-all">
                      {row.build_id}
                    </span>
                  </>
                ),
              },
              {
                id: "state",
                header: "State",
                cell: (row) => (
                  <Badge
                    variant={row.state === "failed" ? "destructive" : "outline"}
                  >
                    {displayState(row.state)}
                  </Badge>
                ),
              },
              {
                id: "revision",
                header: "Revision / run number",
                cell: (row) => (
                  <span className="font-mono text-xs">
                    {row.revision}
                    <br />
                    {row.run_number}
                  </span>
                ),
              },
              {
                id: "updated",
                header: "Updated",
                cell: (row) => (
                  <Stamp value={row.updated_at} label="updated time" />
                ),
              },
              {
                id: "runtime",
                header: "Runtime",
                cell: (row) => <span className="text-xs">{row.runtime}</span>,
              },
            ]}
          />
        )}
      </Read>
      <p className="text-xs text-muted-foreground">
        Newest creation first. Live polling every 10 seconds on the first page;
        continuation pages retain their cursor. Polling pauses in hidden tabs.
      </p>
    </Section>
  )
}
