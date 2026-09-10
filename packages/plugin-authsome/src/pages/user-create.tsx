import { useState } from "react"
import { useCommand } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { CommandAlert } from "@forge-go/dashboard-kit/components/query-boundary"
import type { AckResponse } from "./users"

export function AuthUserCreatePage() {
  const create = useCommand<AckResponse>("users.create")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")
  const [username, setUsername] = useState("")
  const [created, setCreated] = useState<string | null>(null)

  async function submit() {
    const result = await create.execute({
      email,
      password,
      // Optional in the contract. Omitted rather than sent empty, so the
      // server stores nothing rather than an empty string.
      firstName: firstName || undefined,
      lastName: lastName || undefined,
      username: username || undefined,
    })
    if (result === undefined) return
    setCreated(result.id ?? "")
    setEmail("")
    setPassword("")
    setFirstName("")
    setLastName("")
    setUsername("")
  }

  return (
    <section className="flex max-w-xl flex-col gap-4">
      <PageHeader title="New user" description="Creates an account directly, with no invitation email." />
      <CommandAlert error={create.error} title="Could not create the user" />
      {created !== null && (
        <p role="status" className="rounded-md border px-3 py-2 text-sm">
          User created.{" "}
          {created && (
            <a href={`/@auth/users/${created}`} className="underline underline-offset-4">
              Open it
            </a>
          )}
        </p>
      )}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-email">Email</Label>
        <Input id="new-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-password">Password</Label>
        <Input
          id="new-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <span className="text-xs text-muted-foreground">
          Checked against the engine's password policy, which answers with its own message.
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-first">First name</Label>
        <Input id="new-first" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-last">Last name</Label>
        <Input id="new-last" value={lastName} onChange={(e) => setLastName(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-username">Username</Label>
        <Input id="new-username" value={username} onChange={(e) => setUsername(e.target.value)} />
      </div>
      <Button
        onClick={() => void submit()}
        disabled={create.loading || email.trim() === "" || password === ""}
      >
        {create.loading ? "Creating…" : "Create user"}
      </Button>
    </section>
  )
}
