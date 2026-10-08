import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { PluginLink } from "@forge-go/dashboard-plugin"
import { DetailLayout } from "@forge-go/dashboard-kit/components/detail-layout"
import { Read, useDispatchQuery } from "../read"
import {
  Facts,
  Frame,
  Resources,
  Rows,
  Section,
  SettingValue,
  Text,
} from "../components"
import type { HandlerDetail, HandlerRow } from "../contract"
import type { Page } from "../types"

export function HandlersPage() {
  const query = useDispatchQuery<Page<HandlerRow>>("handlers.list")
  return (
    <Frame
      title="Handlers"
      description="Job handlers and workflow definitions registered in this process."
    >
      <Read title="Handlers" query={query} intervalMs={30_000}>
        {(data) => (
          <Rows
            title="handlers"
            rows={data.items}
            rowKey={(row) => row.kind + ":" + row.name}
            refresh={query.refetch}
            columns={[
              {
                id: "name",
                header: "Name",
                cell: (row) => (
                  <PluginLink
                    to={`/handlers/${row.kind === "job" ? "jobs" : "workflows"}/${encodeURIComponent(row.name)}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {row.name}
                  </PluginLink>
                ),
              },
              { id: "kind", header: "Kind", cell: (row) => row.kind },
              {
                id: "versions",
                header: "Versions",
                cell: (row) => (
                  <Text
                    value={row.versions.join(", ")}
                    label="workflow versions"
                  />
                ),
              },
              {
                id: "inputs",
                header: "Inputs",
                cell: (row) =>
                  row.kind === "job" ? (
                    row.inputCount
                  ) : (
                    <Text value={null} label="declared artifact inputs" />
                  ),
              },
            ]}
          />
        )}
      </Read>
    </Frame>
  )
}
function HandlerDetailPage({
  params,
  kind,
}: PluginPageProps & { kind: "job" | "workflow" }) {
  const query = useDispatchQuery<HandlerDetail>("handlers.get", {
    kind,
    name: params.name ?? "",
  })
  return (
    <Frame
      title={params.name ?? "Handler"}
      description="Declarations from the serving process."
    >
      <Read title="Handler" query={query} intervalMs={30_000}>
        {(data) => (
          <DetailLayout
            main={
              <>
                <Section title="Registration">
                  <Facts
                    items={[
                      ["Name", data.name],
                      ["Kind", data.kind],
                      [
                        "Versions",
                        <Text
                          value={data.versions.join(", ")}
                          label="workflow versions"
                        />,
                      ],
                    ]}
                  />
                  <PluginLink
                    to={`/${kind === "job" ? "jobs" : "workflows"}?namePrefix=${encodeURIComponent(data.name)}`}
                    className="text-sm text-primary hover:underline"
                  >
                    Browse matching {kind === "job" ? "jobs" : "runs"}
                  </PluginLink>
                </Section>
                {data.job && (
                  <>
                    <Section title="Artifact inputs">
                      <Rows
                        title="declared inputs"
                        rows={data.job.inputs}
                        rowKey={(row) => row.name}
                        refresh={query.refetch}
                        columns={[
                          {
                            id: "name",
                            header: "Name",
                            cell: (row) => row.name,
                          },
                          {
                            id: "required",
                            header: "Required",
                            cell: (row) => (row.required ? "Yes" : "No"),
                          },
                          {
                            id: "mode",
                            header: "Mode",
                            cell: (row) => row.mode,
                          },
                          {
                            id: "size",
                            header: "Max bytes",
                            cell: (row) =>
                              row.maxSize === 0
                                ? "No limit"
                                : row.maxSize.toLocaleString(),
                          },
                        ]}
                      />
                    </Section>
                    <Section title="Execution policy">
                      <SettingValue value={data.job.execution} />
                    </Section>
                  </>
                )}
              </>
            }
            aside={
              data.job ? (
                <>
                  <Section title="Resources requested">
                    <Resources values={data.job.resources} />
                  </Section>
                  <Section title="Resource limits">
                    <Resources values={data.job.resourceLimits} />
                  </Section>
                  <Section title="Lease and class">
                    <Facts
                      items={[
                        [
                          "Class",
                          <Text
                            value={data.job.resourceClass}
                            label="resource class"
                          />,
                        ],
                        [
                          "Computed resources",
                          data.job.resourceFunction ? "Yes" : "No",
                        ],
                        [
                          "Declared lease TTL",
                          data.job.leaseTtl?.text ?? "Uses default",
                        ],
                        [
                          "Effective lease TTL",
                          data.job.effectiveLeaseTtl.text,
                        ],
                      ]}
                    />
                  </Section>
                </>
              ) : undefined
            }
          />
        )}
      </Read>
    </Frame>
  )
}
export function JobHandlerPage(props: PluginPageProps) {
  return <HandlerDetailPage {...props} kind="job" />
}
export function WorkflowHandlerPage(props: PluginPageProps) {
  return <HandlerDetailPage {...props} kind="workflow" />
}
