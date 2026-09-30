import { EmptyState } from "@forge-go/dashboard-kit/components/empty-state"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import type { AuditEntry } from "../flag-types"

/**
 * What the audit log says happened lately: the action, its outcome, who did
 * it, and when. The config page uses it for one entry's history; the overview
 * uses it for the whole vault, where `showKey` names what each row was about.
 *
 * A failure row shows its error under the line, so a failed rotation says why
 * here rather than only that it failed. A row with no user shows none: an app
 * write has no user, and the list never invents one.
 */
export function RecentActivity({
  entries,
  showKey = false,
}: {
  entries: AuditEntry[]
  showKey?: boolean
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">Recent activity</h2>
      {entries.length === 0 ? (
        <EmptyState title="No recorded activity yet." />
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {entries.map((e) => (
            <li key={e.id} className="flex flex-col">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-mono text-xs">{e.action}</span>
                  {showKey && e.key ? (
                    <span className="font-mono text-xs">{e.key}</span>
                  ) : null}
                  <span className="text-muted-foreground">{e.outcome}</span>
                  {e.userId ? (
                    <span className="font-mono text-xs text-muted-foreground">{e.userId}</span>
                  ) : null}
                  {e.tenantId ? (
                    <span className="font-mono text-xs text-muted-foreground">{e.tenantId}</span>
                  ) : null}
                </span>
                <Timestamp value={e.createdAt} label="time" className="text-muted-foreground" />
              </div>
              {e.error ? (
                <span className="text-xs text-destructive">{e.error}</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
