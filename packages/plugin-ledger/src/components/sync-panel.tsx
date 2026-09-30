import { useCommand } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { DescriptionList } from "@forge-go/dashboard-kit/components/detail-layout"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { CommandAlert } from "@forge-go/dashboard-kit/components/query-boundary"
import type { SyncResult } from "../types"

/**
 * Where a record stands with the payment provider, and a button to push it.
 *
 * Four outcomes, each worded differently. Success. A refusal, which the
 * contract answers as a normal result with success false and the provider's
 * own words, because the operator needs those words. UNAVAILABLE, which means
 * no provider is registered at all, and is a fact about the deployment rather
 * than a failure. And any other error.
 */
export function SyncPanel({ intent, id, providerName, providerId }: { intent: string; id: string; providerName?: string; providerId?: string }) {
  const sync = useCommand<SyncResult>(intent)
  const result = sync.data
  const noProvider = sync.error?.code === "UNAVAILABLE"

  return (
    <section className="flex flex-col gap-3" aria-label="Payment provider">
      <h2 className="text-sm font-medium">Payment provider</h2>
      <DescriptionList
        items={[
          { term: "Provider", value: providerName || <NoneCell label="provider" /> },
          { term: "Provider ID", value: providerId ? <span className="font-mono text-xs">{providerId}</span> : <NoneCell label="provider ID" /> },
        ]}
      />
      {/* One live region that is always mounted, so a screen reader hears the text that appears in it. */}
      <div aria-live="polite" className="flex flex-col gap-1">
        {result?.success === true && <p className="text-sm text-muted-foreground">Synced to {result.provider_name}.</p>}
        {noProvider && (
          <>
            <p className="text-sm text-muted-foreground">No payment provider is configured, so there is nothing to sync to.</p>
            {/* UNAVAILABLE also covers an unregistered stored provider and a store that is not ready, so say what the server said. */}
            <p className="text-xs text-muted-foreground">{sync.error?.message}</p>
          </>
        )}
      </div>
      {result?.success === false && (
        <p role="alert" className="text-sm text-destructive">
          Sync failed: {result.error || "the provider gave no reason"}
        </p>
      )}
      {!noProvider && <CommandAlert error={sync.error} title="Could not sync" />}
      <div>
        <Button variant="outline" size="sm" disabled={sync.loading} onClick={() => void sync.execute({ id })}>
          {sync.loading ? "Syncing…" : "Sync to provider"}
        </Button>
      </div>
    </section>
  )
}
