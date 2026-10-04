import type { ReactNode } from "react"
import type { CommandState } from "@forge-go/dashboard-plugin"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { CommandAlert } from "@forge-go/dashboard-kit/components/query-boundary"

/**
 * One confirmation dialog for one command. The refusal renders inside the
 * dialog, because Base UI makes everything outside an open dialog inert, and
 * the dialog stays open on failure so the operator can read it. `pending`
 * keeps a double click from sending twice.
 *
 * `description` is prose only: the kit renders it inside a `<p>`. Fields go in
 * `children`, which render below it and above the refusal. The caller must
 * call `command.reset()` when it opens the dialog.
 */
export function ConfirmAction<T>({
  open,
  onOpenChange,
  title,
  description,
  children,
  confirmLabel,
  destructive = false,
  command,
  payload,
  confirmDisabled = false,
  onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: ReactNode
  children?: ReactNode
  confirmLabel: string
  destructive?: boolean
  command: CommandState<T>
  payload: unknown
  confirmDisabled?: boolean
  onDone: (result: T) => void
}) {
  async function confirm() {
    const result = await command.execute(payload)
    if (result === undefined) return
    onDone(result)
  }
  return (
    <ConfirmDialog
      open={open}
      // Escape and an outside click would close the dialog on a pending command, and a refusal that then arrives has nowhere to show.
      onOpenChange={(next) => (next || !command.loading) && onOpenChange(next)}
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      destructive={destructive}
      pending={command.loading}
      confirmDisabled={confirmDisabled}
      onConfirm={() => void confirm()}
    >
      {children}
      <CommandAlert title={`Could not ${confirmLabel.toLowerCase()}`} error={command.error} />
    </ConfirmDialog>
  )
}
