import { IconButton } from "@forge-go/dashboard-kit/components/icon-button"
import { useState } from "react"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { useCommand, useNavigateTo, useQuery } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import {
  DescriptionList,
  DetailLayout,
} from "@forge-go/dashboard-kit/components/detail-layout"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import {
  CommandAlert,
  QueryBoundary,
} from "@forge-go/dashboard-kit/components/query-boundary"
import { TagList } from "@forge-go/dashboard-kit/components/tag-list"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import type { EndpointSummary } from "./endpoints"
import { RecentDeliveries } from "../components/recent-deliveries"
import {
  EndpointForm,
  pairsToText,
  type EndpointFormValues,
  type ParsedEndpoint,
} from "../components/endpoint-form"

/** `endpoints.detail`, from EndpointDetail in relay's contract. */
export interface EndpointDetail extends EndpointSummary {
  headers?: Record<string, string>
  metadata?: Record<string, string>
  scopeAppId?: string
  scopeOrgId?: string
}

interface Ack {
  ok: boolean
  id?: string
}

/** `endpoints.rotateSecret`: the new secret, returned this once and never again. */
interface RotatedSecret {
  id: string
  secret: string
}

function formValues(ep: EndpointDetail): EndpointFormValues {
  return {
    tenantId: ep.tenantId,
    url: ep.url,
    description: ep.description ?? "",
    eventTypes: ep.eventTypes.join("\n"),
    rateLimit: ep.rateLimit > 0 ? String(ep.rateLimit) : "",
    headers: pairsToText(ep.headers),
    metadata: pairsToText(ep.metadata),
  }
}

function pairs(m?: Record<string, string>): string[] {
  return Object.entries(m ?? {}).map(([k, v]) => `${k}: ${v}`)
}

export function RelayEndpointDetailPage({ params }: PluginPageProps) {
  // A detail route reached without an id is a link somebody built wrong, not
  // a server state. Say so rather than asking for endpoint "".
  if (!params.id) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        No endpoint selected.
      </p>
    )
  }
  return <EndpointDetailView id={params.id} />
}

function EndpointDetailView({ id }: { id: string }) {
  const query = useQuery<EndpointDetail>("endpoints.detail", { id })
  const navigate = useNavigateTo()

  const setEnabled = useCommand<Ack>("endpoints.setEnabled")
  const rotate = useCommand<RotatedSecret>("endpoints.rotateSecret")
  const remove = useCommand<Ack>("endpoints.delete")
  const update = useCommand<Ack>("endpoints.update")
  const [editing, setEditing] = useState(false)

  const [confirming, setConfirming] = useState<"rotate" | "delete" | null>(null)
  const [newSecret, setNewSecret] = useState<string | null>(null)

  // Each dialog resets its command when it opens, so a failure from the last
  // attempt is not what the operator sees on the next one.
  function open(which: "rotate" | "delete") {
    if (which === "rotate") rotate.reset()
    else remove.reset()
    setConfirming(which)
  }

  async function confirmRotate() {
    const result = await rotate.execute({ id })
    // execute resolves undefined on failure; the dialog stays open so the
    // error stays in front of whoever caused it.
    if (result === undefined) return
    setNewSecret(result.secret)
    setConfirming(null)
  }

  function startEditing() {
    update.reset()
    setEditing(true)
  }

  async function save(p: ParsedEndpoint) {
    // Every field goes, empty ones included. To endpoints.update a missing
    // field means "leave it" and an empty one means "clear it", and a field
    // the operator emptied is asking for the second.
    const result = await update.execute({
      id,
      url: p.url,
      description: p.description,
      eventTypes: p.eventTypes,
      rateLimit: p.rateLimit ?? 0,
      headers: p.headers,
      metadata: p.metadata,
    })
    if (result === undefined) return
    setEditing(false)
  }

  async function confirmDelete() {
    const result = await remove.execute({ id })
    if (result === undefined) return
    setConfirming(null)
    // delete invalidates the list only, so this page would never learn from
    // the store that its endpoint is gone. It leaves on its own.
    navigate("/endpoints")
  }

  return (
    <section className="flex flex-col gap-4">
      <QueryBoundary title="Endpoint" query={query} skeletonRows={6}>
        {(ep) => (
          <>
            <PageHeader
              title={ep.url}
              actions={
                <>
                  {!editing && (
                    <IconButton
                      variant="outline"
                      onClick={startEditing}
                      label="Edit"
                    />
                  )}
                  <IconButton
                    variant="outline"
                    disabled={setEnabled.loading}
                    onClick={() =>
                      void setEnabled.execute({ id, enabled: !ep.enabled })
                    }
                    label={ep.enabled ? "Disable" : "Enable"}
                  />
                  <IconButton
                    variant="outline"
                    onClick={() => open("rotate")}
                    label="Rotate secret"
                  />
                  <IconButton
                    variant="destructive"
                    onClick={() => open("delete")}
                    label="Delete"
                  />
                </>
              }
            />
            {/* No dialog is open here, so the page body is the right place. */}
            <CommandAlert
              error={setEnabled.error}
              title={`Could not ${ep.enabled ? "disable" : "enable"} the endpoint`}
            />
            {newSecret && (
              <div
                role="status"
                className="flex flex-col gap-2 rounded-md border border-destructive/40 p-4"
              >
                <p className="font-medium">New signing secret</p>
                <code className="font-mono text-xs break-all">{newSecret}</code>
                <p className="text-sm text-muted-foreground">
                  Relay will not show it again. Copy it to the receiver now:
                  until the receiver has it, deliveries to this endpoint fail
                  signature verification.
                </p>
                <div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setNewSecret(null)}
                  >
                    I have copied it
                  </Button>
                </div>
              </div>
            )}
            <DetailLayout
              main={
                editing ? (
                  <EndpointForm
                    mode="edit"
                    initial={formValues(ep)}
                    submitLabel="Save"
                    pendingLabel="Saving…"
                    pending={update.loading}
                    error={update.error}
                    errorTitle="Could not save the endpoint"
                    onSubmit={(p) => void save(p)}
                    onCancel={() => setEditing(false)}
                  />
                ) : (
                  <DescriptionList
                    items={[
                      {
                        term: "ID",
                        value: (
                          <span className="font-mono text-xs">{ep.id}</span>
                        ),
                      },
                      {
                        term: "Tenant",
                        value: (
                          <span className="font-mono text-xs">
                            {ep.tenantId}
                          </span>
                        ),
                      },
                      {
                        term: "URL",
                        value: (
                          <span className="font-mono text-xs break-all">
                            {ep.url}
                          </span>
                        ),
                      },
                      {
                        term: "Description",
                        value: ep.description ? (
                          ep.description
                        ) : (
                          <NoneCell label="description" />
                        ),
                      },
                      {
                        term: "Event types",
                        value: (
                          <TagList values={ep.eventTypes} label="event types" />
                        ),
                      },
                      {
                        term: "State",
                        value: (
                          <Badge variant={ep.enabled ? "outline" : "secondary"}>
                            {ep.enabled ? "Enabled" : "Disabled"}
                          </Badge>
                        ),
                      },
                      {
                        term: "Signing",
                        value: (
                          <Badge
                            variant={ep.signed ? "outline" : "destructive"}
                          >
                            {ep.signed ? "Signed" : "Unsigned"}
                          </Badge>
                        ),
                      },
                      {
                        term: "Rate limit",
                        value:
                          ep.rateLimit > 0 ? (
                            `${ep.rateLimit}/s`
                          ) : (
                            <NoneCell label="rate limit" />
                          ),
                      },
                      {
                        term: "Headers",
                        value: (
                          <TagList
                            values={pairs(ep.headers)}
                            label="custom headers"
                          />
                        ),
                      },
                      {
                        term: "Metadata",
                        value: (
                          <TagList
                            values={pairs(ep.metadata)}
                            label="metadata"
                          />
                        ),
                      },
                      {
                        term: "Created",
                        value: (
                          <Timestamp value={ep.createdAt} label="created" />
                        ),
                      },
                      {
                        term: "Updated",
                        value: (
                          <Timestamp value={ep.updatedAt} label="updated" />
                        ),
                      },
                      {
                        term: "App scope",
                        value: ep.scopeAppId ? (
                          <span className="font-mono text-xs">
                            {ep.scopeAppId}
                          </span>
                        ) : (
                          <NoneCell label="app scope" />
                        ),
                      },
                      {
                        term: "Org scope",
                        value: ep.scopeOrgId ? (
                          <span className="font-mono text-xs">
                            {ep.scopeOrgId}
                          </span>
                        ) : (
                          <NoneCell label="org scope" />
                        ),
                      },
                    ]}
                  />
                )
              }
            />
          </>
        )}
      </QueryBoundary>
      <RecentDeliveries endpointId={id} />

      <ConfirmDialog
        open={confirming === "rotate"}
        onOpenChange={(o) => !o && setConfirming(null)}
        title="Rotate this endpoint's signing secret?"
        description="Relay starts signing deliveries with a new secret straight away. Until the receiver is updated with it, every delivery fails its signature check. You will see the new secret once."
        confirmLabel="Rotate"
        // Required. It does not debounce, and a double-click would rotate twice.
        pending={rotate.loading}
        onConfirm={() => void confirmRotate()}
      >
        <CommandAlert
          title="Could not rotate the secret"
          error={rotate.error}
        />
      </ConfirmDialog>
      <ConfirmDialog
        open={confirming === "delete"}
        onOpenChange={(o) => !o && setConfirming(null)}
        title="Delete this endpoint?"
        description="Relay stops delivering to it at once. Events that match its patterns go nowhere unless another endpoint matches them. This cannot be undone."
        confirmLabel="Delete"
        pending={remove.loading}
        onConfirm={() => void confirmDelete()}
      >
        <CommandAlert
          title="Could not delete the endpoint"
          error={remove.error}
        />
      </ConfirmDialog>
    </section>
  )
}
