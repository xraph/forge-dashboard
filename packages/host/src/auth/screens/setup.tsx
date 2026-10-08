import { useId, useState } from "react"
import type { FormEvent } from "react"
import { useCommand, useQuery } from "@forge-go/dashboard-plugin"
import type { AuthConfig } from "@forge-go/dashboard-plugin"
import { AuthLayout } from "@forge-go/dashboard-kit/components/auth-layout"
import { buttonVariants } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { CommandAlert } from "@forge-go/dashboard-kit/components/query-boundary"
import type { AuthScreenProps } from "../routes"
import { currentServerHost } from "../server-host"

export function SetupScreen({ intents, onAuthenticated }: AuthScreenProps) {
  const config = useQuery<AuthConfig>(intents.config)
  const complete = useCommand<{ ok: boolean }>(intents.completeSetup ?? "")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const emailId = useId()
  const passwordId = useId()

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const result = await complete.execute({ email, password })
    if (result === undefined) return
    onAuthenticated()
  }

  return (
    <AuthLayout
      brand={config.data?.brand}
      description="This account owns the server until it grants access to others."
      serverHost={currentServerHost()}
      title="Create the first administrator"
    >
      <CommandAlert
        error={complete.error}
        showCode={false}
        title="Setup failed"
      />
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
            autoComplete="new-password"
            id={passwordId}
            name="password"
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            value={password}
          />
        </div>
        <button
          className={buttonVariants({ className: "w-full" })}
          disabled={complete.loading}
          type="submit"
        >
          {complete.loading ? "Creating…" : "Create and continue"}
        </button>
      </form>
    </AuthLayout>
  )
}
