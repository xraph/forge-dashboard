import { lazy } from "react"
import { definePlugin } from "@forge-go/dashboard-plugin"
import {
  ChartColumnIcon,
  HouseIcon,
  KeyRoundIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  TagsIcon,
} from "@forge-go/dashboard-kit/icons"
import { KeyDetailPage } from "./pages/key-detail"
import { KeysPage } from "./pages/keys"
import { OverviewPage } from "./pages/overview"
import { PoliciesPage } from "./pages/policies"
import { PolicyDetailPage } from "./pages/policy-detail"
import { RotationsPage } from "./pages/rotations"
import { ScopesPage } from "./pages/scopes"

// Lazy, and exported from nowhere here: Recharts lives in the chunk this
// loads, the one Ledger's Usage and Chronicle's Activity share. A static
// import from this file would put it in the shell's entry chunk.
const UsagePage = lazy(() => import("./pages/usage"))

export {
  KeyDetailPage,
  KeysPage,
  OverviewPage,
  PoliciesPage,
  PolicyDetailPage,
  RotationsPage,
  ScopesPage,
}
export { KeyStateBadge, RotationReasonBadge } from "./badges"
export {
  bucketTick,
  bucketTitle,
  ENVIRONMENTS,
  formatCount,
  formatLatency,
  formatRateLimit,
  keyPath,
  maskedKey,
  policyPath,
  REASON_LABEL,
  ROTATION_REASONS,
  rangeBounds,
  rotationMasked,
  splitDuration,
  STATE_LABEL,
  STATES,
  toSeconds,
  USAGE_RANGES,
} from "./format"
export type { DurationUnit, UsageRange, UsageRangeId } from "./format"
export type {
  Environment,
  KeyDetail,
  KeysList,
  KeyState,
  KeySummary,
  Overview,
  OverviewCounts,
  PoliciesList,
  PolicyDetail,
  PolicyDetailResponse,
  PolicyFields,
  PolicyRef,
  PolicySummary,
  PreviousKey,
  RotationItem,
  RotationReason,
  RotationsList,
  ScopesList,
  ScopeSummary,
  UsageBucket,
  UsagePeriod,
  UsageRecordItem,
  UsageRecords,
  UsageSeries,
} from "./types"

/**
 * The first-party UI for the `keysmith` extension.
 *
 * `extension` is "keysmith", the Go contributor name from the keysmith
 * contract manifest. It is the join key the host looks up in the
 * capabilities response, and `test/plugin.test.tsx` checks it by resolving
 * against a capabilities document rather than comparing the string to itself.
 * A wrong name resolves to `hidden` with nothing logged.
 *
 * No `requires` range: a range the host skips for a contributor that reports
 * no version reads as a guarantee and enforces nothing.
 */
export const keysmithPlugin = definePlugin({
  extension: "keysmith",
  namespace: "keysmith",
  label: "Keysmith",
  nav: [
    // First in the group. Which page the plugin opens on is the host's call.
    {
      label: "Overview",
      to: "/overview",
      priority: -1,
      icon: <HouseIcon />,
      group: "API keys",
    },
    {
      label: "Keys",
      to: "/keys",
      priority: 0,
      icon: <KeyRoundIcon />,
      group: "API keys",
    },
    {
      label: "Policies",
      to: "/policies",
      priority: 1,
      icon: <ShieldCheckIcon />,
      group: "API keys",
    },
    {
      label: "Scopes",
      to: "/scopes",
      priority: 2,
      icon: <TagsIcon />,
      group: "API keys",
    },
    {
      label: "Rotations",
      to: "/rotations",
      priority: 3,
      icon: <RefreshCwIcon />,
      group: "API keys",
    },
    {
      label: "Usage",
      to: "/usage",
      priority: 4,
      icon: <ChartColumnIcon />,
      group: "API keys",
    },
  ],
  routes: [
    { path: "/overview", element: OverviewPage },
    { path: "/keys", element: KeysPage },
    // No nav entry: a sidebar link to "a key" with none chosen points
    // nowhere. It is reached from the list's row links.
    { path: "/keys/:id", element: KeyDetailPage },
    { path: "/policies", element: PoliciesPage },
    // No nav entry, like a key: reached from the policies list and from the
    // policy names on the key list.
    { path: "/policies/:id", element: PolicyDetailPage },
    { path: "/scopes", element: ScopesPage },
    { path: "/rotations", element: RotationsPage },
    { path: "/usage", element: UsagePage },
  ],
})

export default keysmithPlugin
