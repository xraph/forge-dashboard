import { useId, useState } from "react"
import type { FormEvent } from "react"
import { Link } from "react-router"
import { useCommand, useQuery } from "@forge-go/dashboard-plugin"
import type { AuthConfig, LoginResult } from "@forge-go/dashboard-plugin"
import { AuthLayout } from "@forge-go/dashboard-kit/components/auth-layout"
import { buttonVariants } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { CommandAlert } from "@forge-go/dashboard-kit/components/query-boundary"
import { Navigate } from "react-router"
import type { AuthIntents } from "@forge-go/dashboard-plugin"
import type { AuthScreenProps } from "../routes"

/**
 * Sends a first-run server to /setup instead of a sign-in form nobody can use.
 *
 * Lives here rather than in the host so the host never learns what setup
 * means, and so a host app that replaces this screen opts out of the behaviour
 * cleanly instead of fighting it.
 */
function SetupRedirect({ intents }: { intents: AuthIntents }) {
  const status = useQuery<{ pending: boolean }>(intents.setupStatus ?? "")
  if (status.data?.pending !== true) return null
  return <Navigate replace to="/setup" />
}

export function SignInScreen({ intents, basename, onAuthenticated }: AuthScreenProps) {
  const config = useQuery<AuthConfig>(intents.config)
  const login = useCommand<LoginResult>(intents.signIn)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const emailId = useId()
  const passwordId = useId()

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    // Without this the browser navigates on submit and the command never
    // finishes. jsdom does not navigate, so a missing preventDefault passes
    // every test here and fails on the first real click.
    event.preventDefault()
    const result = await login.execute({ email, password })
    if (result === undefined) return
    onAuthenticated()
  }

  // A config that has not answered yet is not an error state. Rendering the
  // form optimistically keeps the first paint useful, and the alert below
  // covers a config that genuinely failed.
  const passwordEnabled = config.data?.passwordEnabled ?? true

  return (
    <AuthLayout
      brand={config.data?.brand}
      description="Welcome back."
      footer={
        <Link className="text-muted-foreground hover:underline" to={`${basename}/forgot-password`}>
          Forgot your password?
        </Link>
      }
      title="Sign in"
    >
      {/*
        A server with no administrator yet has nothing to sign in to, so setup
        outranks this screen. Rendered as a child and not called as a hook
        here, because `intents.setupStatus` is optional and a conditional hook
        is illegal. A provider that never declared it mounts nothing.
      */}
      {intents.setupStatus ? (
        <SetupRedirect intents={intents} />
      ) : null}
      <CommandAlert error={login.error} title="Sign in failed" />
      {passwordEnabled ? (
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={emailId}>Email</Label>
            <Input
              autoComplete="username"
              id={emailId}
              name="email"
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              value={email}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={passwordId}>Password</Label>
            <Input
              autoComplete="current-password"
              id={passwordId}
              name="password"
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              value={password}
            />
          </div>
          <button className={buttonVariants({ className: "w-full" })} disabled={login.loading} type="submit">
            {login.loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      ) : null}
      {(config.data?.socialProviders ?? []).map((provider) => (
        <a
          className={buttonVariants({ variant: "outline", className: "mt-2 w-full" })}
          href={provider.authStartURL}
          key={provider.id}
        >
          {provider.label}
        </a>
      ))}
    </AuthLayout>
  )
}
