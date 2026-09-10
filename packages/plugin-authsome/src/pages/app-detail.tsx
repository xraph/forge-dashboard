import { useState } from "react"
import type { ReactNode } from "react"
import { useCommand, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import {
  DescriptionList,
  DetailLayout,
} from "@forge-go/dashboard-kit/components/detail-layout"
import {
  CommandAlert,
  QueryBoundary,
} from "@forge-go/dashboard-kit/components/query-boundary"
import { formatTimestamp } from "@forge-go/dashboard-kit/lib/format"
import type { AckResponse } from "./users"
import type { AppSummary } from "./apps"

/** `apps.detail`. AppDetail embeds AppSummary in Go, so the JSON is flat. */
export interface AppDetail extends AppSummary {
  logo?: string
  publishableKey?: string
  metadata?: Record<string, string>
  updatedAt: string
}

function formatMetadata(metadata?: Record<string, string>): ReactNode {
  const entries = Object.entries(metadata ?? {})
  if (entries.length === 0) {
    return <span aria-label="No metadata">–</span>
  }
  return (
    <ul className="flex flex-col gap-0.5">
      {entries.map(([key, value]) => (
        <li key={key} className="font-mono text-xs">
          {key}: {value}
        </li>
      ))}
    </ul>
  )
}

/**
 * The publishable key is the one field on this page somebody actually needs
 * to move somewhere else, so it gets a copy button next to it. Copying is
 * best-effort: a denied or unavailable Clipboard API leaves the key visible
 * to select by hand instead of throwing.
 */
function PublishableKey({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard?.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard access denied or unavailable; the key stays visible.
    }
  }

  return (
    <span className="flex items-center gap-2">
      <span className="font-mono text-xs">{value}</span>
      <Button
        variant="outline"
        size="xs"
        aria-label="Copy publishable key"
        onClick={() => void copy()}
      >
        {copied ? "Copied" : "Copy"}
      </Button>
    </span>
  )
}

function EditApp({ app }: { app: AppDetail }) {
  const update = useCommand<AckResponse>("apps.update")
  const [name, setName] = useState(app.name)
  const [slug, setSlug] = useState(app.slug)
  const [logo, setLogo] = useState(app.logo ?? "")

  // Only what actually changed. `apps.update` declares these as Go pointers
  // precisely so "leave unchanged" and "set to empty" stay different things,
  // and an untouched field sent as "" blanks it on the server.
  const changed: Record<string, unknown> = { id: app.id }
  if (name !== app.name) changed.name = name
  if (slug !== app.slug) changed.slug = slug
  if (logo !== (app.logo ?? "")) changed.logo = logo
  const dirty = Object.keys(changed).length > 1

  return (
    <div className="flex flex-col gap-3 rounded-md border p-4">
      <h2 className="text-sm font-medium">Edit</h2>
      <CommandAlert error={update.error} title="Could not save" />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="app-name">Name</Label>
        <Input id="app-name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="app-slug">Slug</Label>
        <Input id="app-slug" value={slug} onChange={(e) => setSlug(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="app-logo">Logo</Label>
        <Input id="app-logo" value={logo} onChange={(e) => setLogo(e.target.value)} />
      </div>
      <Button
        onClick={() => void update.execute(changed)}
        disabled={update.loading || !dirty}
      >
        {update.loading ? "Saving…" : "Save changes"}
      </Button>
    </div>
  )
}

export function AuthAppDetailPage({ params }: PluginPageProps) {
  const appId = params.id
  if (!appId) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        No app selected.
      </p>
    )
  }
  return <AppDetailBody appId={appId} />
}

function AppDetailBody({ appId }: { appId: string }) {
  const query = useQuery<AppDetail>("apps.detail", { id: appId })

  return (
    <section className="flex flex-col gap-4">
      <QueryBoundary title="App" query={query} skeletonRows={3}>
        {(app) => (
          <>
            <PageHeader title={app.name} description={app.slug} />
            <DetailLayout
              main={
                <DescriptionList
                  items={[
                    { term: "Name", value: app.name },
                    { term: "Slug", value: <span className="font-mono text-xs">{app.slug}</span> },
                    {
                      term: "Platform",
                      value: (
                        <Badge variant={app.isPlatform ? "secondary" : "outline"}>
                          {app.isPlatform ? "platform" : "app"}
                        </Badge>
                      ),
                    },
                    {
                      term: "Publishable key",
                      value: app.publishableKey ? (
                        <PublishableKey value={app.publishableKey} />
                      ) : (
                        <span aria-label="No publishable key">–</span>
                      ),
                    },
                    { term: "Metadata", value: formatMetadata(app.metadata) },
                    { term: "Created", value: formatTimestamp(app.createdAt) },
                    { term: "Updated", value: formatTimestamp(app.updatedAt) },
                  ]}
                />
              }
              aside={<EditApp app={app} />}
            />
          </>
        )}
      </QueryBoundary>
    </section>
  )
}
