import { useState } from "react"
import type { ReactNode } from "react"
import { useCommand, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { Textarea } from "@forge-go/dashboard-kit/components/textarea"
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
import type { EnvSummary } from "./environments"

/** `environments.detail`. EnvDetail embeds EnvSummary in Go, so the JSON is flat. */
export interface EnvDetail extends EnvSummary {
  appId?: string
  color?: string
  description?: string
  clonedFrom?: string
  metadata?: Record<string, string>
  updatedAt: string
}

function formatMetadata(metadata?: Record<string, string>): ReactNode {
  const entries = Object.entries(metadata ?? {})
  if (entries.length === 0) {
    return <NoneCell label="metadata" />
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

function EditEnvironment({ env }: { env: EnvDetail }) {
  const update = useCommand<AckResponse>("environments.update")
  const [name, setName] = useState(env.name)
  const [description, setDescription] = useState(env.description ?? "")
  const [color, setColor] = useState(env.color ?? "")

  // Only what actually changed. `environments.update` declares these as Go
  // pointers precisely so "leave unchanged" and "set to empty" stay
  // different things, and an untouched field sent as "" blanks it on the
  // server.
  const changed: Record<string, unknown> = { id: env.id }
  if (name !== env.name) changed.name = name
  if (description !== (env.description ?? "")) changed.description = description
  if (color !== (env.color ?? "")) changed.color = color
  const dirty = Object.keys(changed).length > 1

  return (
    <div className="flex flex-col gap-3 rounded-md border p-4">
      <h2 className="text-sm font-medium">Edit</h2>
      <CommandAlert error={update.error} title="Could not save" />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="env-name">Name</Label>
        <Input id="env-name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="env-description">Description</Label>
        <Textarea
          id="env-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="env-color">Color</Label>
        <Input id="env-color" value={color} onChange={(e) => setColor(e.target.value)} />
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

export function AuthEnvironmentDetailPage({ params }: PluginPageProps) {
  const envId = params.id
  if (!envId) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        No environment selected.
      </p>
    )
  }
  return <EnvironmentDetailBody envId={envId} />
}

function EnvironmentDetailBody({ envId }: { envId: string }) {
  const query = useQuery<EnvDetail>("environments.detail", { id: envId })

  return (
    <section className="flex flex-col gap-4">
      <QueryBoundary title="Environment" query={query} skeletonRows={3}>
        {(env) => (
          <>
            <PageHeader title={env.name} description={env.slug} />
            <DetailLayout
              main={
                <DescriptionList
                  items={[
                    { term: "Slug", value: <span className="font-mono text-xs">{env.slug}</span> },
                    { term: "Type", value: env.type },
                    {
                      term: "Default",
                      value: (
                        <Badge variant={env.isDefault ? "outline" : "secondary"}>
                          {env.isDefault ? "default" : "not default"}
                        </Badge>
                      ),
                    },
                    {
                      term: "App",
                      value: env.appId ? (
                        <span className="font-mono text-xs">{env.appId}</span>
                      ) : (
                        <NoneCell label="app" />
                      ),
                    },
                    { term: "Description", value: env.description || <NoneCell label="description" /> },
                    { term: "Color", value: env.color || <NoneCell label="color" /> },
                    {
                      term: "Cloned from",
                      value: env.clonedFrom ? (
                        <span className="font-mono text-xs">{env.clonedFrom}</span>
                      ) : (
                        <NoneCell label="clone source" />
                      ),
                    },
                    { term: "Metadata", value: formatMetadata(env.metadata) },
                    { term: "Created", value: formatTimestamp(env.createdAt) },
                    { term: "Updated", value: formatTimestamp(env.updatedAt) },
                  ]}
                />
              }
              aside={<EditEnvironment env={env} />}
            />
          </>
        )}
      </QueryBoundary>
    </section>
  )
}
