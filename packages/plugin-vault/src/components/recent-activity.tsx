import { EmptyState } from "@forge-go/dashboard-kit/components/empty-state"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import type { AuditEntry } from "../flag-types"

/**
 * What the audit log says happened to one thing lately: the action, its
 * outcome, who did it, and when. The flag page carries the same list inline;
 * this is the copy the config page uses, and the flag page can move onto it.
 */
export function RecentActivity({ entries }: { entries: AuditEntry[] }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">Recent activity</h2>
      {entries.length === 0 ? (
        <EmptyState title="No recorded activity yet." />
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {entries.map((e) => (
            <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-mono text-xs">{e.action}</span>
                <span className="text-muted-foreground">{e.outcome}</span>
                {e.userId ? (
                  <span className="font-mono text-xs text-muted-foreground">{e.userId}</span>
                ) : null}
              </span>
              <Timestamp value={e.createdAt} label="time" className="text-muted-foreground" />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
