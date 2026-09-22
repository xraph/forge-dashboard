import { useId, useState } from "react"
import type { FormEvent } from "react"
import { useSearchParams } from "react-router"
import { useCommand, useQuery } from "@forge-go/dashboard-plugin"
import type { AuthConfig } from "@forge-go/dashboard-plugin"
import { AuthLayout } from "@forge-go/dashboard-kit/components/auth-layout"
import { buttonVariants } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { CommandAlert } from "@forge-go/dashboard-kit/components/query-boundary"
import type { AuthScreenProps } from "../routes"
import { currentServerHost } from "../server-host"

export function ResetPasswordScreen({ intents, onAuthenticated }: AuthScreenProps) {
  const config = useQuery<AuthConfig>(intents.config)
  const reset = useCommand<{ ok: boolean }>(intents.resetPassword ?? "")
  const [params] = useSearchParams()
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const passwordId = useId()
  const confirmId = useId()

  // This page opens cold, from an email, on a machine that has never held a
  // session. The token is the only thing identifying the account.
  const token = params.get("token") ?? ""
  const mismatch = confirm.length > 0 && password !== confirm

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (mismatch) return
    const result = await reset.execute({ token, password })
    if (result === undefined) return
    onAuthenticated()
  }

  if (!token) {
    return (
      <AuthLayout
        brand={config.data?.brand}
        serverHost={currentServerHost()}
        title="That link is incomplete"
      >
        <p className="text-muted-foreground text-sm" role="alert">
          This reset link carries no token. Request a new one from the sign-in
          page.
        </p>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      brand={config.data?.brand}
      description="Choose a new password to finish signing in."
      serverHost={currentServerHost()}
      title="Choose a new password"
    >
      <CommandAlert error={reset.error} showCode={false} title="Could not reset your password" />
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={passwordId}>New password</Label>
          <Input
            autoComplete="new-password"
            id={passwordId}
            name="password"
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            value={password}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={confirmId}>Confirm password</Label>
          <Input
            autoComplete="new-password"
            id={confirmId}
            name="confirm"
            onChange={(e) => setConfirm(e.target.value)}
            type="password"
            value={confirm}
          />
        </div>
        {mismatch ? (
          <p className="text-destructive text-sm" role="alert">
            Those two passwords do not match.
          </p>
        ) : null}
        <button
          className={buttonVariants({ className: "w-full" })}
          disabled={reset.loading || mismatch}
          type="submit"
        >
          {reset.loading ? "Saving…" : "Set password and sign in"}
        </button>
      </form>
    </AuthLayout>
  )
}
