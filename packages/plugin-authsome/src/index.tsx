import { definePlugin } from "@forge-go/dashboard-plugin"
import {
  ClockIcon,
  ShieldIcon,
  UsersIcon,
} from "@forge-go/dashboard-kit/icons"
import { AuthGate } from "./gate"
import { AuthLoginPage } from "./pages/login"
import { AuthSessionsPage } from "./pages/sessions"
import { AuthUsersPage } from "./pages/users"

export type {
  AuthConfig,
  LoginResult,
  LogoutResult,
  SocialProvider,
} from "./pages/login"
export type {
  BanResult,
  UserRecord,
  UserSummary,
  UsersList,
} from "./pages/users"
export type {
  RevokeResult,
  SessionSummary,
  SessionsList,
} from "./pages/sessions"
export { AuthGate, AuthLoginPage, AuthSessionsPage, AuthUsersPage }

/**
 * The first-party UI for authsome.
 *
 * `extension` is "auth". Not "authsome", which is the app's slug and the name
 * of the repository, and not the npm package name either: this is the Go
 * contributor name from authsome's `extension/contract/manifest.yaml`, and it
 * is the join key the host looks up in the capabilities response. It is also
 * what `packages/runtime/src/config.tsx` already defaults `loginContributor`
 * to, which is the same name arrived at from the other direction.
 *
 * Get it wrong and `resolvePluginState` reports `hidden`: no routes mount, no
 * nav appears, and nothing is logged, because a contributor the server never
 * mentioned is an ordinary thing for a shell to encounter. That silence is
 * why `test/plugin.test.tsx` resolves this plugin against a capabilities
 * document instead of comparing the string to itself.
 *
 * No `requires` range, for the same reason as the streaming plugin: authsome's
 * contributor does not report a version, and a range against a contributor
 * that answers no version is skipped by the resolver anyway. Adding one would
 * be a claim we cannot check.
 *
 * This is the first plugin in the rewrite that writes. Five of the nine
 * intents it uses are commands - `auth.login`, `auth.logout`, `users.ban`,
 * `users.unban`, `sessions.revoke` - and every one of them
 * goes out through `useCommand`, which means the CSRF token and the
 * idempotency key are minted by the client in `packages/plugin/src/client.ts`
 * and nowhere in this package. There is no `crypto.randomUUID` here on
 * purpose: a key generated in a page is a new key on every retry, which is
 * the exact bug the handshake exists to prevent.
 */
export const authsomePlugin = definePlugin({
  extension: "auth",
  namespace: "auth",
  label: "Auth",
  icon: <ShieldIcon />,
  // Sign-in is no longer a page. The host renders `gate` in place of the
  // whole shell when nobody is signed in, so a "Sign in" row sitting between
  // Users and Sessions for somebody already signed in has nothing to mean.
  auth: { gate: AuthGate, signOutIntent: "auth.logout" },
  nav: [
    { label: "Users", to: "/users", priority: 20, icon: <UsersIcon /> },
    { label: "Sessions", to: "/sessions", priority: 30, icon: <ClockIcon /> },
  ],
  routes: [
    { path: "/users", element: AuthUsersPage },
    { path: "/sessions", element: AuthSessionsPage },
  ],
})

export default authsomePlugin
