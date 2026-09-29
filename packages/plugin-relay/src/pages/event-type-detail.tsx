import { useState } from "react"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { useCommand, useQuery } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import {
  DescriptionList,
  DetailLayout,
} from "@forge-go/dashboard-kit/components/detail-layout"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { TagList } from "@forge-go/dashboard-kit/components/tag-list"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { DialogError } from "../components/dialog-error"
import { JsonView } from "../components/json-view"
import type { Ack, EventTypeDetail } from "../types"

export function RelayEventTypeDetailPage({ params }: PluginPageProps) {
  if (!params.name) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        No event type selected.
      </p>
    )
  }
  return <EventTypeView name={decodeURIComponent(params.name)} />
}

function EventTypeView({ name }: { name: string }) {
  const query = useQuery<EventTypeDetail>("eventTypes.detail", { name })
  const deprecate = useCommand<Ack>("eventTypes.deprecate")
  const [confirming, setConfirming] = useState(false)

  async function confirm() {
    const ok = await deprecate.execute({ name })
    if (ok === undefined) return
    setConfirming(false)
  }

  return (
    <section className="flex flex-col gap-4">
      <QueryBoundary title="Event type" query={query} skeletonRows={6}>
        {(t) => (
          <>
            <PageHeader
              title={t.name}
              description={t.description || undefined}
              actions={
                t.deprecated ? null : (
                  <Button
                    variant="outline"
                    onClick={() => {
                      deprecate.reset()
                      setConfirming(true)
                    }}
                  >
                    Deprecate
                  </Button>
                )
              }
            />
            <DetailLayout
              main={
                <div className="flex flex-col gap-6">
                  <section
                    aria-labelledby="schema-heading"
                    className="flex flex-col gap-2"
                  >
                    <h2 id="schema-heading" className="text-sm font-medium">
                      Schema
                    </h2>
                    {t.schema ? (
                      <JsonView value={t.schema} label="schema" />
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        No schema. Any payload is accepted.
                      </p>
                    )}
                  </section>
                  <section
                    aria-labelledby="example-heading"
                    className="flex flex-col gap-2"
                  >
                    <h2 id="example-heading" className="text-sm font-medium">
                      Example
                    </h2>
                    <JsonView value={t.example} label="example" />
                  </section>
                </div>
              }
              aside={
                <DescriptionList
                  items={[
                    {
                      term: "State",
                      value: t.deprecated ? (
                        <Badge variant="secondary">Deprecated</Badge>
                      ) : (
                        <Badge variant="outline">Active</Badge>
                      ),
                    },
                    {
                      term: "Deprecated",
                      value: (
                        <Timestamp value={t.deprecatedAt} label="deprecation" />
                      ),
                    },
                    {
                      term: "Group",
                      value: t.group || <NoneCell label="group" />,
                    },
                    {
                      term: "Version",
                      value: t.version || <NoneCell label="version" />,
                    },
                    {
                      term: "Schema version",
                      value: t.schemaVersion || (
                        <NoneCell label="schema version" />
                      ),
                    },
                    {
                      term: "Event type ID",
                      value: <span className="font-mono text-xs">{t.id}</span>,
                    },
                    {
                      term: "App scope",
                      value: t.scopeAppId ? (
                        <span className="font-mono text-xs">
                          {t.scopeAppId}
                        </span>
                      ) : (
                        <NoneCell label="app scope" />
                      ),
                    },
                    {
                      term: "Metadata",
                      value: (
                        <TagList
                          values={Object.entries(t.metadata ?? {}).map(
                            ([k, v]) => `${k}: ${v}`
                          )}
                          label="metadata"
                        />
                      ),
                    },
                    {
                      term: "Registered",
                      value: (
                        <Timestamp value={t.createdAt} label="registration" />
                      ),
                    },
                    {
                      term: "Updated",
                      value: <Timestamp value={t.updatedAt} label="update" />,
                    },
                  ]}
                />
              }
            />
            <ConfirmDialog
              open={confirming}
              onOpenChange={setConfirming}
              title={`Deprecate ${t.name}?`}
              description={
                <>
                  <span>
                    Relay will refuse new events of this type. Events already
                    sent, and their deliveries, are not touched.
                  </span>
                  <DialogError what="deprecate it" error={deprecate.error} />
                </>
              }
              confirmLabel="Deprecate"
              pending={deprecate.loading}
              onConfirm={() => void confirm()}
            />
          </>
        )}
      </QueryBoundary>
    </section>
  )
}
