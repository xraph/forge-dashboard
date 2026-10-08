import { IconButton } from "@forge-go/dashboard-kit/components/icon-button"
import { useState } from "react"
import type { ComponentType, FormEvent } from "react"
import { PluginLink, useCommand, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps, QueryState } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@forge-go/dashboard-kit/components/dialog"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import {
  NativeSelect,
  NativeSelectOption,
} from "@forge-go/dashboard-kit/components/native-select"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import {
  CommandAlert,
  QueryBoundary,
} from "@forge-go/dashboard-kit/components/query-boundary"
import { DanglingBadge, DisabledProviderBadge } from "../badges"
import { HeraldHeader, useEngineInfo } from "../components/herald-header"
import { ResolvedProvider } from "../components/resolved-provider"
import { ROUTED_CHANNELS } from "../format"
import { providerPath } from "../keys"
import { useDebounced } from "../use-debounced"
import type {
  DeleteResponse,
  ProviderSummary,
  ProvidersListResponse,
  RoutedChannel,
  ScopeRule,
  ScopeType,
  ScopesListResponse,
  ScopesSetRequest,
  ScopesSetResponse,
  SendResolveResponse,
} from "../wire"

type SlotKey =
  | "emailProviderId"
  | "smsProviderId"
  | "pushProviderId"
  | "webhookProviderId"
  | "chatProviderId"
const slotKey = (ch: RoutedChannel): SlotKey => `${ch}ProviderId` as SlotKey

const LEVELS: { scope: ScopeType; heading: string }[] = [
  { scope: "app", heading: "App rule" },
  { scope: "org", heading: "Org rules" },
  { scope: "user", heading: "User rules" },
]

function WhoSends({ channels }: { channels: string[] }) {
  const [channel, setChannel] = useState("")
  const [org, setOrg] = useState("")
  const [user, setUser] = useState("")
  // Typing an ID is not a question per keystroke: ask once it settles.
  const orgId = useDebounced(org.trim(), 300)
  const userId = useDebounced(user.trim(), 300)
  const params: Record<string, unknown> = { channel }
  if (orgId) params.orgId = orgId
  if (userId) params.userId = userId
  const resolve = useQuery<SendResolveResponse>("send.resolve", params, {
    enabled: channel !== "",
  })
  return (
    <section
      aria-labelledby="who-sends"
      className="flex flex-col gap-3 rounded-lg border p-4"
    >
      <h2 id="who-sends" className="text-sm font-medium">
        Who sends?
      </h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="who-channel">Channel to test</Label>
          <NativeSelect
            id="who-channel"
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
          >
            <NativeSelectOption value="">Choose a channel</NativeSelectOption>
            {channels.map((c) => (
              <NativeSelectOption key={c} value={c}>
                {c}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="who-org">Org ID (optional)</Label>
          <Input
            id="who-org"
            className="font-mono text-xs"
            autoComplete="off"
            spellCheck={false}
            value={org}
            onChange={(e) => setOrg(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="who-user">User ID (optional)</Label>
          <Input
            id="who-user"
            className="font-mono text-xs"
            autoComplete="off"
            spellCheck={false}
            value={user}
            onChange={(e) => setUser(e.target.value)}
          />
        </div>
      </div>
      {channel !== "" && (
        <QueryBoundary title="Who sends" query={resolve} skeletonRows={1}>
          {(r) => <ResolvedProvider answer={r} channel={channel} link from />}
        </QueryBoundary>
      )}
    </section>
  )
}

function RuleCard({
  rule,
  providers,
  onEdit,
  onDelete,
}: {
  rule: ScopeRule
  providers: ProviderSummary[]
  onEdit: () => void
  onDelete: () => void
}) {
  const who =
    rule.scope === "app"
      ? "the app rule"
      : `the ${rule.scope} rule for ${rule.scopeId}`
  return (
    <article className="flex flex-col gap-3 rounded-lg border p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">
          {rule.scope === "app" ? (
            "This app"
          ) : (
            <span className="font-mono text-xs">{rule.scopeId}</span>
          )}
        </span>
        <span className="flex gap-2">
          <IconButton
            variant="outline"
            onClick={onEdit}
            label={`Edit ${who}`}
          />
          <IconButton
            variant="ghost"
            onClick={onDelete}
            label={`Delete ${who}`}
          />
        </span>
      </header>
      <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 text-sm">
        {ROUTED_CHANNELS.map((ch) => {
          const p = rule.providers[ch]
          return (
            <div key={ch} className="contents">
              <dt className="text-muted-foreground">{ch}</dt>
              <dd>
                {!p ? (
                  <NoneCell label={`${ch} provider`} />
                ) : p.dangling ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <DanglingBadge />
                    <span className="font-mono text-xs">{p.id}</span>
                  </span>
                ) : (
                  <span className="flex flex-wrap items-center gap-2">
                    <PluginLink to={providerPath(p.id)} className="underline">
                      {p.name}
                    </PluginLink>
                    {providers.some((q) => q.id === p.id && !q.enabled) && (
                      <>
                        <DisabledProviderBadge />
                        <span className="text-xs text-muted-foreground">
                          Provider disabled: this rule is skipped for {ch} until
                          it's enabled.
                        </span>
                      </>
                    )}
                  </span>
                )}
              </dd>
            </div>
          )
        })}
        <dt className="text-muted-foreground">From</dt>
        <dd>
          {rule.fromEmail || rule.fromName || rule.fromPhone ? (
            <span>
              {rule.fromName ? `${rule.fromName} ` : ""}
              {rule.fromEmail && (
                <span className="font-mono text-xs">{rule.fromEmail}</span>
              )}
              {rule.fromPhone && (
                <span className="font-mono text-xs"> {rule.fromPhone}</span>
              )}
            </span>
          ) : (
            <NoneCell label="sender" />
          )}
        </dd>
        {rule.defaultLocale && (
          <>
            <dt className="text-muted-foreground">Default locale</dt>
            <dd>
              <span className="font-mono text-xs">{rule.defaultLocale}</span>{" "}
              <span className="text-muted-foreground">
                (stored, but Send doesn't use it)
              </span>
            </dd>
          </>
        )}
      </dl>
    </article>
  )
}

interface Draft {
  scope: ScopeType
  scopeId: string
  slots: Record<RoutedChannel, string>
  fromEmail: string
  fromName: string
  fromPhone: string
}

function draftOf(rule: ScopeRule | null): Draft {
  const slots = Object.fromEntries(
    ROUTED_CHANNELS.map((ch) => {
      const p = rule?.providers[ch]
      // A dangling slot starts cleared: the server re-checks every slot on
      // save and refuses a rule naming a deleted provider.
      return [ch, p && !p.dangling ? p.id : ""]
    })
  ) as Record<RoutedChannel, string>
  return {
    scope: rule?.scope ?? "app",
    scopeId: rule?.scopeId ?? "",
    slots,
    fromEmail: rule?.fromEmail ?? "",
    fromName: rule?.fromName ?? "",
    fromPhone: rule?.fromPhone ?? "",
  }
}

/**
 * Mounted from the first time it opens, remounted (by key) on every opening,
 * so each opening starts from the rule as stored with no stale error. `rule`
 * is the page's snapshot of the rule taken when it opened, so a refetch of
 * the rule list cannot change what this dialog says or sends.
 */
function RuleDialog({
  open,
  rule,
  providers,
  onClose,
}: {
  open: boolean
  rule: ScopeRule | null
  providers: QueryState<ProvidersListResponse>
  onClose: () => void
}) {
  const set = useCommand<ScopesSetResponse>("scopes.set")
  const [draft, setDraft] = useState<Draft>(() => draftOf(rule))
  const editing = rule !== null
  const stored = draftOf(rule)
  const danglingSlots = ROUTED_CHANNELS.filter(
    (ch) => rule?.providers[ch]?.dangling
  )
  const needsId = draft.scope !== "app"
  const canSubmit = !set.loading && (!needsId || draft.scopeId.trim() !== "")
  const known: ProviderSummary[] = providers.data?.providers ?? []

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!canSubmit) return
    const payload: ScopesSetRequest = { scope: draft.scope }
    if (needsId) payload.scopeId = draft.scopeId.trim()
    for (const ch of ROUTED_CHANNELS) {
      const value = draft.slots[ch]
      // On add, only what you set. On edit, what changed, and a dangling
      // slot always: its stored value is a deleted provider.
      const original = editing ? (rule?.providers[ch]?.id ?? "") : ""
      if (value !== original) payload[slotKey(ch)] = value
    }
    for (const key of ["fromEmail", "fromName", "fromPhone"] as const) {
      const value = draft[key].trim()
      if (value !== (editing ? stored[key] : "")) payload[key] = value
    }
    const result = await set.execute(payload)
    if (result === undefined) return
    onClose()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && !set.loading && onClose()}
    >
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit routing rule" : "Add a routing rule"}
            </DialogTitle>
            <DialogDescription>
              A rule picks the provider per channel and the sender. Leave a
              channel empty to let the next level decide.
            </DialogDescription>
          </DialogHeader>
          <CommandAlert error={set.error} title="Could not save the rule" />
          {providers.error && (
            <p className="text-sm text-muted-foreground">
              Could not load the providers to choose from:{" "}
              {providers.error.code}: {providers.error.message}
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rule-level">Level</Label>
              <NativeSelect
                id="rule-level"
                value={draft.scope}
                disabled={editing}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    scope: e.target.value as ScopeType,
                  }))
                }
              >
                <NativeSelectOption value="app">app</NativeSelectOption>
                <NativeSelectOption value="org">org</NativeSelectOption>
                <NativeSelectOption value="user">user</NativeSelectOption>
              </NativeSelect>
            </div>
            {needsId && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="rule-id">
                  {draft.scope === "org" ? "Org ID" : "User ID"}
                </Label>
                <Input
                  id="rule-id"
                  className="font-mono text-xs"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={editing}
                  value={draft.scopeId}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, scopeId: e.target.value }))
                  }
                />
              </div>
            )}
          </div>
          {ROUTED_CHANNELS.map((ch) => {
            const options = known.filter((p) => p.channel === ch)
            const current = draft.slots[ch]
            // The list may not have loaded, or the provider may sit past it. Never show a stored choice as "Not set".
            const missing =
              current !== "" && !options.some((p) => p.id === current)
            return (
              <div key={ch} className="flex flex-col gap-1.5">
                <Label htmlFor={`rule-${ch}`}>{`${ch} provider`}</Label>
                <NativeSelect
                  id={`rule-${ch}`}
                  value={current}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      slots: { ...d.slots, [ch]: e.target.value },
                    }))
                  }
                >
                  <NativeSelectOption value="">Not set</NativeSelectOption>
                  {missing && (
                    <NativeSelectOption value={current}>
                      {rule?.providers[ch]?.name || current}
                    </NativeSelectOption>
                  )}
                  {options.map((p) => (
                    <NativeSelectOption key={p.id} value={p.id}>
                      {p.enabled ? p.name : `${p.name} (disabled)`}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                {danglingSlots.includes(ch) && current === "" && (
                  <p className="text-xs text-muted-foreground">
                    The provider this pointed at was deleted. Saving clears it.
                  </p>
                )}
              </div>
            )
          })}
          <div className="grid gap-3 sm:grid-cols-3">
            {(
              [
                ["fromEmail", "From email"],
                ["fromName", "From name"],
                ["fromPhone", "From phone"],
              ] as const
            ).map(([key, label]) => (
              <div key={key} className="flex flex-col gap-1.5">
                <Label htmlFor={`rule-${key}`}>{label}</Label>
                <Input
                  id={`rule-${key}`}
                  autoComplete="off"
                  value={draft[key]}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, [key]: e.target.value }))
                  }
                />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={set.loading}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {set.loading ? "Saving…" : "Save rule"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export const RoutingPage: ComponentType<PluginPageProps> = () => {
  const info = useEngineInfo()
  const rules = useQuery<ScopesListResponse>("scopes.list")
  const providers = useQuery<ProvidersListResponse>("providers.list")
  const remove = useCommand<DeleteResponse>("scopes.delete")
  /*
   * scopes.set and scopes.delete invalidate scopes.list, and its boundary
   * swaps its children for a skeleton while that refetches (and drops its
   * data if the refetch fails). So both dialogs, their snapshots of the rule
   * and their open flags live out here. A snapshot stays after close so the
   * dialog keeps its words while it animates out.
   */
  // editing: the rule being edited when the dialog opened, null while adding. session counts openings and keys the dialog, so each one is fresh.
  const [editing, setEditing] = useState<ScopeRule | null>(null)
  const [session, setSession] = useState({ open: false, count: 0 })
  const [deleting, setDeleting] = useState<ScopeRule | null>(null)
  const [confirming, setConfirming] = useState(false)

  function openRule(rule: ScopeRule | null) {
    setEditing(rule)
    setSession((s) => ({ open: true, count: s.count + 1 }))
  }

  function openDelete(rule: ScopeRule) {
    remove.reset()
    setDeleting(rule)
    setConfirming(true)
  }

  async function confirmDelete() {
    if (!deleting) return
    const payload =
      deleting.scope === "app"
        ? { scope: "app" }
        : { scope: deleting.scope, scopeId: deleting.scopeId }
    const result = await remove.execute(payload)
    if (result === undefined) return
    setConfirming(false)
  }

  return (
    <section className="flex flex-col gap-6">
      <HeraldHeader
        title="Routing"
        description="Herald picks a provider per channel from the user's rule, then the org's, then the app's, then the first enabled provider by priority."
        actions={<Button onClick={() => openRule(null)}>Add a rule</Button>}
      />
      <WhoSends channels={info.data?.channels ?? []} />
      <QueryBoundary title="Routing rules" query={rules} skeletonRows={4}>
        {(data) => (
          <div className="flex flex-col gap-6">
            {LEVELS.map(({ scope, heading }) => {
              const level = data.rules.filter((r) => r.scope === scope)
              return (
                <section key={scope} className="flex flex-col gap-3">
                  <h2 className="text-sm font-medium">{heading}</h2>
                  {level.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {scope === "app"
                        ? "No app rule. Each channel falls back to its first enabled provider."
                        : `No ${scope} rules.`}
                    </p>
                  ) : (
                    level.map((rule) => (
                      <RuleCard
                        key={rule.id}
                        rule={rule}
                        providers={providers.data?.providers ?? []}
                        onEdit={() => openRule(rule)}
                        onDelete={() => openDelete(rule)}
                      />
                    ))
                  )}
                </section>
              )
            })}
          </div>
        )}
      </QueryBoundary>
      {session.count > 0 && (
        <RuleDialog
          key={session.count}
          open={session.open}
          rule={editing}
          providers={providers}
          onClose={() => setSession((s) => ({ ...s, open: false }))}
        />
      )}
      <ConfirmDialog
        open={confirming}
        onOpenChange={(open) =>
          !open && !remove.loading && setConfirming(false)
        }
        title={
          deleting?.scope === "app"
            ? "Delete the app rule?"
            : `Delete the ${deleting?.scope ?? ""} rule for ${deleting?.scopeId ?? ""}?`
        }
        description="Sends that matched it fall through to the next level. This cannot be undone."
        confirmLabel="Delete"
        pending={remove.loading}
        onConfirm={() => void confirmDelete()}
      >
        <CommandAlert error={remove.error} title="Could not delete the rule" />
      </ConfirmDialog>
    </section>
  )
}
