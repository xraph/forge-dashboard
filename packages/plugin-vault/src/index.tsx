import { definePlugin } from "@forge-go/dashboard-plugin"
import { FlagIcon, KeyRoundIcon, RefreshCwIcon } from "@forge-go/dashboard-kit/icons"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { PluginLink } from "@forge-go/dashboard-plugin"
import type { ComponentType } from "react"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { FlagCreatePage } from "./pages/flag-create"
import { FlagsPage } from "./pages/flags"
import { RotationDetailPage } from "./pages/rotation-detail"
import { RotationPage } from "./pages/rotation"
import { SecretCreatePage } from "./pages/secret-create"
import { SecretDetailPage } from "./pages/secret-detail"
import { SecretsPage } from "./pages/secrets"

export {
  FlagCreatePage,
  FlagsPage,
  RotationDetailPage,
  RotationPage,
  SecretCreatePage,
  SecretDetailPage,
  SecretsPage,
}
export {
  DecidedHereBadge,
  EncryptionBadge,
  FlagEnabledBadge,
  FlagTypeBadge,
  NeverMatchesBadge,
  NotReachedBadge,
  PolicyStatusBadge,
  RotatorBadge,
  WrongTypeBadge,
} from "./badges"
export { FlagValue } from "./components/flag-value"
export { ValueInput } from "./components/value-input"
export { FLAG_TYPES } from "./flag-types"
export type { FlagType } from "./flag-types"
export { flagPath, rotationPath, secretPath } from "./keys"

/**
 * Stands in for the flag detail page until it lands, so a key in the list has
 * somewhere to go. It says so instead of rendering an empty ladder.
 */
const FlagDetailPlaceholder: ComponentType<PluginPageProps> = ({ params }) => (
  <div className="flex flex-col gap-4">
    <PageHeader
      title={params.key ?? "Flag"}
      description="The page for a single flag is not available yet."
    />
    <p className="text-sm">
      <PluginLink to="/flags" className="underline">
        Back to flags
      </PluginLink>
    </p>
  </div>
)

/**
 * The first-party UI for the `vault` extension.
 *
 * `extension` is "vault", the Go contributor name from
 * `vault/extension/contract/manifest.yaml`. It is the join key the host looks
 * up in the capabilities response, and `test/plugin.test.tsx` checks it by
 * resolving against a capabilities document rather than comparing the string
 * to itself.
 *
 * No `requires` range, for the same reason warden has none: a range the host
 * skips for a contributor that reports no version reads as a guarantee and
 * enforces nothing.
 */
export const vaultPlugin = definePlugin({
  extension: "vault",
  namespace: "vault",
  label: "Vault",
  nav: [
    {
      label: "Secrets",
      to: "/secrets",
      priority: 0,
      icon: <KeyRoundIcon />,
      group: "Secrets",
    },
    {
      label: "Rotation",
      to: "/rotation",
      priority: 10,
      icon: <RefreshCwIcon />,
      group: "Secrets",
    },
    {
      label: "Flags",
      to: "/flags",
      priority: 20,
      icon: <FlagIcon />,
      group: "Flags",
    },
  ],
  routes: [
    // "/" shows the secrets list until the overview page replaces it.
    { path: "/", element: SecretsPage },
    { path: "/secrets", element: SecretsPage },
    // No nav entries for the next three: a sidebar link to "a secret" with
    // none chosen points nowhere. They are reached from row links and buttons.
    // Create lives at /new-secret, not /secrets/new: a secret whose key is
    // literally "new" encodes to /secrets/new and would never be reachable.
    { path: "/new-secret", element: SecretCreatePage },
    { path: "/secrets/:key", element: SecretDetailPage },
    { path: "/rotation", element: RotationPage },
    { path: "/rotation/:key", element: RotationDetailPage },
    { path: "/flags", element: FlagsPage },
    // Create lives at /new-flag for the same reason /new-secret does: a flag
    // keyed "new" encodes to /flags/new.
    { path: "/new-flag", element: FlagCreatePage },
    { path: "/flags/:key", element: FlagDetailPlaceholder },
  ],
})

export default vaultPlugin
