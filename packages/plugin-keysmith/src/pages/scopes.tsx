import { IconButton } from "@forge-go/dashboard-kit/components/icon-button"
import { useEffect, useRef, useState } from "react"
import type { ComponentType } from "react"
import { useCommand, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { CreateScopeDialog } from "../components/create-scope-dialog"
import type { ScopesList, ScopeSummary } from "../types"

// scopes.list has no total, so the page asks for as many as the pickers do,
// with the same params so they share one store entry, and says when there
// were more.
const LIST_LIMIT = 200
const LIST_PARAMS = { limit: LIST_LIMIT }

const columns: Column<ScopeSummary>[] = [
  {
    id: "name",
    header: "Name",
    className: "font-mono text-xs",
    cell: (s) => s.name,
  },
  {
    id: "parent",
    header: "Parent",
    className: "font-mono text-xs",
    cell: (s) => s.parent || <NoneCell label="parent" />,
  },
  {
    id: "description",
    header: "Description",
    cell: (s) => s.description || <NoneCell label="description" />,
  },
]

export const ScopesPage: ComponentType<PluginPageProps> = () => {
  const list = useQuery<ScopesList>("scopes.list", LIST_PARAMS)
  // The dialogs sit outside the QueryBoundary, with their open state here.
  // Both commands invalidate scopes.list, the boundary shows its skeleton
  // while that refetches, and anything inside it unmounts with what was
  // typed, the pending state and the error.
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState(false)
  // Taken when Delete is pressed, so the question keeps its wording if a
  // refetch under the open dialog no longer lists the scope.
  const [target, setTarget] = useState<{ id: string; name: string } | null>(
    null
  )

  function startDeleting(s: ScopeSummary) {
    setTarget({ id: s.id, name: s.name })
    setDeleting(true)
  }

  const create = <Button onClick={() => setCreating(true)}>Create scope</Button>

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <PageHeader title="Scopes" actions={create} />
        <p className="text-sm text-muted-foreground">
          Parents are stored for your application. Keysmith does not use them
          when matching, so a key with{" "}
          <span className="font-mono text-xs text-foreground">read</span> does
          not also get{" "}
          <span className="font-mono text-xs text-foreground">read:users</span>.
        </p>
      </div>

      <QueryBoundary title="Scopes" query={list} skeletonRows={5}>
        {(data) => {
          const rows = data.scopes ?? []
          return (
            <div className="flex flex-col gap-1.5">
              <ResourceTable<ScopeSummary>
                columns={columns}
                rows={rows}
                rowKey={(s) => s.id}
                caption={
                  rows.length === 0
                    ? undefined
                    : `${rows.length} ${rows.length === 1 ? "scope" : "scopes"}`
                }
                emptyMessage="No scopes yet."
                emptyAction={create}
                rowActions={(s) => (
                  <IconButton
                    variant="outline"
                    onClick={() => startDeleting(s)}
                    label={`Delete ${s.name}`}
                  />
                )}
              />
              {data.hasMore && (
                <p className="text-xs text-muted-foreground">
                  {`Showing the first ${LIST_LIMIT} scopes.`}
                </p>
              )}
            </div>
          )
        }}
      </QueryBoundary>

      <CreateScopeDialog open={creating} onOpenChange={setCreating} />
      {target && (
        <DeleteScopeDialog
          open={deleting}
          onOpenChange={setDeleting}
          scopeId={target.id}
          name={target.name}
        />
      )}
    </section>
  )
}

/**
 * The confirmation for scopes.delete. The server refuses while another scope
 * names this one as its parent, or a policy allows it, and that refusal shows
 * here, in the body.
 */
function DeleteScopeDialog({
  open,
  onOpenChange,
  scopeId,
  name,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  scopeId: string
  /** The scope's name when Delete was pressed. */
  name: string
}) {
  const remove = useCommand<{ id: string }>("scopes.delete")
  const { reset } = remove
  // Set synchronously, so a second click in the same tick cannot slip past a
  // button that has not re-rendered as disabled yet.
  const sending = useRef(false)

  // A failure sticks to the hook, so it is cleared as the dialog opens.
  useEffect(() => {
    if (open) reset()
  }, [open, reset])

  async function confirm() {
    if (sending.current || remove.loading) return
    sending.current = true
    let result: { id: string } | undefined
    try {
      result = await remove.execute({ id: scopeId })
    } finally {
      sending.current = false
    }
    if (result) onOpenChange(false)
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        // Closing while the command is out would hide its answer.
        if (!next && (remove.loading || sending.current)) return
        onOpenChange(next)
      }}
      title={`Delete ${name}?`}
      description="Every key that holds it loses it. This cannot be undone."
      confirmLabel="Delete"
      pending={remove.loading}
      onConfirm={() => void confirm()}
    >
      {remove.error && (
        <p role="alert" className="text-sm text-destructive">
          {remove.error.message}
        </p>
      )}
    </ConfirmDialog>
  )
}
