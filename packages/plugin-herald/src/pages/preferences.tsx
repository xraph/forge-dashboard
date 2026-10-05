import { useState } from "react"
import type { ComponentType } from "react"
import { useCommand, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { CommandAlert, QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable, type Column } from "@forge-go/dashboard-kit/components/resource-table"
import { HeraldHeader } from "../components/herald-header"
import { plural, PREF_CHANNELS } from "../format"
import { useDebounced } from "../use-debounced"
import type { ChannelPreferenceWire, PrefChannel, PreferencesGetResponse, PreferencesOptOutResponse } from "../wire"

interface TypeRow {
  type: string
  prefs?: ChannelPreferenceWire
}

/** Everything the confirm talks about, taken when it opens so a refetch cannot change its words. */
interface Target {
  userId: string
  type: string
  channel: PrefChannel
}

/** null and a missing record are both Default: nothing stored means Herald sends. Never "On" by assumption. */
function stateLabel(value: boolean | null | undefined): string {
  if (value === false) return "Opted out"
  if (value === true) return "On"
  return "Default"
}

/**
 * Operators can only opt a user out. A missing record means "send
 * everything", so clearing or reversing an opt-out here would re-subscribe
 * the user to things they declined. There is deliberately no control that
 * turns a channel on.
 */
export const PreferencesPage: ComponentType<PluginPageProps> = () => {
  const [typed, setTyped] = useState("")
  const userId = useDebounced(typed.trim(), 300)
  const prefs = useQuery<PreferencesGetResponse>("preferences.get", { userId }, { enabled: userId !== "" })
  const optOut = useCommand<PreferencesOptOutResponse>("preferences.optOut")
  /*
   * preferences.optOut invalidates preferences.get, and the boundary swaps
   * its children for a skeleton while that refetches (and drops its data if
   * the refetch fails). So the command, the dialog, its snapshot and the
   * success note all live out here. The snapshot stays after close so the
   * dialog keeps its words while it animates out.
   */
  const [target, setTarget] = useState<Target | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [done, setDone] = useState<Target | null>(null)

  // What happened to one user is not news about the next one. Reset when the typed user settles, not per keystroke.
  const [seenFor, setSeenFor] = useState(userId)
  if (seenFor !== userId) {
    setSeenFor(userId)
    optOut.reset()
    setDone(null)
  }

  function open(t: Target) {
    optOut.reset()
    setDone(null)
    setTarget(t)
    setConfirming(true)
  }

  async function confirm() {
    if (!target) return
    const result = await optOut.execute({ userId: target.userId, type: target.type, channel: target.channel })
    if (result === undefined) return
    setDone(target)
    setConfirming(false)
  }

  const columns: Column<TypeRow>[] = [
    { id: "type", header: "Type", className: "font-mono text-xs font-medium", cell: (r) => r.type },
    ...PREF_CHANNELS.map((channel) => ({
      id: channel,
      header: channel,
      cell: (r: TypeRow) => {
        const value = r.prefs?.[channel]
        return (
          <span className="flex items-center gap-2">
            <span className={value === false ? "text-muted-foreground" : undefined}>{stateLabel(value)}</span>
            {value !== false && (
              <Button size="xs" variant="ghost" aria-label={`Opt ${userId} out of ${r.type} by ${channel}`} onClick={() => open({ userId, type: r.type, channel })}>
                Opt out
              </Button>
            )}
          </span>
        )
      },
    })),
  ]

  return (
    <section className="flex flex-col gap-4">
      <HeraldHeader title="Preferences" description="Which notifications a user has opted out of, per channel." />
      <div className="flex max-w-sm flex-col gap-1.5">
        <Label htmlFor="pref-user">User ID</Label>
        <Input id="pref-user" className="font-mono text-xs" autoComplete="off" spellCheck={false} value={typed} onChange={(e) => setTyped(e.target.value)} />
      </div>
      <p className="text-sm text-muted-foreground">
        Opt-outs can't be undone here. A user with no record gets every notification, so reversing an opt-out has to come from the user, through your own application.
      </p>
      {done && (
        <p role="status" className="text-sm">
          {done.userId} is now opted out of {done.type} by {done.channel}.
        </p>
      )}
      {userId === "" ? (
        <p className="text-sm text-muted-foreground">Enter a user ID to see their preferences.</p>
      ) : (
        <QueryBoundary title="Preferences" query={prefs} skeletonRows={4}>
          {(data) => {
            const overrides = data.preference?.overrides ?? {}
            const types = [...new Set([...data.knownTypes, ...Object.keys(overrides)])].sort()
            const rows: TypeRow[] = types.map((type) => ({ type, prefs: overrides[type] }))
            return (
              <div className="flex flex-col gap-3">
                {data.preference === null && <p className="text-sm">No preferences recorded for {userId}, so they get every notification.</p>}
                <ResourceTable<TypeRow>
                  columns={columns}
                  rows={rows}
                  rowKey={(r) => r.type}
                  caption={`${plural(rows.length, "notification type")} for ${userId}`}
                  emptyMessage="This app has no templates and the user has no opt-outs, so there is nothing to show."
                />
              </div>
            )
          }}
        </QueryBoundary>
      )}
      <ConfirmDialog
        open={confirming}
        onOpenChange={(o) => !o && !optOut.loading && setConfirming(false)}
        title={`Opt ${target?.userId ?? ""} out of ${target?.type ?? ""} by ${target?.channel ?? ""}?`}
        description={`Herald stops sending ${target?.type ?? ""} to ${target?.userId ?? ""} by ${target?.channel ?? ""}. There's no way to opt them back in from the dashboard.`}
        confirmLabel="Opt out"
        pending={optOut.loading}
        onConfirm={() => void confirm()}
      >
        <CommandAlert error={optOut.error} title="Could not record the opt-out" />
      </ConfirmDialog>
    </section>
  )
}
