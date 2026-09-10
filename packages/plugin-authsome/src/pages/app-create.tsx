import { useState } from "react"
import { PluginLink, useCommand } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { CommandAlert } from "@forge-go/dashboard-kit/components/query-boundary"
import type { AckResponse } from "./users"

/**
 * A separate route rather than an inline panel, because a slug has to be
 * unique and that deserves its own page rather than a table-header drawer.
 */
export function AuthAppCreatePage() {
  const create = useCommand<AckResponse>("apps.create")
  const [name, setName] = useState("")
  const [slug, setSlug] = useState("")
  const [logo, setLogo] = useState("")
  const [created, setCreated] = useState<string | null>(null)

  async function submit() {
    const result = await create.execute({
      name,
      slug,
      // Optional in the contract. The key itself is omitted rather than set
      // to `undefined`: `JSON.stringify` would drop either one, but leaving
      // the key off the object is the honest form and is what a test
      // asserting `"logo" in payload` actually needs to see.
      ...(logo ? { logo } : {}),
    })
    if (result === undefined) return
    setCreated(result.id ?? "")
    setName("")
    setSlug("")
    setLogo("")
  }

  return (
    <section className="flex max-w-xl flex-col gap-4">
      <PageHeader title="New app" description="Its own users, sessions and environments, isolated from every other app." />
      <CommandAlert error={create.error} title="Could not create the app" />
      {created !== null && (
        <p role="status" className="rounded-md border px-3 py-2 text-sm">
          App created.{" "}
          {created && (
            <PluginLink to={`/@auth/apps/${created}`} className="underline underline-offset-4">
              Open it
            </PluginLink>
          )}
        </p>
      )}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-app-name">Name</Label>
        <Input id="new-app-name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-app-slug">Slug</Label>
        <Input id="new-app-slug" value={slug} onChange={(e) => setSlug(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-app-logo">Logo</Label>
        <Input id="new-app-logo" value={logo} onChange={(e) => setLogo(e.target.value)} />
      </div>
      <Button
        onClick={() => void submit()}
        disabled={create.loading || name.trim() === "" || slug.trim() === ""}
      >
        {create.loading ? "Creating…" : "Create app"}
      </Button>
    </section>
  )
}
