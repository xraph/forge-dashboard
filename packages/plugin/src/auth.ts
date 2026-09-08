import type { ComponentType } from "react"

import type { ForgePlugin } from "./types"

/**
 * What the host hands a gate.
 *
 * `requiredRoles` is how the gate tells the two blocked states apart. Absent
 * or empty means nobody is signed in, so render sign-in. Non-empty means
 * somebody is signed in as the wrong person and these are the roles this
 * dashboard wanted, so render an access-denied panel with a way to sign out.
 * One component covers both because a provider that owns sign-in also owns
 * "wrong account, try another", and they share all their styling.
 */
export interface AuthGateProps {
  loginPath: string
  requiredRoles?: string[]
  /** Call after a successful sign-in. The host re-reads /principal. */
  onAuthenticated: () => void
}

export interface PluginAuth {
  gate: ComponentType<AuthGateProps>
  /**
   * The command this provider signs out with, named rather than called.
   *
   * The host forwards this to the sidebar footer's sign-out item and sends it
   * through this plugin's own scoped client, then re-reads the session. Naming
   * it here is what keeps two layers ignorant: the kit renders a menu item and
   * never learns an intent exists, and the host sends a string it was handed
   * and never learns that "auth.logout" is the one that clears a cookie.
   *
   * Omit it and the footer renders no sign-out item at all. A dead one that
   * looks clickable and does nothing is worse than none.
   */
  signOutIntent?: string
}

/**
 * Finds the one plugin that provides the auth gate.
 *
 * At most one may, the same way at most one may set `root`. Enforced here
 * rather than in the host's render so there is a single tested place for the
 * rule, and so the failure is a thrown wiring error at resolve time instead
 * of a silent pick that depends on array order.
 */
export function resolveAuthProvider(plugins: ForgePlugin[]): ForgePlugin | undefined {
  const declaring = plugins.filter((plugin) => plugin.auth !== undefined)
  if (declaring.length > 1) {
    const names = declaring.map((plugin) => plugin.extension).join(", ")
    throw new Error(
      `more than one plugin declares an auth gate (${names}); at most one may`,
    )
  }
  return declaring[0]
}
