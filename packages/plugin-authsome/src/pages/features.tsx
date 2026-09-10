import { useState } from "react"
import { useCommand, useQuery } from "@forge-go/dashboard-plugin"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import {
  CommandAlert,
  QueryBoundary,
} from "@forge-go/dashboard-kit/components/query-boundary"
import { Switch } from "@forge-go/dashboard-kit/components/switch"
import type { AckResponse } from "./users"

/** `auth.featureToggles`. */
export interface FeatureToggle {
  key: string
  label: string
  description?: string
  enabled: boolean
  available: boolean
}

export interface FeatureTogglesResponse {
  toggles: FeatureToggle[]
}

/**
 * Nine sign-in features, each a switch bound to `auth.toggleFeature`.
 *
 * Two things this page is careful about.
 *
 * First, `available: false` is not a reason to hide a row. It renders
 * disabled, with its description shown as the reason, because that is how an
 * operator learns MFA is off because the plugin backing it is not installed
 * rather than because somebody switched it off. Hiding the row answers "why
 * can I not turn on MFA" with silence, which is worse than any honest answer.
 *
 * Second, the switch is bound to `t.enabled` off the query result, never to
 * local state. A failed `auth.toggleFeature` throws a `ContractError`, the
 * command never invalidates, the query never refetches, and the switch is
 * still rendering the same server value it always was - so "leaves the
 * switch where it was" falls out of not having a local copy to leave in the
 * wrong place, the same shape `presence.tsx` in plugin-streaming uses for its
 * own status control.
 *
 * One `useCommand` covers every row, which raises a question this page has to
 * answer rather than ignore: can a failed toggle on one row still be showing
 * while the operator is looking at another? Without care, yes - the hook's
 * `error` is one value shared by every switch, so a failure attributed to MFA
 * would still be on screen, mis-attributed, after the operator moved on to
 * toggle passkeys. This page tracks which row the in-flight or last-failed
 * attempt belongs to, and resets the command the moment a *different* row is
 * touched, before that row's own request even goes out. So the error a
 * switch's neighbourhood shows is always about the row the operator is
 * currently acting on, never a stale one left over from a row they have
 * already moved past.
 */
export function AuthFeaturesPage() {
  const query = useQuery<FeatureTogglesResponse>("auth.featureToggles")
  const toggle = useCommand<AckResponse>("auth.toggleFeature")
  const [attempted, setAttempted] = useState<FeatureToggle | null>(null)

  async function handleToggle(row: FeatureToggle, enabled: boolean) {
    if (attempted?.key !== row.key) toggle.reset()
    setAttempted(row)
    await toggle.execute({ key: row.key, enabled })
  }

  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title="Features"
        description="Sign-in features this app can turn on."
      />

      <CommandAlert
        error={toggle.error}
        title={`Could not toggle ${attempted?.label ?? "feature"}`}
      />

      <QueryBoundary title="Features" query={query} skeletonRows={4}>
        {(data) => {
          const toggles = data.toggles ?? []
          return (
            <ul className="flex flex-col gap-2">
              {toggles.map((row) => (
                <li
                  key={row.key}
                  className="flex items-start justify-between gap-4 rounded-md border p-3"
                >
                  <div className="flex flex-col gap-0.5">
                    <Label id={`feature-${row.key}-label`}>{row.label}</Label>
                    {row.available ? (
                      row.description && (
                        <p className="text-sm text-muted-foreground">{row.description}</p>
                      )
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Not available{row.description ? `: ${row.description}` : "."}
                      </p>
                    )}
                  </div>
                  <Switch
                    id={`feature-${row.key}`}
                    aria-labelledby={`feature-${row.key}-label`}
                    checked={row.enabled}
                    disabled={!row.available || toggle.loading}
                    onCheckedChange={(checked) => void handleToggle(row, checked)}
                  />
                </li>
              ))}
            </ul>
          )
        }}
      </QueryBoundary>
    </section>
  )
}
