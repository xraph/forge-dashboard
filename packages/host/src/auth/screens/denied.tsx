import { useCommand } from "@forge-go/dashboard-plugin"
import type { LogoutResult } from "@forge-go/dashboard-plugin"
import { AuthLayout } from "@forge-go/dashboard-kit/components/auth-layout"
import { buttonVariants } from "@forge-go/dashboard-kit/components/button"
import { CommandAlert } from "@forge-go/dashboard-kit/components/query-boundary"

export interface DeniedScreenProps {
  requiredRoles?: string[]
  signOutIntent?: string
  onSignedOut: () => void
}

export function DeniedScreen({
  requiredRoles,
  signOutIntent,
  onSignedOut,
}: DeniedScreenProps) {
  const logout = useCommand<LogoutResult>(signOutIntent ?? "")

  async function handleSignOut() {
    const result = await logout.execute()
    if (result === undefined) return
    onSignedOut()
  }

  return (
    <AuthLayout
      description="You are signed in, but not with an account this dashboard accepts."
      title="You do not have access"
    >
      <CommandAlert error={logout.error} title="Sign out failed" />
      {requiredRoles?.length ? (
        <p className="rounded-md border px-3 py-2 text-sm">
          It needs one of these roles: {requiredRoles.join(", ")}.
        </p>
      ) : null}
      {signOutIntent ? (
        <button
          className={buttonVariants({ variant: "outline", className: "mt-4 w-full" })}
          disabled={logout.loading}
          onClick={handleSignOut}
          type="button"
        >
          {logout.loading ? "Signing out…" : "Sign out"}
        </button>
      ) : null}
      <p className="mt-4 text-center text-muted-foreground text-sm">
        Or ask whoever manages this dashboard to grant you access.
      </p>
    </AuthLayout>
  )
}
