import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { DetailLayout } from "@forge-go/dashboard-kit/components/detail-layout"
import { HeartbeatBadge } from "../badges"
import { Read, useDispatchQuery } from "../read"
import {
  Facts,
  Frame,
  Off,
  ResourceLink,
  Resources,
  Rows,
  Section,
  Stamp,
  Text,
} from "../components"
import type { WorkerDetail, WorkersPage } from "../contract"

export function WorkersPage() {
  const query = useDispatchQuery<WorkersPage>("workers.list")
  return (
    <Frame
      title="Workers"
      description="Operator-wide recorded heartbeats are evidence of contact, not a health verdict."
    >
      <Read title="Workers" query={query} intervalMs={5_000}>
        {(data) =>
          data.enabled ? (
            <>
              <p className="text-xs text-muted-foreground">
                Silent after {data.silentAfter?.text ?? "an unknown threshold"}.
                Remote heartbeat intervals are not recorded.
              </p>
              <Rows
                title="workers"
                rows={data.items}
                rowKey={(row) => row.id}
                refresh={query.refetch}
                columns={[
                  {
                    id: "id",
                    header: "Worker",
                    cell: (row) => <ResourceLink kind="workers" id={row.id} />,
                  },
                  {
                    id: "host",
                    header: "Hostname",
                    cell: (row) => (
                      <Text value={row.hostname} label="hostname" />
                    ),
                  },
                  {
                    id: "queues",
                    header: "Queues",
                    cell: (row) =>
                      row.queues.length ? (
                        row.queues.map((name) => (
                          <span key={name} className="mr-2">
                            <ResourceLink kind="queues" id={name}>
                              {name}
                            </ResourceLink>
                          </span>
                        ))
                      ) : (
                        <Text value={null} label="queues" />
                      ),
                  },
                  {
                    id: "concurrency",
                    header: "Concurrency",
                    cell: (row) => row.concurrency,
                  },
                  {
                    id: "heartbeat",
                    header: "Heartbeat",
                    cell: (row) => (
                      <>
                        <HeartbeatBadge status={row.heartbeatStatus} />
                        <span className="ml-2 text-xs text-muted-foreground">
                          {row.clockSkew
                            ? "Clock is ahead"
                            : (row.heartbeatAge?.text ?? "Unknown age")}
                        </span>
                      </>
                    ),
                  },
                  {
                    id: "leader",
                    header: "Role",
                    cell: (row) => (
                      <div className="flex flex-wrap gap-1">
                        {row.isLeader && <Badge>Leader</Badge>}
                        {row.self && (
                          <Badge variant="outline">This process</Badge>
                        )}
                        {!row.isLeader && !row.self && (
                          <Badge variant="outline">{row.state}</Badge>
                        )}
                      </div>
                    ),
                  },
                ]}
              />
            </>
          ) : (
            <Off
              title="Worker registry not configured"
              body="This engine cannot report a worker fleet. An absent registry is not an empty or healthy fleet."
            />
          )
        }
      </Read>
    </Frame>
  )
}
export function WorkerDetailPage({ params }: PluginPageProps) {
  const query = useDispatchQuery<WorkerDetail>("workers.get", {
    id: params.id ?? "",
  })
  return (
    <Frame title="Worker">
      <Read title="Worker" query={query} intervalMs={5_000}>
        {(data) =>
          !data.enabled || !data.worker ? (
            <Off
              title="Worker registry not configured"
              body="This engine cannot inspect worker records."
            />
          ) : (
            <DetailLayout
              main={
                <>
                  <Section title={data.worker.hostname ?? data.worker.id}>
                    <div className="flex flex-wrap gap-2">
                      <HeartbeatBadge status={data.worker.heartbeatStatus} />
                      {data.worker.isLeader && <Badge>Leader</Badge>}
                      {data.worker.self && (
                        <Badge variant="outline">This process</Badge>
                      )}
                    </div>
                    <Facts
                      items={[
                        [
                          "ID",
                          <span className="font-mono text-xs break-all">
                            {data.worker.id}
                          </span>,
                        ],
                        ["State", data.worker.state],
                        ["Concurrency", data.worker.concurrency],
                        [
                          "Queues",
                          data.worker.queues.map((name) => (
                            <span key={name} className="mr-2">
                              <ResourceLink kind="queues" id={name}>
                                {name}
                              </ResourceLink>
                            </span>
                          )),
                        ],
                        [
                          "Last seen",
                          <Stamp
                            value={data.worker.lastSeen}
                            label="heartbeat"
                          />,
                        ],
                        [
                          "Heartbeat age",
                          data.worker.clockSkew
                            ? "Worker clock is ahead"
                            : (data.worker.heartbeatAge?.text ?? "Unknown"),
                        ],
                        [
                          "Heartbeat interval",
                          data.worker.heartbeatInterval?.text ??
                            "Not recorded for remote workers",
                        ],
                        ["Silent after", data.silentAfter?.text ?? "Unknown"],
                        [
                          "Leader lease until",
                          <Stamp
                            value={data.worker.leaderUntil}
                            label="leader lease"
                          />,
                        ],
                        [
                          "Created",
                          <Stamp
                            value={data.worker.createdAt}
                            label="creation time"
                          />,
                        ],
                      ]}
                    />
                  </Section>
                  <Section title="Resource leases">
                    {data.resources.enabled ? (
                      <Rows
                        title="resource leases"
                        rows={data.resources.leases}
                        rowKey={(row) => row.owner}
                        refresh={query.refetch}
                        columns={[
                          {
                            id: "owner",
                            header: "Owner",
                            cell: (row) => (
                              <span className="font-mono text-xs">
                                {row.owner}
                              </span>
                            ),
                          },
                          {
                            id: "held",
                            header: "Held",
                            cell: (row) => <Resources values={row.held} />,
                          },
                          {
                            id: "acquired",
                            header: "Acquired",
                            cell: (row) => (
                              <Stamp
                                value={row.acquiredAt}
                                label="acquisition time"
                              />
                            ),
                          },
                        ]}
                      />
                    ) : (
                      <Off
                        title="Resource leases unavailable"
                        body={
                          data.worker.self
                            ? "Resource management is not configured for this process."
                            : "Resource leases are available only for the process serving this page."
                        }
                      />
                    )}
                  </Section>
                </>
              }
              aside={
                <>
                  <Section title="Advertised capacity">
                    <Resources values={data.worker.capacity} />
                  </Section>
                  {data.resources.enabled && (
                    <>
                      <Section title="Local capacity">
                        <Resources values={data.resources.capacity} />
                      </Section>
                      <Section title="Free">
                        <Resources values={data.resources.free} />
                      </Section>
                      <Section title="Reclaimable">
                        <Resources values={data.resources.reclaimable} />
                      </Section>
                    </>
                  )}
                </>
              }
            />
          )
        }
      </Read>
    </Frame>
  )
}
