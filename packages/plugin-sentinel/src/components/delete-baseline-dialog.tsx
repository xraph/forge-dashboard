import { useEffect, useRef } from "react"
import { useCommand } from "@forge-go/dashboard-plugin"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import type { Baseline } from "../types"

/**
 * baselines.delete. Deleting the current baseline promotes nothing in its
 * place, so the confirm says that later runs will have nothing to compare
 * against. The run it came from is kept either way.
 */
export function DeleteBaselineDialog({
  open,
  onOpenChange,
  baseline,
  onDeleted,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  baseline: Pick<Baseline, "id" | "name" | "isCurrent" | "suiteName">
  /** After a delete, such as leaving a page whose baseline no longer exists. */
  onDeleted?: () => void
}) {
  const command = useCommand<{ baselineId: string }>("baselines.delete")
  const { reset } = command
  const sending = useRef(false)
  useEffect(() => {
    if (open) reset()
  }, [open, reset])
  async function confirm() {
    if (sending.current || command.loading) return
    sending.current = true
    let result: { baselineId: string } | undefined
    try {
      result = await command.execute({ baselineId: baseline.id })
    } finally {
      sending.current = false
    }
    if (!result) return
    onOpenChange(false)
    onDeleted?.()
  }
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && (command.loading || sending.current)) return
        onOpenChange(next)
      }}
      title={`Delete ${baseline.name}?`}
      description={
        baseline.isCurrent
          ? `It is ${baseline.suiteName}'s current baseline. Nothing takes its place, so later runs have no baseline to compare against until you save another. The run it came from is kept.`
          : "The run it came from is kept. This cannot be undone."
      }
      confirmLabel="Delete baseline"
      pending={command.loading}
      onConfirm={() => void confirm()}
    >
      {command.error && (
        <p role="alert" className="text-sm text-destructive">
          {command.error.message}
        </p>
      )}
    </ConfirmDialog>
  )
}
