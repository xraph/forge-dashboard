import { definePlugin } from "@forge-go/dashboard-plugin"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import {
  FlagIcon,
  KeyRoundIcon,
  LayersIcon,
  RefreshCwIcon,
  SlidersHorizontalIcon,
} from "@forge-go/dashboard-kit/icons"
import type { ComponentType } from "react"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { ConfigCreatePage } from "./pages/config-create"
import { ConfigPage } from "./pages/config"
import { FlagCreatePage } from "./pages/flag-create"
import { FlagDetailPage } from "./pages/flag-detail"
import { FlagsPage } from "./pages/flags"
import { RotationDetailPage } from "./pages/rotation-detail"
import { RotationPage } from "./pages/rotation"
import { SecretCreatePage } from "./pages/secret-create"
import { SecretDetailPage } from "./pages/secret-detail"
import { SecretsPage } from "./pages/secrets"

export {
  ConfigCreatePage,
  ConfigPage,
  FlagCreatePage,
  FlagDetailPage,
  FlagsPage,
  RotationDetailPage,
  RotationPage,
  SecretCreatePage,
  SecretDetailPage,
  SecretsPage,
}
export {
  ConfigTypeBadge,
  DecidedHereBadge,
  EncryptionBadge,
  FlagEnabledBadge,
  FlagTypeBadge,
  NeverMatchesBadge,
  NotReachedBadge,
  PolicyStatusBadge,
  RotatorBadge,
  UnsupportedTypeBadge,
  WrongTypeBadge,
} from "./badges"
export { ConfigValue } from "./components/config-value"
export { FlagValue } from "./components/flag-value"
export { ValueInput } from "./components/value-input"
export { CONFIG_TYPES } from "./config-types"
export type { ConfigType } from "./config-types"
export { FLAG_TYPES } from "./flag-types"
export type { FlagType } from "./flag-types"
export { configPath, flagPath, rotationPath, secretPath } from "./keys"

/**
 * Stand-ins until the config detail page and the overrides page land. They
 * keep the nav link and the row links from pointing at nothing.
 */
const ConfigDetailPlaceholder: ComponentType<PluginPageProps> = ({ params }) => (
  <PageHeader
    title={params.key ?? "Config entry"}
    description="The entry page is not available yet."
  />
)

const OverridesPlaceholder: ComponentType<PluginPageProps> = () => (
  <PageHeader
    title="Overrides"
    description="The overrides page is not available yet."
  />
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
    {
      label: "Config",
      to: "/config",
      priority: 30,
      icon: <SlidersHorizontalIcon />,
      group: "Config",
    },
    {
      label: "Overrides",
      to: "/overrides",
      priority: 40,
      icon: <LayersIcon />,
      group: "Config",
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
    { path: "/flags/:key", element: FlagDetailPage },
    { path: "/config", element: ConfigPage },
    // Create lives at /new-config for the same reason /new-secret does: an
    // entry keyed "new" encodes to /config/new.
    { path: "/new-config", element: ConfigCreatePage },
    { path: "/config/:key", element: ConfigDetailPlaceholder },
    { path: "/overrides", element: OverridesPlaceholder },
  ],
})

export default vaultPlugin
