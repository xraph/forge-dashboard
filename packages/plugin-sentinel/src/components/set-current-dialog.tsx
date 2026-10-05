import { useEffect, useRef } from "react"
import { useCommand } from "@forge-go/dashboard-plugin"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import type { PromptVersion } from "../types"

/**
 * prompts.setCurrent. Not destructive: the version that was current stays,
 * and can be made current again. Runs already started keep the prompt they
 * recorded, which is the thing worth saying before somebody confirms.
 */
export function SetCurrentDialog({
  open,
  onOpenChange,
  version,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The version to make current, taken when the dialog opened. */
  version: Pick<PromptVersion, "id" | "suiteId" | "version">
}) {
  const command = useCommand<PromptVersion>("prompts.setCurrent")
  const { reset } = command
  const sending = useRef(false)
  useEffect(() => {
    if (open) reset()
  }, [open, reset])
  async function confirm() {
    if (sending.current || command.loading) return
    sending.current = true
    let result: PromptVersion | undefined
    try {
      result = await command.execute({ suiteId: version.suiteId, versionId: version.id })
    } finally {
      sending.current = false
    }
    if (result) onOpenChange(false)
  }
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && (command.loading || sending.current)) return
        onOpenChange(next)
      }}
      title={`Make version ${version.version} current?`}
      description="Runs started from now use its prompt. Runs already started keep the prompt they recorded."
      confirmLabel="Make current"
      destructive={false}
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
