import type { ForgePlugin } from "./types"

/**
 * Intents that implement auth, named by the plugin and called by the host.
 *
 * Named and not called, the same way `signOut` always was. That is what lets
 * the host render a sign-in screen without learning which product is behind
 * it, and lets a plugin contribute auth without shipping a single component.
 *
 * Optional keys are load-bearing: a provider with no `signUp` gets no
 * `/signup` route and no link pointing at one.
 */
export interface AuthIntents {
  /** Branding and which methods are enabled. Answers `AuthConfig`. */
  config: string
  /** Answers `LoginResult`. */
  signIn: string
  /** Answers `LogoutResult`. Omit it and the sidebar renders no sign-out. */
  signOut?: string
  forgotPassword?: string
  resetPassword?: string
  signUp?: string
  setupStatus?: string
  completeSetup?: string
}

export interface PluginAuth {
  intents: AuthIntents
}

/**
 * Finds the one plugin that provides auth intents.
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
      `more than one plugin declares auth intents (${names}); at most one may`,
    )
  }
  return declaring[0]
}

/** One OAuth button the deployment has configured, from the `config` intent. */
export interface SocialProvider {
  id: string
  label: string
  authStartURL: string
}

/**
 * What the `config` intent answers: the shape of the sign-in form this
 * particular deployment supports.
 *
 * `passwordEnabled` is the one required field because a config that does not
 * answer it has told us nothing, and the safe reading of nothing is "render no
 * password form" and not "guess".
 */
export interface AuthConfig {
  passwordEnabled: boolean
  brand?: string
  signupURL?: string
  signupLabel?: string
  termsURL?: string
  privacyURL?: string
  socialProviders?: SocialProvider[]
}

/** What the `signIn` intent answers. `subject` identifies whoever signed in. */
export interface LoginResult {
  ok: boolean
  subject?: string
}

/** What the `signOut` intent answers. */
export interface LogoutResult {
  ok: boolean
}
