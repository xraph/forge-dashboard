import { useCommand } from "@forge-go/dashboard-plugin"
import type { LogoutResult } from "@forge-go/dashboard-plugin"
import { AuthLayout } from "@forge-go/dashboard-kit/components/auth-layout"
import { buttonVariants } from "@forge-go/dashboard-kit/components/button"
import { CommandAlert } from "@forge-go/dashboard-kit/components/query-boundary"
import { currentServerHost } from "../server-host"

export interface DeniedScreenProps {
  requiredRoles?: string[]
  signOutIntent?: string
  onSignedOut: () => void
}

/**
 * The sign-out affordance, split out so its hook is only ever called when
 * there is a real intent behind it.
 *
 * useCommand's first line reads the scoped client from context, and throws
 * when there is none. DeniedScreen renders even when there is no provider at
 * all (a 403 with nothing configured to sign out through), so the hook cannot
 * live at that level: it has to be behind the same conditional that decides
 * whether a button appears, which means a child component that is
 * conditionally RENDERED rather than a hook called conditionally.
 */
function SignOutButton({
  intent,
  onSignedOut,
}: {
  intent: string
  onSignedOut: () => void
}) {
  const logout = useCommand<LogoutResult>(intent)

  async function handleSignOut() {
    const result = await logout.execute()
    if (result === undefined) return
    onSignedOut()
  }

  return (
    <>
      <CommandAlert
        error={logout.error}
        showCode={false}
        title="Sign out failed"
      />
      <button
        className={buttonVariants({
          variant: "outline",
          className: "mt-4 w-full",
        })}
        disabled={logout.loading}
        onClick={handleSignOut}
        type="button"
      >
        {logout.loading ? "Signing out…" : "Sign out"}
      </button>
    </>
  )
}

/**
 * Calls no hooks itself, on purpose.
 *
 * This screen has to be able to render with no auth provider at all and
 * therefore no scoped client: a signed-in-but-denied visitor whose deployment
 * has nothing wired for sign-out still needs to see why they are denied. A
 * hook called at this level, unconditionally or otherwise, would throw before
 * any of that reached the screen. SignOutButton carries the one hook this
 * screen needs, and only mounts when there is an intent for it to call.
 */
export function DeniedScreen({
  requiredRoles,
  signOutIntent,
  onSignedOut,
}: DeniedScreenProps) {
  return (
    <AuthLayout
      description="You are signed in, but not with an account this dashboard accepts."
      serverHost={currentServerHost()}
      title="You do not have access"
    >
      {requiredRoles?.length ? (
        <p className="rounded-md border px-3 py-2 text-sm">
          It needs one of these roles: {requiredRoles.join(", ")}.
        </p>
      ) : null}
      {signOutIntent ? (
        <SignOutButton intent={signOutIntent} onSignedOut={onSignedOut} />
      ) : null}
      <p className="mt-4 text-center text-sm text-muted-foreground">
        Or ask whoever manages this dashboard to grant you access.
      </p>
    </AuthLayout>
  )
}
