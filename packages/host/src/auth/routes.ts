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

/** True when `pathname` is one of AUTH_PATHS under `basename`. */
export function isAuthPath(pathname: string, basename: string): boolean {
  const rest = basename && pathname.startsWith(basename)
    ? pathname.slice(basename.length)
    : pathname
  return (AUTH_PATHS as readonly string[]).includes(rest)
}

/**
 * The routes to mount, given what the provider can actually do.
 *
 * A capability the provider never declared produces no route, so there is no
 * separate configuration to keep in step with the intent list, and no link
 * that renders a blank screen.
 */
export function authRoutesFor(
  intents: AuthIntents,
  screens: AuthScreens,
  defaults: AuthScreens = {},
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
