import { definePlugin } from "@forge-go/dashboard-plugin"
import { KeyRoundIcon, ShieldCheckIcon } from "@forge-go/dashboard-kit/icons"
import { KeyDetailPage } from "./pages/key-detail"
import { KeysPage } from "./pages/keys"
import { PoliciesPage } from "./pages/policies"
import { PolicyDetailPage } from "./pages/policy-detail"

export { KeyDetailPage, KeysPage, PoliciesPage, PolicyDetailPage }
export { KeyStateBadge } from "./badges"
export {
  ENVIRONMENTS,
  formatRateLimit,
  keyPath,
  maskedKey,
  policyPath,
  splitDuration,
  STATE_LABEL,
  STATES,
  toSeconds,
} from "./format"
export type { DurationUnit } from "./format"
export type {
  Environment,
  KeyDetail,
  KeysList,
  KeyState,
  KeySummary,
  PoliciesList,
  PolicyDetail,
  PolicyDetailResponse,
  PolicyFields,
  PolicyRef,
  PolicySummary,
  PreviousKey,
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
  ],
  routes: [
    { path: "/keys", element: KeysPage },
    // No nav entry: a sidebar link to "a key" with none chosen points
    // nowhere. It is reached from the list's row links.
    { path: "/keys/:id", element: KeyDetailPage },
    { path: "/policies", element: PoliciesPage },
    // No nav entry, like a key: reached from the policies list and from the
    // policy names on the key list.
    { path: "/policies/:id", element: PolicyDetailPage },
  ],
})

export default keysmithPlugin
