import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { PluginLink } from "@forge-go/dashboard-plugin"
import { DetailLayout } from "@forge-go/dashboard-kit/components/detail-layout"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { CursorPager, useCursor } from "../cursor"
import { JobStateBadge } from "../badges"
import { Read, useDispatchQuery } from "../read"
import {
  Facts,
  Frame,
  ResourceLink,
  Rows,
  Section,
  SettingValue,
  Stamp,
  Text,
} from "../components"
import type { JobRow, QueueDetail, QueueRow, QueuesPage } from "../contract"
import type { Page } from "../types"

export function QueuesPage() {
  const query = useDispatchQuery<QueuesPage>("queues.list")
  return (
    <Frame
      title="Queues"
      description="Store counts across scopes. Limits and active counts describe the serving process."
    >
      <Read title="Queues" query={query} intervalMs={5_000}>
        {(data) => (
          <>
            <p className="text-xs text-muted-foreground">
              Discovery covers local registrations
              {data.workerDiscoveryEnabled ? " and current worker queues" : ""}.
              Historical queue names remain valid job filters.
            </p>
            <Rows
              title="queues"
              rows={data.items}
              rowKey={(row) => row.name}
              refresh={query.refetch}
              columns={[
                {
                  id: "name",
                  header: "Queue",
                  cell: (row) => (
                    <ResourceLink kind="queues" id={row.name}>
                      <span className="font-medium">{row.name}</span>
                    </ResourceLink>
                  ),
                },
                ...(
                  [
                    "pending",
                    "running",
                    "completed",
                    "failed",
                    "retrying",
                    "cancelled",
                  ] as const
                ).map((state) => ({
                  id: state,
                  header: state,
                  cell: (row: QueueRow) => row.counts[state].toLocaleString(),
                })),
                {
                  id: "active",
                  header: "Active here",
                  cell: (row) => (
                    <Text
                      value={row.localActiveCount}
                      label="local active count"
                    />
                  ),
                },
                {
                  id: "local",
                  header: "Polled here",
                  cell: (row) => (
                    <Badge variant="outline">
                      {row.polledByThisProcess ? "Yes" : "No"}
                    </Badge>
                  ),
                },
              ]}
            />
          </>
        )}
      </Read>
    </Frame>
  )
}
function QueueJobs({ name }: { name: string }) {
  const paging = useCursor(name)
  const query = useDispatchQuery<Page<JobRow>>("jobs.list", {
    queue: name,
    cursor: paging.cursor ?? "",
    limit: 25,
  })
  return (
    <Section title="Jobs in this queue">
      <Read title="Queue jobs" query={query} intervalMs={5_000}>
        {(data) => (
          <>
            <Rows
              title="jobs"
              rows={data.items}
              rowKey={(row) => row.id}
              refresh={query.refetch}
              columns={[
                {
                  id: "id",
                  header: "ID",
                  cell: (row) => <ResourceLink kind="jobs" id={row.id} />,
                },
                {
                  id: "name",
                  header: "Name",
                  cell: (row) => (
                    <span className="font-medium">{row.name}</span>
                  ),
                },
                {
                  id: "state",
                  header: "State",
                  cell: (row) => <JobStateBadge state={row.state} />,
                },
                {
                  id: "created",
                  header: "Created",
                  cell: (row) => (
                    <Stamp value={row.createdAt} label="creation time" />
                  ),
                },
              ]}
              emptyTitle={
                data.complete
                  ? "No jobs in this queue"
                  : "No results in this portion"
              }
              emptyAction={
                data.nextCursor ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={query.loading}
                    onClick={() => paging.next(data.nextCursor!)}
                  >
                    Continue search
                  </Button>
                ) : (
                  <PluginLink to="/jobs" className="text-sm text-primary">
                    Browse all jobs
                  </PluginLink>
                )
              }
              emptyBody={
                data.complete
                  ? "No jobs were found in this queue."
                  : "No jobs were found in this portion. Continue through the remaining records."
              }
            />
            <CursorPager
              result={data}
              paging={paging}
              loading={query.loading}
            />
          </>
        )}
      </Read>
    </Section>
  )
}
export function QueueDetailPage({ params }: PluginPageProps) {
  const name = params.name ?? ""
  const query = useDispatchQuery<QueueDetail>("queues.get", { name })
  return (
    <Frame title={name || "Queue"}>
      <Read title="Queue" query={query} intervalMs={5_000}>
        {(data) => (
          <DetailLayout
            main={<QueueJobs name={data.name} />}
            aside={
              <Section title="This process">
                <Facts
                  items={[
                    ["Polled here", data.polledByThisProcess ? "Yes" : "No"],
                    [
                      "Active count",
                      <Text
                        value={data.localActiveCount}
                        label="local active count"
                      />,
                    ],
                    ["Total stored jobs", data.total.toLocaleString()],
                  ]}
                />
                {data.localSettings ? (
                  <SettingValue value={data.localSettings} />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No local queue limits are registered.
                  </p>
                )}
                <PluginLink
                  to={"/jobs?queue=" + encodeURIComponent(data.name)}
                  className="text-sm text-primary"
                >
                  Open jobs with queue filter
                </PluginLink>
              </Section>
            }
          />
        )}
      </Read>
    </Frame>
  )
}
