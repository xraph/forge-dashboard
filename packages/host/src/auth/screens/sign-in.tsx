import { useId, useState } from "react"
import type { FormEvent } from "react"
import { Link, Navigate } from "react-router"
import { useCommand, useQuery } from "@forge-go/dashboard-plugin"
import type {
  AuthConfig,
  LoginResult,
  SetupStatus,
} from "@forge-go/dashboard-plugin"
import { AuthLayout } from "@forge-go/dashboard-kit/components/auth-layout"
import { buttonVariants } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { CommandAlert } from "@forge-go/dashboard-kit/components/query-boundary"
import { Spinner } from "@forge-go/dashboard-kit/components/spinner"
import type { AuthScreenProps } from "../routes"
import { hasSetupFlow } from "../routes"
import { currentServerHost } from "../server-host"

export function SignInScreen(props: AuthScreenProps) {
  return hasSetupFlow(props.intents) ? (
    <SetupAwareSignInScreen {...props} />
  ) : (
    <SignInForm {...props} />
  )
}

function SetupAwareSignInScreen(props: AuthScreenProps) {
  const status = useQuery<SetupStatus>(props.intents.setupStatus ?? "")

  if (status.loading && !status.data) {
    return (
      <AuthLayout
        description="Checking whether this server needs an administrator."
        serverHost={currentServerHost()}
        title="Preparing Forge"
      >
        <Spinner className="mx-auto" />
      </AuthLayout>
    )
  }

  if (status.error) {
    return (
      <AuthLayout
        description="Forge could not confirm whether initial setup is complete."
        serverHost={currentServerHost()}
        title="Setup status unavailable"
      >
        <div className="flex flex-col gap-3">
          <CommandAlert
            error={status.error}
            showCode={false}
            title="Connection failed"
          />
          <button
            className={buttonVariants({
              variant: "outline",
              className: "w-full",
            })}
            onClick={() => status.refetch()}
            type="button"
          >
            Retry
          </button>
        </div>
      </AuthLayout>
    )
  }

  if (status.data?.pending) {
    return (
      <Navigate replace to={`/setup?next=${encodeURIComponent(props.next)}`} />
    )
  }

  return <SignInForm {...props} />
}

function SignInForm({ intents, onAuthenticated }: AuthScreenProps) {
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

  // Loading is not the same as "no password login". Until the config
  // answers, show nothing in the method area rather than guessing; the
  // contract on AuthConfig says the safe reading of an unanswered
  // passwordEnabled is to render no password form.
  const passwordEnabled = config.data?.passwordEnabled === true

  return (
    <AuthLayout
      brand={config.data?.brand}
      description="Welcome back."
      footer={
        <Link
          className="text-muted-foreground hover:underline"
          to="/forgot-password"
        >
          Forgot your password?
        </Link>
      }
      serverHost={currentServerHost()}
      title="Sign in"
    >
      <CommandAlert
        error={login.error}
        showCode={false}
        title="Sign in failed"
      />
      {config.loading && !config.data ? (
        <Spinner className="mx-auto" />
      ) : config.error ? (
        // The old AuthLoginPage routed this read through QueryBoundary, which
        // showed the code and message and offered a Retry button. This screen
        // does not use QueryBoundary itself (its loading and success shapes
        // are its own, not the Card the boundary renders), so the same two
        // things - the error visible, and a way to try again - are built from
        // the same pieces QueryBoundary uses: CommandAlert for the message,
        // and refetch behind a button.
        <div className="flex flex-col gap-3">
          <CommandAlert
            error={config.error}
            showCode={false}
            title="Sign-in options unavailable"
          />
          <button
            className={buttonVariants({
              variant: "outline",
              className: "w-full",
            })}
            onClick={() => config.refetch()}
            type="button"
          >
            Retry
          </button>
        </div>
      ) : passwordEnabled ? (
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
          <button
            className={buttonVariants({ className: "w-full" })}
            disabled={login.loading}
            type="submit"
          >
            {login.loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      ) : null}
      {(config.data?.socialProviders ?? []).map((provider) => (
        <a
          className={buttonVariants({
            variant: "outline",
            className: "mt-2 w-full",
          })}
          href={provider.authStartURL}
          key={provider.id}
        >
          {provider.label}
        </a>
      ))}
    </AuthLayout>
  )
}
