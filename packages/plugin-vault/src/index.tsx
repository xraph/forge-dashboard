import { definePlugin } from "@forge-go/dashboard-plugin"
import { KeyRoundIcon, RefreshCwIcon } from "@forge-go/dashboard-kit/icons"
import { RotationDetailPage } from "./pages/rotation-detail"
import { RotationPage } from "./pages/rotation"
import { SecretCreatePage } from "./pages/secret-create"
import { SecretDetailPage } from "./pages/secret-detail"
import { SecretsPage } from "./pages/secrets"

export {
  RotationDetailPage,
  RotationPage,
  SecretCreatePage,
  SecretDetailPage,
  SecretsPage,
}
export { EncryptionBadge, PolicyStatusBadge, RotatorBadge } from "./badges"
export { rotationPath, secretPath } from "./keys"

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
  ],
})

export default vaultPlugin
