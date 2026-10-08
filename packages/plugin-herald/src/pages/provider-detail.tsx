import { IconButton } from "@forge-go/dashboard-kit/components/icon-button"
import { useState } from "react"
import type { ComponentType } from "react"
import { PluginLink, useCommand, useNavigateTo, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { buttonVariants } from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { DescriptionList, DetailLayout } from "@forge-go/dashboard-kit/components/detail-layout"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { CommandAlert, QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable, type Column } from "@forge-go/dashboard-kit/components/resource-table"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { EnabledBadge, ProtectionBadge } from "../badges"
import { HeraldHeader } from "../components/herald-header"
import { plural } from "../format"
import { providerEditPath, providerSendTestPath, providersPath } from "../keys"
import type { CredentialStatus, DeleteResponse, ProviderDetail, ProvidersDetailResponse, RouteUse, SettingEntry } from "../wire"

const settingColumns: Column<SettingEntry>[] = [
  { id: "key", header: "Key", className: "font-mono text-xs", cell: (s) => s.key },
  {
    id: "value",
    header: "Value",
    cell: (s) => (s.secret ? <span className="text-muted-foreground">Hidden</span> : s.value ? <span className="font-mono text-xs">{s.value}</span> : <NoneCell label="value" />),
  },
]

const credentialColumns: Column<CredentialStatus>[] = [
  { id: "key", header: "Key", className: "font-mono text-xs", cell: (c) => c.key },
  { id: "protection", header: "Protection", cell: (c) => <ProtectionBadge protection={c.protection} /> },
  { id: "keyId", header: "Key ID", cell: (c) => (c.keyId ? <span className="font-mono text-xs">{c.keyId}</span> : <NoneCell label="key ID" />) },
]

/** "app app_demo (email)", for the delete confirm, which takes plain text. */
function describeUse(u: RouteUse): string {
  return u.scopeId === "" ? `default ${u.scope} (${u.channel})` : `${u.scope} ${u.scopeId} (${u.channel})`
}

function UsedBy({ uses, enabled }: { uses: RouteUse[]; enabled: boolean }) {
  if (uses.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {enabled
          ? "No routing rule names this provider. Herald picks it by channel and priority when no rule applies."
          : "No routing rule names this provider, and it is disabled, so it is not picked by routing or fallback. It sends only when chosen explicitly in Send test."}
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-1 text-sm">
        {uses.map((u) => (
          <li key={`${u.scope}|${u.scopeId}|${u.channel}`}>
            {u.scopeId === "" ? (
              `${u.channel}, default ${u.scope} rule`
            ) : (
              <>
                {u.channel} for the {u.scope} rule <span className="font-mono text-xs">{u.scopeId}</span>
              </>
            )}
          </li>
        ))}
      </ul>
      {!enabled && <p className="text-sm text-muted-foreground">Routing skips these rules while it is disabled.</p>}
    </div>
  )
}

function deleteText(p: ProviderDetail): string {
  const n = p.usedBy.length
  if (n === 0) return "This deletes the provider and its stored credentials. This cannot be undone."
  return `${plural(n, "routing rule")} ${n === 1 ? "names" : "name"} this provider: ${p.usedBy.map(describeUse).join(", ")}. ${n === 1 ? "It" : "They"} will point at a deleted provider, and Herald skips ${n === 1 ? "it" : "them"} at send time until changed. This cannot be undone.`
}

function ProviderBody({ id }: { id: string }) {
  const detail = useQuery<ProvidersDetailResponse>("providers.detail", { id })
  const remove = useCommand<DeleteResponse>("providers.delete")
  const navigateTo = useNavigateTo()
  /*
   * The delete command, its dialog and the provider the dialog is about all
   * live here, outside the QueryBoundary. The command invalidates
   * providers.detail, the host re-issues it, and the boundary swaps its
   * children for a skeleton, then for the error card when the refetch finds
   * the provider gone. Anything held inside would unmount mid-delete. The
   * dialog reads a snapshot taken when it opened, so it also survives the
   * query's data being cleared. The snapshot stays after close, so the dialog
   * keeps its words while it animates out.
   */
  const [target, setTarget] = useState<ProviderDetail | null>(null)
  const [deleting, setDeleting] = useState(false)
  const loaded = detail.data?.provider

  function openDelete(p: ProviderDetail) {
    remove.reset()
    setTarget(p)
    setDeleting(true)
  }

  async function confirmDelete() {
    const result = await remove.execute({ id })
    if (result === undefined) return
    setDeleting(false)
    navigateTo(providersPath)
  }

  return (
    <section className="flex flex-col gap-6">
      {/* Outside the boundary, so loading, failure and not-found still name the app. */}
      <HeraldHeader
        title={loaded?.name ?? "Provider"}
        actions={
          loaded && (
            <div className="flex flex-wrap gap-2">
              <IconButton label="Edit" nativeButton={false} role="link" render={<PluginLink to={providerEditPath(loaded.id)} />} />
              <PluginLink to={providerSendTestPath(loaded.id)} className={buttonVariants({ variant: "outline" })}>
                Send a test through this provider
              </PluginLink>
              <IconButton variant="destructive" onClick={() => openDelete(loaded)} label="Delete" />
            </div>
          )
        }
      />
      <QueryBoundary title="Provider" query={detail} skeletonRows={5}>
        {({ provider: p }) => (
          <DetailLayout
            main={
              <div className="flex flex-col gap-6">
                <DescriptionList
                  items={[
                    { term: "ID", value: <span className="font-mono text-xs">{p.id}</span> },
                    { term: "Channel", value: p.channel },
                    { term: "Driver", value: <span className="font-mono text-xs">{p.driver}</span> },
                    { term: "Priority", value: <span className="font-mono text-xs">{p.priority}</span> },
                    { term: "Status", value: <EnabledBadge enabled={p.enabled} /> },
                    { term: "Created", value: <Timestamp value={p.createdAt} label="creation time" /> },
                    { term: "Updated", value: <Timestamp value={p.updatedAt} label="update time" /> },
                  ]}
                />
                <section className="flex flex-col gap-2">
                  <h2 className="text-sm font-medium">Settings</h2>
                  <ResourceTable<SettingEntry> columns={settingColumns} rows={p.settings} rowKey={(s) => s.key} caption={plural(p.settings.length, "setting")} emptyMessage="No settings stored." />
                  {p.settings.some((s) => s.secret) && (
                    <p className="text-sm text-muted-foreground">Hidden values are secrets, or belong to a driver with no field schema, where any setting could be one.</p>
                  )}
                </section>
                <section className="flex flex-col gap-2">
                  <h2 className="text-sm font-medium">Credentials</h2>
                  <ResourceTable<CredentialStatus> columns={credentialColumns} rows={p.credentials} rowKey={(c) => c.key} caption={plural(p.credentials.length, "credential")} emptyMessage="No credentials stored." />
                  <p className="text-sm text-muted-foreground">Credential values are write-only. Replace one from Edit.</p>
                </section>
              </div>
            }
            aside={
              <section className="flex flex-col gap-2">
                <h2 className="text-sm font-medium">Used by routing rules</h2>
                <UsedBy uses={p.usedBy} enabled={p.enabled} />
              </section>
            }
          />
        )}
      </QueryBoundary>
      <ConfirmDialog
        open={deleting}
        onOpenChange={(open) => !open && !remove.loading && setDeleting(false)}
        title={`Delete ${target?.name ?? "provider"}?`}
        description={target ? deleteText(target) : undefined}
        confirmLabel="Delete"
        pending={remove.loading}
        onConfirm={() => void confirmDelete()}
      >
        <CommandAlert error={remove.error} title="Could not delete the provider" />
      </ConfirmDialog>
    </section>
  )
}

/**
 * A thin guard so a missing id renders a status line without the body's
 * hooks running: a query with no id would ask the server about provider "".
 */
export const ProviderDetailPage: ComponentType<PluginPageProps> = ({ params }) => {
  const id = params.id
  if (!id) {
    return (
      <section className="flex flex-col gap-6">
        <HeraldHeader title="Provider" />
        <p role="status" className="text-sm text-muted-foreground">
          No provider ID in the address, so there is nothing to show.
        </p>
      </section>
    )
  }
  return <ProviderBody id={id} />
}
