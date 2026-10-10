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
import { currentServerHost } from "../server-host"

export function ForgotPasswordScreen({ intents }: AuthScreenProps) {
  const config = useQuery<AuthConfig>(intents.config)
  const request = useCommand<{ ok: boolean }>(intents.forgotPassword ?? "")
  const [email, setEmail] = useState("")
  const [sent, setSent] = useState(false)
  const emailId = useId()

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const result = await request.execute({ email })
    if (result === undefined) return
    setSent(true)
  }

  return (
    <AuthLayout
      brand={config.data?.brand}
      description="We'll email you a link. It expires in one hour."
      footer={
        <Link className="text-muted-foreground hover:underline" to="/login">
          Back to sign in
        </Link>
      }
      serverHost={currentServerHost()}
      title="Reset your password"
    >
      <CommandAlert
        error={request.error}
        showCode={false}
        title="Could not send the link"
      />
      {sent ? (
        // Deliberately the same wording whether or not the address exists.
        // Telling somebody which emails are registered is an account oracle.
        <p className="rounded-md border px-3 py-2 text-sm" role="status">
          If that address has an account, a reset link is on its way.
        </p>
      ) : (
        <form className="flex min-w-0 flex-col gap-4" onSubmit={handleSubmit}>
          <div className="flex min-w-0 flex-col gap-1.5">
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
          <button
            className={buttonVariants({ className: "w-full" })}
            disabled={request.loading}
            type="submit"
          >
            {request.loading ? "Sending…" : "Send reset link"}
          </button>
        </form>
      )}
    </AuthLayout>
  )
}
