import { useQuery } from "@forge-go/dashboard-plugin"
import { DescriptionList } from "@forge-go/dashboard-kit/components/detail-layout"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { TagList } from "@forge-go/dashboard-kit/components/tag-list"
import type { SettingsDetail } from "../types"

/**
 * The extension's running configuration. Read-only: it comes from YAML and
 * options at start-up and nothing changes it at runtime. It answers even with
 * no app selected, which is when an operator most needs to see why every
 * other page refuses.
 */
export function LedgerSettingsPage() {
  const settings = useQuery<SettingsDetail>("settings.detail")
  return (
    <section className="flex flex-col gap-6">
      <PageHeader
        title="Settings"
        description="Read-only. Everything here comes from the extension's configuration and takes effect on restart."
      />
      <QueryBoundary title="Settings" query={settings} skeletonRows={6}>
        {(s) => (
          <div className="flex max-w-2xl flex-col gap-4">
            {s.app_id === "" && (
              <p role="status" className="text-sm text-muted-foreground">
                No app is configured and this request carried no app claim.
                Every billing page needs an app, so they all refuse until one is
                set.
              </p>
            )}
            <DescriptionList
              items={[
                {
                  term: "App",
                  value: s.app_id ? (
                    <span className="font-mono text-xs">{s.app_id}</span>
                  ) : (
                    <NoneCell label="configured app" />
                  ),
                },
                {
                  term: "Requires an app claim",
                  value: s.require_app_claim ? "Yes" : "No",
                },
                {
                  term: "Meter batch size",
                  value: (
                    <span className="tabular-nums">{s.meter_batch_size}</span>
                  ),
                },
                {
                  term: "Meter flush interval",
                  value: (
                    <span className="font-mono text-xs">
                      {s.meter_flush_interval}
                    </span>
                  ),
                },
                {
                  term: "Entitlement cache",
                  value: (
                    <span className="font-mono text-xs">
                      {s.entitlement_cache_ttl}
                    </span>
                  ),
                },
                {
                  term: "Lifecycle clock",
                  value: <LifecycleClock interval={s.lifecycle_interval} />,
                },
                {
                  term: "Payment providers",
                  value: (
                    <TagList
                      values={s.providers ?? []}
                      label="payment providers"
                    />
                  ),
                },
                {
                  term: "Invoice formats",
                  value: (
                    <TagList
                      values={s.invoice_formats ?? []}
                      label="invoice formats"
                    />
                  ),
                },
              ]}
            />
          </div>
        )}
      </QueryBoundary>
    </section>
  )
}

/** The lifecycle clock's interval, "Off", or a dash from a ledger that predates the clock. */
function LifecycleClock({ interval }: { interval?: string }) {
  if (interval === undefined) return <NoneCell label="lifecycle clock" />
  if (interval === "off") return <>Off (built-in clock)</>
  return <span className="font-mono text-xs">Every {interval}</span>
}
