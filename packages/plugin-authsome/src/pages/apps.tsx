import { useState } from "react"
import { useCommand, useQuery } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
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

/** One row of `apps.list`. */
export interface AppSummary {
  id: string
  name: string
  slug: string
  isPlatform: boolean
  createdAt: string
}

export interface AppsList {
  apps: AppSummary[]
}

/**
 * Apps, with delete.
 *
 * `apps.list` needs no params and is not paged, so there is no filter bar and
 * no pager here. Create lives on its own route rather than an inline panel:
 * a slug has to be unique, and that deserves more room than a table-header
 * drawer gives it.
 *
 * The platform app renders no Delete button at all, not a disabled one.
 * Deleting it takes every user, session, environment and setting with it, and
 * that is not a thing an operator should be one mis-click away from.
 */
export function AuthAppsPage() {
  const [deleting, setDeleting] = useState<AppSummary | null>(null)

  const list = useQuery<AppsList>("apps.list")
  const remove = useCommand<AckResponse>("apps.delete")

  async function confirmDelete() {
    if (!deleting) return
    const result = await remove.execute({ id: deleting.id })
    if (result !== undefined) setDeleting(null)
  }

  const columns: Column<AppSummary>[] = [
    { id: "name", header: "Name", cell: (a) => a.name, className: "font-medium" },
    { id: "slug", header: "Slug", cell: (a) => a.slug, className: "font-mono text-xs" },
    {
      id: "platform",
      header: "Platform",
      cell: (a) => (
        <Badge variant={a.isPlatform ? "secondary" : "outline"}>
          {a.isPlatform ? "platform" : "app"}
        </Badge>
      ),
    },
    { id: "createdAt", header: "Created", cell: (a) => formatTimestamp(a.createdAt) },
  ]

  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title="Apps"
        actions={
          <a href="/@auth/apps/create" className="text-sm underline underline-offset-4">
            New app
          </a>
        }
      />

      <QueryBoundary title="Apps" query={list} skeletonRows={5}>
        {(data) => {
          const apps = data.apps ?? []

          return (
            <ResourceTable<AppSummary>
              columns={columns}
              rows={apps}
              rowKey={(a) => a.id}
              caption={`${apps.length} ${apps.length === 1 ? "app" : "apps"}`}
              emptyMessage="No apps yet."
              rowActions={(app) => (
                <>
                  <a
                    href={`/@auth/apps/${app.id}`}
                    className="text-sm underline underline-offset-4"
                  >
                    Details
                  </a>
                  {!app.isPlatform && (
                    <Button
                      variant="destructive"
                      size="sm"
                      aria-label={`Delete ${app.name}`}
                      onClick={() => setDeleting(app)}
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
        The delete error lives inside the dialog's description, not above the
        table. Base UI marks everything outside an open AlertDialog `inert`
        and `aria-hidden`, so an alert rendered up here is unreachable for as
        long as the dialog that can fail is open.
      */}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete ${deleting?.name ?? ""}?`}
        description={
          <span className="flex flex-col gap-2">
            <span>
              Everything scoped to this app goes with it: users, sessions,
              environments and settings. This cannot be undone.
            </span>
            <CommandAlert error={remove.error} title="Could not delete" />
          </span>
        }
        confirmLabel="Delete"
        pending={remove.loading}
        onConfirm={() => void confirmDelete()}
      />
    </section>
  )
}
