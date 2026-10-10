import { useState } from "react"
import type { ComponentType } from "react"
import { PluginLink, useCommand, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { formatTimestamp } from "@forge-go/dashboard-kit/lib/format"
import {
  CommandAlert,
  QueryBoundary,
} from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { HeraldHeader, useEngineInfo } from "../components/herald-header"
import { NO_RECEIPTS, plural, STATUS_ORDER, statusLabel } from "../format"
import { templatesWithoutFallbackPath } from "../keys"
import type {
  EngineInfoResponse,
  MessageCount,
  OverviewStatsResponse,
  OverviewWindow,
  ProvidersEncryptStoredResponse,
  TemplatesListResponse,
} from "../wire"

const WINDOWS: { value: OverviewWindow; label: string }[] = [
  { value: "24h", label: "24 hours" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
]

interface ChannelRow {
  channel: string
  byStatus: Record<string, number>
}

/** Rows are channels, columns only the statuses that have rows. */
function CountsTable({ data }: { data: OverviewStatsResponse }) {
  const statuses = STATUS_ORDER.filter((s) =>
    data.counts.some((c) => c.status === s)
  )
  const channels = [...new Set(data.counts.map((c) => c.channel))].sort()
  const rows: ChannelRow[] = channels.map((channel) => ({
    channel,
    byStatus: Object.fromEntries(
      data.counts
        .filter((c: MessageCount) => c.channel === channel)
        .map((c) => [c.status, c.n])
    ),
  }))
  const total = data.counts.reduce((sum, c) => sum + c.n, 0)
  const columns: Column<ChannelRow>[] = [
    {
      id: "channel",
      header: "Channel",
      className: "font-medium",
      cell: (r) => r.channel,
    },
    ...statuses.map((status) => ({
      id: status,
      header: statusLabel(status),
      align: "end" as const,
      className: "font-mono text-xs",
      cell: (r: ChannelRow) => String(r.byStatus[status] ?? 0),
    })),
  ]
  return (
    <ResourceTable<ChannelRow>
      columns={columns}
      rows={rows}
      rowKey={(r) => r.channel}
      caption={`${plural(total, "message")} since ${formatTimestamp(data.since)}`}
      emptyMessage="No messages in this window."
    />
  )
}

interface EncryptControl {
  open: () => void
}

/**
 * Pure display. The encrypt command, its dialog and its success message live
 * in OverviewPage: encryptStored invalidates overview.stats, and the kit's
 * QueryBoundary shows its skeleton for the whole refetch, so anything held in
 * here would unmount mid-command.
 */
function Posture({
  info,
  data,
  encrypt,
  templateCount,
}: {
  info: EngineInfoResponse
  data: OverviewStatsResponse
  encrypt: EncryptControl
  templateCount: number | undefined
}) {
  const { plaintext, encrypted } = data.credentials
  const missing = data.templatesWithoutFallback.length
  const keyName = info.encryption.keyId

  return (
    <div className="flex min-w-0 flex-col gap-4 text-sm">
      <section className="flex min-w-0 flex-col gap-1.5">
        <h3 className="font-medium">Encryption</h3>
        {plaintext + encrypted === 0 ? (
          <p>No credentials are stored.</p>
        ) : info.encryption.configured ? (
          <>
            <p>
              {keyName ? (
                <>
                  Credential key{" "}
                  <span className="font-mono text-xs">{keyName}</span> is
                  configured.
                </>
              ) : (
                "A credential key is configured."
              )}{" "}
              {plaintext > 0
                ? `${plural(plaintext, "credential value")} ${plaintext === 1 ? "is" : "are"} stored in plaintext; ${encrypted} encrypted.`
                : `All ${plural(encrypted, "stored value")} carry the encryption marker.`}
            </p>
            {plaintext > 0 && (
              <div>
                <Button size="sm" variant="outline" onClick={encrypt.open}>
                  Encrypt stored credentials
                </Button>
              </div>
            )}
          </>
        ) : (
          <p>
            No credential key is configured.{" "}
            {encrypted > 0
              ? `${plaintext} ${plaintext === 1 ? "value is" : "values are"} stored in plaintext and ${encrypted} ${encrypted === 1 ? "is" : "are"} encrypted under a key this server no longer has.`
              : `${plural(plaintext, "credential value")} ${plaintext === 1 ? "is" : "are"} stored in plaintext.`}{" "}
            Set <span className="font-mono text-xs">credentials_key</span> in
            the herald extension config to encrypt new values, then encrypt the
            stored ones here.
          </p>
        )}
      </section>

      <section className="flex min-w-0 flex-col gap-1.5">
        <h3 className="font-medium">REST API</h3>
        <p>
          {info.apiProtected
            ? "The REST API has an auth middleware configured."
            : "The REST API has no auth middleware configured. Anyone who can reach it can read messages and send them."}
        </p>
      </section>

      <section className="flex min-w-0 flex-col gap-1.5">
        <h3 className="font-medium">Fallback coverage</h3>
        {missing === 0 ? (
          <p>
            {templateCount === undefined
              ? "No template is missing a fallback version."
              : templateCount === 0
                ? "This app has no templates yet."
                : "Every template has a fallback version."}
          </p>
        ) : (
          <>
            <p>
              {plural(missing, "template")} {missing === 1 ? "has" : "have"} no
              fallback version. A request in any locale{" "}
              {missing === 1 ? "it doesn't" : "they don't"} list fails instead
              of falling back.
            </p>
            <p>
              <PluginLink
                to={templatesWithoutFallbackPath}
                className="underline"
              >
                Show them
              </PluginLink>
            </p>
          </>
        )}
      </section>

      <section className="flex min-w-0 flex-col gap-1.5">
        <h3 className="font-medium">Providers</h3>
        <p>
          {data.providers.enabled} of {plural(data.providers.total, "provider")}{" "}
          enabled.
        </p>
        {data.providers.enabled === 0 && (
          <p className="font-medium">
            {data.providers.total === 0
              ? "Nothing can send until you add one."
              : "Nothing can send until you enable one."}
          </p>
        )}
      </section>
    </div>
  )
}

export const OverviewPage: ComponentType<PluginPageProps> = () => {
  const [range, setRange] = useState<OverviewWindow>("7d")
  const info = useEngineInfo()
  const stats = useQuery<OverviewStatsResponse>("overview.stats", {
    window: range,
  })
  // overview.stats counts the templates lacking a fallback, not the templates, so "none missing" can't say whether there are any.
  const templates = useQuery<TemplatesListResponse>("templates.list", {})
  const encrypt = useCommand<ProvidersEncryptStoredResponse>(
    "providers.encryptStored"
  )
  const [confirming, setConfirming] = useState(false)

  function openConfirm() {
    encrypt.reset()
    setConfirming(true)
  }

  async function confirm() {
    const result = await encrypt.execute({})
    if (result === undefined) return
    setConfirming(false)
  }

  const plaintext = stats.data?.credentials.plaintext ?? 0
  const keyId = info.data?.encryption.keyId

  return (
    <section className="flex min-w-0 flex-col gap-4">
      <HeraldHeader
        title="Notifications"
        description="What Herald handed to providers, and how this install is protected."
      />
      <div className="grid min-w-0 gap-4 @3xl/main:grid-cols-[2fr_1fr]">
        <section
          aria-labelledby="counts-heading"
          className="flex min-w-0 flex-col gap-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="counts-heading" className="text-sm font-medium">
              Messages by status and channel
            </h2>
            <div className="flex gap-1" role="group" aria-label="Window">
              {WINDOWS.map((w) => (
                <Button
                  key={w.value}
                  size="sm"
                  variant={w.value === range ? "secondary" : "ghost"}
                  aria-pressed={w.value === range}
                  onClick={() => setRange(w.value)}
                >
                  {w.label}
                </Button>
              ))}
            </div>
          </div>
          <QueryBoundary title="Message counts" query={stats} skeletonRows={4}>
            {(data) => <CountsTable data={data} />}
          </QueryBoundary>
          <p className="text-sm text-muted-foreground">
            Accepted by provider means the provider took the message.{" "}
            {NO_RECEIPTS}
          </p>
        </section>
        <section
          aria-labelledby="posture-heading"
          className="flex min-w-0 flex-col gap-3"
        >
          <h2 id="posture-heading" className="text-sm font-medium">
            Posture
          </h2>
          {/* Always mounted, text set later: a live region announces what changes inside it, not what arrives with it. */}
          <p role="status" className="text-sm empty:sr-only">
            {encrypt.data &&
              `Encrypted ${plural(encrypt.data.valuesEncrypted, "value")} across ${plural(encrypt.data.providers, "provider")}.`}
          </p>
          <QueryBoundary title="Engine" query={info} skeletonRows={3}>
            {(engineInfo) => (
              <QueryBoundary title="Posture" query={stats} skeletonRows={3}>
                {(data) => (
                  <Posture
                    info={engineInfo}
                    data={data}
                    encrypt={{ open: openConfirm }}
                    templateCount={templates.data?.templates.length}
                  />
                )}
              </QueryBoundary>
            )}
          </QueryBoundary>
        </section>
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={(open) =>
          !open && !encrypt.loading && setConfirming(false)
        }
        title="Encrypt stored credentials?"
        description={`This re-stores ${plural(plaintext, "plaintext value")} encrypted${keyId ? ` under key ${keyId}` : ""}. Values already encrypted are left alone.`}
        confirmLabel="Encrypt"
        destructive={false}
        pending={encrypt.loading}
        onConfirm={() => void confirm()}
      >
        <CommandAlert
          error={encrypt.error}
          title="Could not encrypt the stored credentials"
        />
      </ConfirmDialog>
    </section>
  )
}
