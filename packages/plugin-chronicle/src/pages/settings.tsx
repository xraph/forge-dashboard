import type { ComponentType } from "react"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { DescriptionList } from "@forge-go/dashboard-kit/components/detail-layout"
import { useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import type { SettingsDetail } from "../types"
import { durationLabel } from "../format"

export const SettingsPage: ComponentType<PluginPageProps> = () => {
  const q = useQuery<SettingsDetail>("settings.detail")
  return (
    <section className="flex min-w-0 flex-col gap-4">
      <PageHeader
        title="Settings"
        description="How this deployment records and proves its audit trail. Read-only: these come from the extension's configuration."
      />
      <QueryBoundary title="settings" query={q} skeletonRows={6}>
        {(s) => (
          <>
            <p className="max-w-prose text-sm">{postureSentence(s)}</p>
            {/* A scheme read here is easily taken as the scheme every event carries, including ones recorded before it was set. */}
            <p className="max-w-prose text-sm">
              The digest scheme applies to new events only: events already
              recorded keep the scheme they were written with, and the Chain
              page shows where each chain's current scheme begins.
            </p>
            <DescriptionList
              items={[
                {
                  term: "Digest scheme",
                  value: (
                    <span className="font-mono text-xs">{s.digestScheme}</span>
                  ),
                },
                { term: "Keyed", value: s.keyed ? "Yes" : "No" },
                {
                  term: "Checkpoints",
                  value: s.checkpointingConfigured
                    ? "Taken and signed"
                    : "Not taken",
                },
                {
                  term: "Backend",
                  value: (
                    <span className="font-mono text-xs">{s.backendName}</span>
                  ),
                },
                {
                  term: "Backend can store checkpoints",
                  value: s.backendHoldsCheckpoints
                    ? "Yes"
                    : "No: this backend cannot store checkpoints",
                },
                {
                  term: "Crypto-erasure",
                  value: s.enableCryptoErasure ? "Enabled" : "Not enabled",
                },
                { term: "Batch size", value: String(s.batchSize) },
                {
                  term: "Flush interval",
                  value: (
                    <span className="font-mono text-xs">{s.flushInterval}</span>
                  ),
                },
                {
                  term: "Retention runs every",
                  value: durationLabel(s.retentionInterval),
                },
              ]}
            />
          </>
        )}
      </QueryBoundary>
    </section>
  )
}

/** What this configuration can and cannot show, in one paragraph. */
function postureSentence(s: SettingsDetail): string {
  const digest = s.keyed
    ? "Keyed digests detect deliberate alteration by anyone who does not hold the key."
    : "Unkeyed digests detect accidental corruption, not deliberate alteration: anyone who can write the database can recompute them."
  const checkpoints = s.checkpointingConfigured
    ? "Signed checkpoints also prove a range has not been rewritten or truncated since it was signed."
    : "No checkpoints are taken, so a truncated tail cannot be detected."
  return `${digest} ${checkpoints}`
}
