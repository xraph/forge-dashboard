import type { ReactNode } from "react"
import type { CommandState } from "@forge-go/dashboard-plugin"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { CommandAlert } from "@forge-go/dashboard-kit/components/query-boundary"

/**
 * One confirmation dialog for one command. The refusal renders inside the
 * dialog, because Base UI makes everything outside an open dialog inert, and
 * the dialog stays open on failure so the operator can read it. `pending`
 * keeps a double click from sending twice. The caller resets the command when
 * it opens the dialog.
 */
export function ConfirmAction<T>({
  open,
  onOpenChange,
  title,
  description,
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
  description: ReactNode
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
      onOpenChange={onOpenChange}
      title={title}
      description={
        <span className="flex flex-col gap-2">
          <span>{description}</span>
          <CommandAlert error={command.error} title={`Could not ${confirmLabel.toLowerCase()}`} />
        </span>
      }
      confirmLabel={confirmLabel}
      destructive={destructive}
      pending={command.loading}
      confirmDisabled={confirmDisabled}
      onConfirm={() => void confirm()}
    />
  )
}
