import { useEffect, useRef } from "react"
import { useCommand } from "@forge-go/dashboard-plugin"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import type { KeyGraceClosed } from "../types"

export interface EndGraceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  keyId: string
  /**
   * The previous keys that would stop working, as `maskedKey` gives them.
   * keys.endGrace closes every window on the key, so a list of several is
   * named as "every previous key" and not as the one that was clicked.
   */
  masked: string[]
  /** Runs after the server answered, once, before the dialog closes. */
  onEnded?: (result: KeyGraceClosed) => void
}

/**
 * The confirmation in front of "End now", for the key's detail page and for
 * the rotate dialog's reveal. It owns its command so both places send exactly
 * the same thing.
 */
export function EndGraceDialog({
  open,
  onOpenChange,
  keyId,
  masked,
  onEnded,
}: EndGraceDialogProps) {
  const end = useCommand<KeyGraceClosed>("keys.endGrace")
  const { reset } = end
  // Set synchronously, so a second click in the same tick cannot slip past a
  // button that has not re-rendered as disabled yet.
  const sending = useRef(false)

  // A failure sticks to the hook, so it is cleared as the dialog opens: what
  // the operator sees now is not the last attempt's error.
  useEffect(() => {
    if (open) reset()
  }, [open, reset])

  const several = masked.length > 1

  async function confirm() {
    if (sending.current || end.loading) return
    sending.current = true
    let result: KeyGraceClosed | undefined
    try {
      result = await end.execute({ id: keyId })
    } finally {
      sending.current = false
    }
    if (!result) return
    onEnded?.(result)
    onOpenChange(false)
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        // Closing while the command is out would hide its answer.
        if (!next && (end.loading || sending.current)) return
        onOpenChange(next)
      }}
      title={
        several
          ? "Stop accepting every previous key?"
          : `Stop accepting ${masked[0] ?? "the previous key"}?`
      }
      description={
        several
          ? "Requests using any of them fail from now on. This cannot be undone."
          : "Requests using it fail from now on. This cannot be undone."
      }
      confirmLabel="End now"
      pending={end.loading}
      onConfirm={() => void confirm()}
    >
      {end.error && (
        <p role="alert" className="text-sm text-destructive">
          {end.error.message}
        </p>
      )}
    </ConfirmDialog>
  )
}
