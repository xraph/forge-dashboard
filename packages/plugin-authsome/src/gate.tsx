import { useId, useState } from "react"
import type { FormEvent } from "react"
import { useCommand, useQuery } from "@forge-go/dashboard-plugin"
import type { AuthGateProps } from "@forge-go/dashboard-plugin"
import { buttonVariants } from "@forge-go/dashboard-kit/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@forge-go/dashboard-kit/components/card"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { CommandAlert, QueryView } from "./components/query-view"
import type { AuthConfig, LoginResult } from "./pages/login"

/**
 * The screen the host renders instead of the dashboard when nobody is signed
 * in, or when somebody is signed in as the wrong person.
 *
 * This is not AuthLoginPage. That page holds a local `subject` and shows a
 * signed-in panel afterwards, which suits a page you navigated to. A gate
 * that succeeds should stop existing: it calls `onAuthenticated`, the host
 * re-reads /principal, and the shell takes the screen. Holding local state
 * here would leave a confirmation panel with no way onward.
 */
function Denied({ requiredRoles, loginPath }: { requiredRoles: string[]; loginPath: string }) {
  return (
    <Card className="mx-auto max-w-sm">
      <CardHeader>
        <CardTitle>You do not have access to this dashboard</CardTitle>
        <CardDescription>
          It needs one of these roles: {requiredRoles.join(", ")}.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <a className={buttonVariants({ variant: "outline" })} href={loginPath}>
          Sign in as someone else
        </a>
      </CardContent>
    </Card>
  )
}

function GateForm({
  config,
  onAuthenticated,
}: {
  config: AuthConfig
  onAuthenticated: () => void
}) {
  const login = useCommand<LoginResult>("auth.login")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const emailId = useId()
  const passwordId = useId()

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    // Without this the browser navigates away on submit and the command
    // never finishes. jsdom does not navigate, so a missing preventDefault
    // passes every test here and fails on the first real click.
    event.preventDefault()
    const result = await login.execute({ email, password })
    if (result === undefined) return
    // Nothing is cleared and nothing is remembered. This component is about
    // to be unmounted by the host, so clearing the password box would be
    // work nobody sees.
    onAuthenticated()
  }

  return (
    <Card className="mx-auto max-w-sm">
      <CardHeader>
        <CardTitle>{config.brand ?? "Sign in"}</CardTitle>
        <CardDescription>
          {config.passwordEnabled
            ? "Sign in with your email and password."
            : "Choose a sign-in method."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <CommandAlert error={login.error} title="Sign in failed" />
        {config.passwordEnabled ? (
          <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={emailId}>Email</Label>
              <Input
                id={emailId}
                name="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={passwordId}>Password</Label>
              <Input
                id={passwordId}
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {/*
              autoComplete on both fields is not decoration. This gate is the
              screen every visitor meets before anything else, so it is the
              single most used sign-in surface in the product, and a password
              manager that cannot recognise "username" and "current-password"
              makes every visit worse. Kept in step with LoginForm in
              pages/login.tsx on purpose: the two forms should read as the
              same form, and nothing here should drift from there again.
            */}
            <button
              type="submit"
              disabled={login.loading}
              className={buttonVariants({ className: "w-full" })}
            >
              {login.loading ? "Signing in…" : "Sign in"}
            </button>
          </form>
        ) : null}
        {(config.socialProviders ?? []).map((provider) => (
          <a
            key={provider.id}
            className={buttonVariants({ variant: "outline" })}
            href={provider.authStartURL}
          >
            {provider.label}
          </a>
        ))}
      </CardContent>
    </Card>
  )
}

/**
 * Reads `auth.config` and renders the form once it answers.
 *
 * Split out of `AuthGate` so the read only happens on the branch that uses
 * it. `useQuery` fires from an effect on mount, so folding it into
 * `AuthGate` above the `requiredRoles` check would send an `auth.config`
 * request on every render of the denied screen too, for a result that
 * screen never reads.
 */
function SignInGate({ onAuthenticated }: { onAuthenticated: () => void }) {
  const config = useQuery<AuthConfig>("auth.config")

  return (
    <QueryView title="Sign-in options" query={config} skeletonRows={3}>
      {(data) => <GateForm config={data} onAuthenticated={onAuthenticated} />}
    </QueryView>
  )
}

export function AuthGate({ loginPath, requiredRoles, onAuthenticated }: AuthGateProps) {
  if ((requiredRoles?.length ?? 0) > 0) {
    return <Denied requiredRoles={requiredRoles ?? []} loginPath={loginPath} />
  }

  return <SignInGate onAuthenticated={onAuthenticated} />
}
