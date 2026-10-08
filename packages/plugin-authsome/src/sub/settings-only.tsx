import { defineSubPlugin } from "@forge-go/dashboard-plugin"
import type { ForgeSubPlugin } from "@forge-go/dashboard-plugin"
import {
  FingerprintIcon,
  MapPinIcon,
  NetworkIcon,
  ShieldAlertIcon,
} from "@forge-go/dashboard-kit/icons"
import { SETTINGS_INTENTS, settingsPanelFor } from "./settings-panel"

const NAV_CLUSTERS = {
  detection: { label: "Threat detection", icon: <ShieldAlertIcon /> },
  location: { label: "Location security", icon: <MapPinIcon /> },
  passwordless: { label: "Passwordless", icon: <FingerprintIcon /> },
  federation: { label: "Federation", icon: <NetworkIcon /> },
} as const

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
  cluster?: keyof typeof NAV_CLUSTERS
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
  {
    extension: "riskengine",
    namespace: "riskengine",
    label: "Risk Engine",
    route: "/security/risk",
    group: "Security",
    priority: 0,
    tab: "Risk",
    cluster: "detection",
  },
  {
    extension: "anomaly",
    namespace: "anomaly",
    label: "Anomaly",
    route: "/security/anomaly",
    group: "Security",
    priority: 1,
    tab: "Anomaly",
    cluster: "detection",
  },
  {
    extension: "geoip",
    namespace: "geoip",
    label: "Geo IP",
    route: "/security/geoip",
    group: "Security",
    priority: 2,
    tab: "Geo IP",
    cluster: "location",
  },
  {
    extension: "geofence",
    namespace: "geofence",
    label: "Geofence",
    route: "/security/geofence",
    group: "Security",
    priority: 3,
    tab: "Geofencing",
    cluster: "location",
  },
  {
    extension: "impossibletravel",
    namespace: "impossibletravel",
    label: "Impossible Travel",
    route: "/security/impossible-travel",
    group: "Security",
    priority: 4,
    tab: "Impossible Travel",
    cluster: "detection",
  },
  {
    extension: "ipreputation",
    namespace: "ipreputation",
    label: "IP Reputation",
    route: "/security/ip-reputation",
    group: "Security",
    priority: 5,
    tab: "IP Reputation",
    cluster: "detection",
  },
  {
    extension: "vpndetect",
    namespace: "vpndetect",
    label: "VPN Detect",
    route: "/security/vpn-detect",
    group: "Security",
    priority: 6,
    tab: "VPN",
    cluster: "detection",
  },
  {
    extension: "deviceverify",
    namespace: "deviceverify",
    label: "Device Verify",
    route: "/security/device-verify",
    group: "Security",
    priority: 7,
    tab: "Devices",
  },
  {
    extension: "email",
    namespace: "email",
    label: "Email",
    route: "/auth/email",
    group: "Authentication",
    priority: 1,
    tab: "Email",
  },
  {
    extension: "phone",
    namespace: "phone",
    label: "Phone",
    route: "/auth/phone",
    group: "Authentication",
    priority: 2,
    tab: "Phone",
  },
  {
    extension: "magiclink",
    namespace: "magiclink",
    label: "Magic Link",
    route: "/auth/magiclink",
    group: "Authentication",
    priority: 3,
    tab: "Magic Link",
    cluster: "passwordless",
  },
  {
    extension: "mfa",
    namespace: "mfa",
    label: "MFA",
    route: "/auth/mfa",
    group: "Authentication",
    priority: 4,
    tab: "MFA",
  },
  {
    extension: "passkey",
    namespace: "passkey",
    label: "Passkey",
    route: "/auth/passkeys",
    group: "Authentication",
    priority: 5,
    tab: "Passkeys",
    cluster: "passwordless",
  },
  {
    extension: "social",
    namespace: "social",
    label: "Social",
    route: "/auth/social",
    group: "Authentication",
    priority: 6,
    tab: "Social",
    cluster: "federation",
  },
  {
    extension: "oauth2provider",
    namespace: "oauth2provider",
    label: "OAuth2 Provider",
    route: "/auth/oauth2",
    group: "Authentication",
    priority: 7,
    tab: "OAuth2",
    cluster: "federation",
  },
  {
    extension: "scim",
    namespace: "scim",
    label: "SCIM",
    route: "/enterprise/scim",
    group: "Enterprise",
    priority: 0,
    tab: "SCIM",
  },
  {
    extension: "sso",
    namespace: "sso",
    label: "SSO",
    route: "/enterprise/sso",
    group: "Enterprise",
    priority: 1,
    tab: "SSO",
  },
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
export const settingsOnlySubPlugins: ForgeSubPlugin[] = SETTINGS_ONLY.map(
  (row) => {
    const Panel = settingsPanelFor(row.namespace, row.label)
    return defineSubPlugin({
      extension: row.extension,
      host: "authsome",
      label: row.label,
      nav: [
        {
          label: row.label,
          to: row.route,
          group: row.group,
          priority: row.priority,
          cluster: row.cluster ? NAV_CLUSTERS[row.cluster] : undefined,
        },
      ],
      routes: [{ path: row.route, element: Panel }],
      hostIntents: [...SETTINGS_INTENTS],
      contributions: {
        // Still the exact same component instance used for the route above,
        // which is what the "same instance" test in settings-only.test.tsx
        // checks for.
        "settings.tabs": [{ id: row.extension, label: row.tab, render: Panel }],
      },
    })
  }
)
