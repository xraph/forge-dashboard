import { useState } from "react"
import type { ReactNode } from "react"
import { useCommand } from "@forge-go/dashboard-plugin"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { CommandAlert } from "@forge-go/dashboard-kit/components/query-boundary"

/** Mirrors the Go `overridesDeleteResponse`. */
interface DeleteOverrideResponse {
  ok: boolean
  key: string
  tenantId: string
}

interface Target {
  key: string
  tenantId: string
  sentence: ReactNode
  open: boolean
}

/**
 * The one way a tenant's override is taken away: `overrides.delete`, behind a
 * confirmation that says the tenant goes back to the app default.
 *
 * Setting an override to an empty value is a different act, and it is not
 * offered here. The words "Revert to app default" belong to this dialog and
 * the buttons that open it, and to nothing that sets a value.
 *
 * One command serves every row, so it is reset each time a dialog opens: an
 * earlier row's refusal must not greet the next one. The target stays after
 * the dialog closes, with `open` false, so the closing frame keeps its title.
 * The error renders inside the dialog, because everything outside an open
 * dialog is inert. And it cannot be closed while the command is in flight:
 * Escape goes through `onOpenChange` too, and a refusal would land nowhere.
 *
 * `sentence` is what happens to the tenant, said by the page: the entry page
 * knows the app default and names it, the overrides page does not.
 */
export function useRevertOverride(): {
  request: (key: string, tenantId: string, sentence: ReactNode) => void
  dialog: ReactNode
} {
  const remove = useCommand<DeleteOverrideResponse>("overrides.delete")
  const [target, setTarget] = useState<Target | null>(null)

  function request(key: string, tenantId: string, sentence: ReactNode) {
    remove.reset()
    setTarget({ key, tenantId, sentence, open: true })
  }

  function close() {
    setTarget((t) => (t === null ? null : { ...t, open: false }))
  }

  async function confirm() {
    if (target === null || !target.open) return
    const result = await remove.execute({ key: target.key, tenantId: target.tenantId })
    // execute() resolves undefined only when the client throws.
    if (result === undefined) return
    close()
  }

  const dialog = (
    <ConfirmDialog
      open={target?.open === true}
      onOpenChange={(next) => !next && !remove.loading && close()}
      title={`Revert ${target?.tenantId ?? ""} to the app default?`}
      description={
        <span className="flex flex-col gap-2">
          <span>{target?.sentence}</span>
          <CommandAlert error={remove.error} title="Could not revert the override" />
        </span>
      }
      confirmLabel="Revert to app default"
      pending={remove.loading}
      onConfirm={() => void confirm()}
    />
  )

  return { request, dialog }
}
