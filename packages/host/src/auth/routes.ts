import type { ComponentType } from "react"
import type { AuthIntents } from "@forge-go/dashboard-plugin"

/** What every auth screen receives, whether a default or an override. */
export interface AuthScreenProps {
  intents: AuthIntents
  /** Where the dashboard is mounted. Prefix every link with it. */
  basename: string
  /** Validated already. Navigate here after a successful sign-in. */
  next: string
  /** Call after signing in. The host re-reads /principal. */
  onAuthenticated: () => void
}

/** A host app may replace any of these, independently. */
export interface AuthScreens {
  signIn?: ComponentType<AuthScreenProps>
  forgotPassword?: ComponentType<AuthScreenProps>
  resetPassword?: ComponentType<AuthScreenProps>
  signUp?: ComponentType<AuthScreenProps>
  setup?: ComponentType<AuthScreenProps>
}

export interface AuthRoute {
  path: string
  element: ComponentType<AuthScreenProps>
}

/**
 * Every path this host will ever treat as an auth path.
 *
 * Fixed rather than derived so `isAuthPath` can answer before a provider has
 * resolved, which is what stops a signed-out visitor on /login being bounced
 * to /login again while capabilities are still loading.
 */
export const AUTH_PATHS = [
  "/login",
  "/forgot-password",
  "/reset-password",
  "/signup",
  "/setup",
] as const

/**
 * True when `pathname` is one of AUTH_PATHS under `basename`.
 *
 * Normalizes `basename` by removing a trailing slash (so "/" and "/forge/"
 * become "" and "/forge") to prevent the separator from being eaten when
 * slicing. Returns false if basename is a non-empty prefix that does not
 * match pathname. Strips a trailing slash from the remainder and exact-matches
 * against AUTH_PATHS to avoid "/forge/login" matching "/forge/loginsomething".
 */
export function isAuthPath(pathname: string, basename: string): boolean {
  // Normalize basename: remove trailing "/" (except for "/")
  let normalized = basename
  if (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1)
  } else if (normalized === "/") {
    normalized = ""
  }

  // If there is a normalized basename, it must be a prefix of pathname
  if (normalized && !pathname.startsWith(normalized)) {
    return false
  }

  // Get remainder after basename
  let rest = normalized ? pathname.slice(normalized.length) : pathname

  // Strip single trailing "/" from remainder
  if (rest.endsWith("/") && rest !== "/") {
    rest = rest.slice(0, -1)
  }

  // Exact match against AUTH_PATHS
  return (AUTH_PATHS as readonly string[]).includes(rest)
}

/**
 * The routes to mount, given what the provider can actually do.
 *
 * A capability the provider never declared produces no route, so there is no
 * separate configuration to keep in step with the intent list, and no link
 * that renders a blank screen.
 *
 * Requires signIn in defaults to guarantee that every route table includes
 * /login. A dashboard with no way to sign in is not usable.
 */
export function authRoutesFor(
  intents: AuthIntents,
  screens: AuthScreens,
  defaults: AuthScreens & Required<Pick<AuthScreens, "signIn">>,
): AuthRoute[] {
  const routes: AuthRoute[] = []
  const pick = (
    key: keyof AuthScreens,
  ): ComponentType<AuthScreenProps> | undefined => screens[key] ?? defaults[key]

  const add = (path: string, key: keyof AuthScreens) => {
    const element = pick(key)
    if (element) routes.push({ path, element })
  }

  add("/login", "signIn")
  if (intents.forgotPassword) add("/forgot-password", "forgotPassword")
  if (intents.resetPassword) add("/reset-password", "resetPassword")
  if (intents.signUp) add("/signup", "signUp")
  if (intents.setupStatus && intents.completeSetup) add("/setup", "setup")

  return routes
}
