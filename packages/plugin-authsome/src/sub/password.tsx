import { defineSubPlugin, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { DescriptionList } from "@forge-go/dashboard-kit/components/detail-layout"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { SETTINGS_INTENTS, settingsPanelFor } from "./settings-panel"

/** `password.policy`'s answer shape, from handlers_password.go. */
export interface PasswordPolicy {
  minLength: number
  requireSpecial: boolean
  hashAlgorithm: string
}

/**
 * Bound once at module scope, exactly as `settings-only.tsx` does, so the
 * route body and the `settings.tabs` contribution below render the SAME
 * component instance. Two calls here would mint two component types for one
 * identical panel: two mounts, two identical `settings.namespace` reads, and
 * nothing on screen to say why.
 */
const PasswordSettingsPanel = settingsPanelFor("password")

/**
 * The policy summary above the settings that set it.
 *
 * `password.policy` is read-only and answers this sub-plugin's own extension:
 * one query, no commands. The values it summarizes are written through the
 * auth contributor's `settings.update`, reached below through `hostIntents`,
 * not through this plugin -- so this page never edits, it only explains what
 * the form beneath it is about to change.
 */
export function PasswordPolicyPage({ params }: PluginPageProps) {
  const query = useQuery<PasswordPolicy>("password.policy")

  return (
    <div className="flex flex-col gap-6">
      <QueryBoundary title="Password policy" query={query}>
        {(policy) => (
          <DescriptionList
            items={[
              {
                term: "Minimum password length",
                value:
                  policy.minLength > 0
                    ? `${policy.minLength} characters`
                    : // 0 means unset, not "empty passwords allowed". Saying so
                      // in plain digits reads as the latter.
                      "Engine default",
              },
              {
                term: "Require special character",
                value: (
                  <Badge variant={policy.requireSpecial ? "outline" : "secondary"}>
                    {policy.requireSpecial ? "Required" : "Optional"}
                  </Badge>
                ),
              },
              {
                term: "Hash algorithm",
                value: (
                  <span className="flex items-center gap-1.5">
                    <span>{policy.hashAlgorithm}</span>
                    {/*
                      This is hardcoded server-side and never reads engine
                      config. Labelling it "in effect" would present a
                      constant as a live reading, which is how somebody ends
                      up making a decision on it.
                    */}
                    <span className="text-xs text-muted-foreground">
                      (as compiled)
                    </span>
                  </span>
                ),
              },
            ]}
          />
        )}
      </QueryBoundary>
      <PasswordSettingsPanel params={params} />
    </div>
  )
}

export const passwordSubPlugin = defineSubPlugin({
  extension: "password",
  host: "auth",
  label: "Password",
  nav: [{ label: "Password", to: "/auth/password", group: "Auth", priority: 0 }],
  routes: [{ path: "/auth/password", element: PasswordPolicyPage }],
  // Its own policy read needs nothing from the host. The panel below it does.
  hostIntents: [...SETTINGS_INTENTS],
  contributions: {
    "settings.tabs": [
      {
        id: "password",
        label: "Password",
        // Still the exact same instance used for the route above.
        render: PasswordSettingsPanel,
      },
    ],
  },
})
