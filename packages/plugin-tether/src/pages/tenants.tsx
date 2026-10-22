import { useState } from "react"
import type { ComponentType } from "react"
import { PluginLink, useCommand, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { IconButton } from "@forge-go/dashboard-kit/components/icon-button"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { ResourceTable } from "@forge-go/dashboard-kit/components/resource-table"
import type { Column } from "@forge-go/dashboard-kit/components/resource-table"
import { Section } from "@forge-go/dashboard-kit/components/section"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { TetherBoundary, TetherCommandAlert } from "../components/boundary"
import { CreateTenantDialog } from "../components/create-tenant-dialog"
import { limitsSummary, tenantLabel, tenantPath } from "../format"
import type { Ack, Tenant, TenantsList, UpdateTenantInput } from "../types"

/** A tenant the enable/disable button was last pressed for. */
interface Toggled {
  label: string
  enabling: boolean
}

export const TenantsPage: ComponentType<PluginPageProps> = () => {
  const query = useQuery<TenantsList>("tenants.list")
  const update = useCommand<Tenant>("tenants.update")
  const remove = useCommand<Ack>("tenants.delete")
  const [creating, setCreating] = useState(false)
  const [toggled, setToggled] = useState<Toggled | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Tenant | null>(null)

  function toggle(tenant: Tenant) {
    update.reset()
    setToggled({ label: tenantLabel(tenant), enabling: !tenant.enabled })
    // A pointer-style partial: only `enabled`, so nothing else is rewritten.
    const payload: UpdateTenantInput = {
      tenantId: tenant.id,
      enabled: !tenant.enabled,
    }
    void update.execute(payload)
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    const result = await remove.execute({ tenantId: pendingDelete.id })
    // Close on success only. A failure (a 409 because devices exist) stays in
    // front of the person who caused it, inside the dialog.
    if (result !== undefined) setPendingDelete(null)
  }

  const columns: Column<Tenant>[] = [
    {
      id: "name",
      header: "Name",
      className: "font-medium",
      cell: (t) => (
        <PluginLink
          to={tenantPath(t.id)}
          className="underline underline-offset-4"
        >
          {tenantLabel(t)}
        </PluginLink>
      ),
    },
    {
      id: "id",
      header: "ID",
      cell: (t) => <span className="font-mono text-xs">{t.id}</span>,
    },
    {
      id: "app",
      header: "App",
      cell: (t) => <span className="font-mono text-xs">{t.appId}</span>,
    },
    {
      id: "external",
      header: "External ID",
      cell: (t) => <span className="font-mono text-xs">{t.externalId}</span>,
    },
    {
      id: "limits",
      header: "Limits",
      cell: (t) => {
        const summary = limitsSummary(t.limits)
        return summary ?? <NoneCell label="custom limits" />
      },
    },
    {
      id: "state",
      header: "State",
      // Most tenants are enabled, so that is the quiet one. A disabled tenant
      // is refusing connections, which is what an operator scans for.
      cell: (t) => (
        <Badge variant={t.enabled ? "outline" : "secondary"}>
          {t.enabled ? "enabled" : "disabled"}
        </Badge>
      ),
    },
    {
      id: "created",
      header: "Created",
      cell: (t) => <Timestamp value={t.createdAt} label="creation time" />,
    },
  ]

  return (
    <section className="flex min-w-0 flex-col gap-4">
      <PageHeader
        title="Tenants"
        description="Each tenant is an isolated MQTT namespace with its own devices, roles and limits."
        actions={<Button onClick={() => setCreating(true)}>New tenant</Button>}
      />
      <TetherCommandAlert
        error={update.error}
        title={`Could not ${toggled?.enabling ? "enable" : "disable"} ${toggled?.label ?? "the tenant"}`}
      />
      <Section aria-label="Tenant list">
        <TetherBoundary title="Tenants" query={query} skeletonRows={4}>
          {(data) => {
            // The Go side never sends null, but this renders whatever the
            // server said.
            const tenants = data.items ?? []
            const full = data.limit > 0 && tenants.length >= data.limit
            return (
              <>
                <ResourceTable<Tenant>
                  columns={columns}
                  rows={tenants}
                  rowKey={(t) => t.id}
                  caption={`${tenants.length} ${tenants.length === 1 ? "tenant" : "tenants"}`}
                  emptyMessage="No tenants yet."
                  rowActions={(t) => (
                    <>
                      <IconButton
                        label={`${t.enabled ? "Disable" : "Enable"} ${tenantLabel(t)}`}
                        disabled={update.loading}
                        onClick={() => toggle(t)}
                      />
                      <IconButton
                        variant="destructive"
                        label={`Delete ${tenantLabel(t)}`}
                        onClick={() => {
                          remove.reset()
                          setPendingDelete(t)
                        }}
                      />
                    </>
                  )}
                />
                {full && (
                  <p className="px-4 pb-3 text-xs text-muted-foreground">
                    {`Showing the first ${data.limit} tenants. There may be more.`}
                  </p>
                )}
              </>
            )
          }}
        </TetherBoundary>
      </Section>

      <CreateTenantDialog open={creating} onOpenChange={setCreating} />

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title={`Delete “${pendingDelete ? tenantLabel(pendingDelete) : ""}”?`}
        description="Removes the tenant. A tenant that still has devices cannot be deleted; remove those first."
        confirmLabel="Delete"
        // Required. Without it a double-click deletes twice.
        pending={remove.loading}
        onConfirm={() => void confirmDelete()}
      >
        {/*
          Base UI marks the page inert while the dialog is open, so the
          refusal has to render in here or nobody can read it.
        */}
        <TetherCommandAlert
          error={remove.error}
          title="Could not delete the tenant"
        />
      </ConfirmDialog>
    </section>
  )
}
