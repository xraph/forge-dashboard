import { useId, useState } from "react"
import type { FormEvent } from "react"
import { Link } from "react-router"
import { useCommand, useQuery } from "@forge-go/dashboard-plugin"
import type { AuthConfig } from "@forge-go/dashboard-plugin"
import { AuthLayout } from "@forge-go/dashboard-kit/components/auth-layout"
import { buttonVariants } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { CommandAlert } from "@forge-go/dashboard-kit/components/query-boundary"
import type { AuthScreenProps } from "../routes"

export function SignUpScreen({ intents, basename, onAuthenticated }: AuthScreenProps) {
  const config = useQuery<AuthConfig>(intents.config)
  const signUp = useCommand<{ ok: boolean }>(intents.signUp ?? "")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const emailId = useId()
  const passwordId = useId()

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const result = await signUp.execute({ email, password })
    if (result === undefined) return
    onAuthenticated()
  }

  return (
    <AuthLayout
      brand={config.data?.brand}
      description={config.data?.signupLabel ?? "Create an account."}
      footer={
        <Link className="text-muted-foreground hover:underline" to={`${basename}/login`}>
          Already have one? Sign in
        </Link>
      }
      title="Create an account"
    >
      <CommandAlert error={signUp.error} title="Could not create the account" />
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
        <button className={buttonVariants({ className: "w-full" })} disabled={signUp.loading} type="submit">
          {signUp.loading ? "Creating…" : "Create account"}
        </button>
      </form>
    </AuthLayout>
  )
}
