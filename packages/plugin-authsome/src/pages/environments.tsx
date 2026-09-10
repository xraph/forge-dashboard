import { useState } from "react"
import { useCommand, useQuery } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { Textarea } from "@forge-go/dashboard-kit/components/textarea"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import {
  CommandAlert,
  QueryBoundary,
} from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { formatTimestamp } from "@forge-go/dashboard-kit/lib/format"
import type { AckResponse } from "./users"

/** One row of `environments.list`. */
export interface EnvSummary {
  id: string
  name: string
  slug: string
  type: string
  isDefault: boolean
  createdAt: string
}

export interface EnvironmentsList {
  environments: EnvSummary[]
}

function CreateEnvironmentForm({ onClose }: { onClose: () => void }) {
  const create = useCommand<AckResponse>("environments.create")
  const [name, setName] = useState("")
  const [slug, setSlug] = useState("")
  const [type, setType] = useState("")
  const [description, setDescription] = useState("")
  const [color, setColor] = useState("")

  async function submit() {
    const result = await create.execute({
      name,
      slug,
      // Optional in the contract. Each key is omitted outright rather than
      // set to `undefined`: `JSON.stringify` drops either one on the wire,
      // but only the omitted form is honest about what the payload object
      // itself holds.
      ...(type ? { type } : {}),
      ...(description ? { description } : {}),
      ...(color ? { color } : {}),
    })
    if (result === undefined) return
    onClose()
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border p-4">
      <h2 className="text-sm font-medium">New environment</h2>
      <CommandAlert error={create.error} title="Could not create the environment" />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-env-name">Name</Label>
        <Input id="new-env-name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-env-slug">Slug</Label>
        <Input id="new-env-slug" value={slug} onChange={(e) => setSlug(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-env-type">Type</Label>
        <Input id="new-env-type" value={type} onChange={(e) => setType(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-env-description">Description</Label>
        <Textarea
          id="new-env-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-env-color">Color</Label>
        <Input id="new-env-color" value={color} onChange={(e) => setColor(e.target.value)} />
      </div>
      <div className="flex items-center gap-2">
        <Button
          onClick={() => void submit()}
          disabled={create.loading || name.trim() === "" || slug.trim() === ""}
        >
          {create.loading ? "Creating…" : "Create environment"}
        </Button>
        <Button variant="outline" onClick={onClose} disabled={create.loading}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

/**
 * Environments, with clone, make-default and delete.
 *
 * `environments.list` needs no params and is not paged, so there is no
 * filter bar and no pager here. Create is an inline panel, same shape as
 * roles: unlike an app's slug, an environment's does not carry the same
 * uniqueness weight that earns apps their own route.
 *
 * The default environment renders no "Make default" and no Delete button at
 * all, not disabled ones. It is already the default, and deleting it is not a
 * thing an operator should be one mis-click away from - the same reason the
 * platform app offers no Delete.
 */
export function AuthEnvironmentsPage() {
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<EnvSummary | null>(null)
  const [cloning, setCloning] = useState<EnvSummary | null>(null)
  const [cloneName, setCloneName] = useState("")
  const [cloneSlug, setCloneSlug] = useState("")
  const [cloneType, setCloneType] = useState("")

  const list = useQuery<EnvironmentsList>("environments.list")
  const remove = useCommand<AckResponse>("environments.delete")
  const setDefault = useCommand<AckResponse>("environments.setDefault")
  const clone = useCommand<AckResponse>("environments.clone")

  function closeClone() {
    setCloning(null)
    setCloneName("")
    setCloneSlug("")
    setCloneType("")
  }

  async function confirmDelete() {
    if (!deleting) return
    const result = await remove.execute({ id: deleting.id })
    if (result !== undefined) setDeleting(null)
  }

  async function confirmClone() {
    if (!cloning) return
    const result = await clone.execute({
      sourceId: cloning.id,
      name: cloneName,
      slug: cloneSlug,
      ...(cloneType ? { type: cloneType } : {}),
    })
    if (result !== undefined) closeClone()
  }

  const columns: Column<EnvSummary>[] = [
    { id: "name", header: "Name", cell: (e) => e.name, className: "font-medium" },
    { id: "slug", header: "Slug", cell: (e) => e.slug, className: "font-mono text-xs" },
    { id: "type", header: "Type", cell: (e) => e.type },
    {
      id: "default",
      header: "Default",
      cell: (e) => (
        <Badge variant={e.isDefault ? "secondary" : "outline"}>
          {e.isDefault ? "default" : "not default"}
        </Badge>
      ),
    },
    { id: "createdAt", header: "Created", cell: (e) => formatTimestamp(e.createdAt) },
  ]

  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title="Environments"
        actions={
          !creating && (
            <Button size="sm" onClick={() => setCreating(true)}>
              New environment
            </Button>
          )
        }
      />

      {creating && <CreateEnvironmentForm onClose={() => setCreating(false)} />}

      <CommandAlert error={setDefault.error} title="Could not set the default environment" />

      <QueryBoundary title="Environments" query={list} skeletonRows={5}>
        {(data) => {
          const environments = data.environments ?? []

          return (
            <ResourceTable<EnvSummary>
              columns={columns}
              rows={environments}
              rowKey={(e) => e.id}
              caption={`${environments.length} ${environments.length === 1 ? "environment" : "environments"}`}
              emptyMessage="No environments yet."
              rowActions={(env) => (
                <>
                  <a
                    href={`/@auth/environments/${env.id}`}
                    className="text-sm underline underline-offset-4"
                  >
                    Details
                  </a>
                  {!env.isDefault && (
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={`Make ${env.name} the default`}
                      disabled={setDefault.loading}
                      onClick={() => void setDefault.execute({ id: env.id })}
                    >
                      Make default
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`Clone ${env.name}`}
                    onClick={() => setCloning(env)}
                  >
                    Clone
                  </Button>
                  {!env.isDefault && (
                    <Button
                      variant="destructive"
                      size="sm"
                      aria-label={`Delete ${env.name}`}
                      onClick={() => setDeleting(env)}
                    >
                      Delete
                    </Button>
                  )}
                </>
              )}
            />
          )
        }}
      </QueryBoundary>

      {/*
        Both error alerts live inside their dialog's description, not above
        the table. Base UI marks everything outside an open AlertDialog
        `inert` and `aria-hidden`, so an alert rendered up here is
        unreachable for as long as the dialog that can fail is open.
      */}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete ${deleting?.name ?? ""}?`}
        description={
          <span className="flex flex-col gap-2">
            <span>Everything scoped to this environment goes with it. This cannot be undone.</span>
            <CommandAlert error={remove.error} title="Could not delete" />
          </span>
        }
        confirmLabel="Delete"
        pending={remove.loading}
        onConfirm={() => void confirmDelete()}
      />

      <ConfirmDialog
        open={cloning !== null}
        onOpenChange={(open) => !open && closeClone()}
        title={`Clone ${cloning?.name ?? ""}?`}
        destructive={false}
        confirmLabel="Clone"
        pending={clone.loading}
        confirmDisabled={cloneName.trim() === "" || cloneSlug.trim() === ""}
        onConfirm={() => void confirmClone()}
        description={
          <span className="flex flex-col gap-3">
            <span>Copies its settings into a new environment under the same app.</span>
            <span className="flex flex-col gap-1.5">
              <Label htmlFor="clone-env-name">New name</Label>
              <Input id="clone-env-name" value={cloneName} onChange={(e) => setCloneName(e.target.value)} />
            </span>
            <span className="flex flex-col gap-1.5">
              <Label htmlFor="clone-env-slug">New slug</Label>
              <Input id="clone-env-slug" value={cloneSlug} onChange={(e) => setCloneSlug(e.target.value)} />
            </span>
            <span className="flex flex-col gap-1.5">
              <Label htmlFor="clone-env-type">Type</Label>
              <Input id="clone-env-type" value={cloneType} onChange={(e) => setCloneType(e.target.value)} />
            </span>
            <CommandAlert error={clone.error} title="Could not clone" />
          </span>
        }
      />
    </section>
  )
}
