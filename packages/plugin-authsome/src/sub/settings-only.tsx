import { defineSubPlugin } from "@forge-go/dashboard-plugin"
import type { ForgeSubPlugin } from "@forge-go/dashboard-plugin"
import { SETTINGS_INTENTS, settingsPanelFor } from "./settings-panel"

interface SettingsOnlyRow {
  /** The Go contributor name. Decides whether any of this renders. */
  extension: string
  /** The settings namespace. Equal to `extension` in all eighteen today. */
  namespace: string
  label: string
  route: string
  group: string
  priority: number
  /** Short label for the settings tab, where the full name does not fit. */
  tab: string
}

/**
 * Copied from `plugins/<name>/contract/manifest.yaml` in the authsome
 * repository. Route, group and priority are Go's to decide, not this file's.
 *
 * The legacy `dashboard.go` nav disagrees with several of these. Where it does,
 * the manifest wins: it is the contributor system's own declaration and it is
 * what the capabilities response is built from.
 */
export const SETTINGS_ONLY: SettingsOnlyRow[] = [
  { extension: "riskengine", namespace: "riskengine", label: "Risk Engine", route: "/security/risk", group: "Security", priority: 0, tab: "Risk" },
  { extension: "anomaly", namespace: "anomaly", label: "Anomaly Detection", route: "/security/anomaly", group: "Security", priority: 1, tab: "Anomaly" },
  { extension: "geoip", namespace: "geoip", label: "Geo IP", route: "/security/geoip", group: "Security", priority: 2, tab: "Geo IP" },
  { extension: "geofence", namespace: "geofence", label: "Geofencing", route: "/security/geofence", group: "Security", priority: 3, tab: "Geofencing" },
  { extension: "impossibletravel", namespace: "impossibletravel", label: "Impossible Travel", route: "/security/impossible-travel", group: "Security", priority: 4, tab: "Impossible Travel" },
  { extension: "ipreputation", namespace: "ipreputation", label: "IP Reputation", route: "/security/ip-reputation", group: "Security", priority: 5, tab: "IP Reputation" },
  { extension: "vpndetect", namespace: "vpndetect", label: "VPN Detect", route: "/security/vpn-detect", group: "Security", priority: 6, tab: "VPN" },
  { extension: "deviceverify", namespace: "deviceverify", label: "Device Verify", route: "/security/device-verify", group: "Security", priority: 7, tab: "Devices" },
  { extension: "email", namespace: "email", label: "Email", route: "/auth/email", group: "Auth", priority: 1, tab: "Email" },
  { extension: "phone", namespace: "phone", label: "Phone", route: "/auth/phone", group: "Auth", priority: 2, tab: "Phone" },
  { extension: "magiclink", namespace: "magiclink", label: "Magic Link", route: "/auth/magiclink", group: "Auth", priority: 3, tab: "Magic Link" },
  { extension: "mfa", namespace: "mfa", label: "Multi-Factor Auth", route: "/auth/mfa", group: "Auth", priority: 4, tab: "MFA" },
  { extension: "passkey", namespace: "passkey", label: "Passkeys", route: "/auth/passkeys", group: "Auth", priority: 5, tab: "Passkeys" },
  { extension: "social", namespace: "social", label: "Social Login", route: "/auth/social", group: "Auth", priority: 6, tab: "Social" },
  { extension: "oauth2provider", namespace: "oauth2provider", label: "OAuth2 Provider", route: "/auth/oauth2", group: "Auth", priority: 7, tab: "OAuth2" },
  { extension: "scim", namespace: "scim", label: "SCIM", route: "/enterprise/scim", group: "Enterprise", priority: 0, tab: "SCIM" },
  { extension: "sso", namespace: "sso", label: "SSO", route: "/enterprise/sso", group: "Enterprise", priority: 1, tab: "SSO" },
  { extension: "notification", namespace: "notification", label: "Notifications", route: "/notifications", group: "Configuration", priority: 3, tab: "Notifications" },
]

/**
 * Eighteen declarations, one component each.
 *
 * `settingsPanelFor` is called once per row and the SAME component instance is
 * used for the route and for the settings tab. Two calls would give two
 * component types rendering identical panels, and React would treat them as
 * unrelated: two mounts, two identical requests, and no way to tell from the
 * screen that it happened.
 */
export const settingsOnlySubPlugins: ForgeSubPlugin[] = SETTINGS_ONLY.map((row) => {
  const Panel = settingsPanelFor(row.namespace)
  return defineSubPlugin({
    extension: row.extension,
    host: "auth",
    label: row.label,
    nav: [{ label: row.label, to: row.route, group: row.group, priority: row.priority }],
    routes: [{ path: row.route, element: Panel }],
    hostIntents: [...SETTINGS_INTENTS],
    contributions: {
      // Still the exact same component instance used for the route above,
      // which is what the "same instance" test in settings-only.test.tsx
      // checks for.
      "settings.tabs": [{ id: row.extension, label: row.tab, render: Panel }],
    },
  })
})
