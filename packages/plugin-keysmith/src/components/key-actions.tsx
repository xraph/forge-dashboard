import { useCallback, useEffect, useId, useRef, useState } from "react"
import { useCommand } from "@forge-go/dashboard-plugin"
import type { ContractError } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { Textarea } from "@forge-go/dashboard-kit/components/textarea"
import type { KeyOnly, KeySummary } from "../types"

/*
 * Revoke, suspend and reactivate: the three commands that change a key's
 * state. The two dialogs and the reactivate hook all belong ABOVE the detail
 * page's QueryBoundary. Each command invalidates keys.detail, the boundary
 * shows its skeleton while that refetches, and anything under it unmounts
 * with its error and its pending state.
 */

/** Which of the three a key offers, by its effective state. */
export function stateActionsFor(summary: KeySummary): {
  suspend: boolean
  reactivate: boolean
  revoke: boolean
} {
  const state = summary.effectiveState
  return {
    // The server checks the effective state too, so an active key past its
    // expiry (shown as expired) is refused and is not offered.
    suspend: state === "active",
    reactivate: state === "suspended",
    revoke: state !== "revoked",
  }
}

export interface KeyStateActionsProps {
  summary: KeySummary
  onSuspend: () => void
  onRevoke: () => void
  onReactivate: () => void
  /** Reactivate is out. It has no dialog, so its button is what waits. */
  reactivating: boolean
}

/** The buttons, for the page header. They open dialogs and do nothing else. */
export function KeyStateActions({
  summary,
  onSuspend,
  onRevoke,
  onReactivate,
  reactivating,
}: KeyStateActionsProps) {
  const offer = stateActionsFor(summary)
  return (
    <>
      {offer.suspend && (
        <Button variant="outline" onClick={onSuspend}>
          Suspend
        </Button>
      )}
      {offer.reactivate && (
        <Button variant="outline" disabled={reactivating} onClick={onReactivate}>
          Reactivate
        </Button>
      )}
      {offer.revoke && (
        <Button variant="destructive" onClick={onRevoke}>
          Revoke
        </Button>
      )}
    </>
  )
}

export interface ReactivateKey {
  /** Sends keys.reactivate. A second call while one is out does nothing. */
  reactivate: () => void
  loading: boolean
  error?: ContractError
  /**
   * Drops a refusal, for when another action starts and it no longer applies.
   * Does nothing while a reactivate is out: resetting then would throw away
   * its answer when it lands, and free the button before it settles.
   */
  reset: () => void
}

/**
 * keys.reactivate, straight from its button. Putting a key back into service
 * is what the operator suspended it to be able to do, so there is no confirm.
 */
export function useReactivateKey(keyId: string): ReactivateKey {
  const { execute, loading, error, reset } = useCommand<KeyOnly>("keys.reactivate")
  // Set synchronously, so a second click in the same tick cannot slip past a
  // button that has not re-rendered as disabled yet.
  const sending = useRef(false)

  const reactivate = useCallback(() => {
    if (sending.current) return
    sending.current = true
    void execute({ id: keyId }).finally(() => {
      sending.current = false
    })
  }, [execute, keyId])

  // Checked against the ref, not `loading`, so a reset in the same tick as
  // the click still sees the command as out.
  const resetSettled = useCallback(() => {
    if (!sending.current) reset()
  }, [reset])

  return { reactivate, loading, error, reset: resetSettled }
}

export interface KeyStateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  keyId: string
  /**
   * The key as `maskedKey` gives it, taken when the dialog opened. The page
   * refetches under the dialog, so the title is not read from live data.
   */
  masked: string
  /** Runs once the command succeeded, before the dialog closes. */
  onDone?: () => void
}

/**
 * The confirmation for keys.revoke. It asks why, because the server refuses a
 * revoke without a reason. The reason goes to the audit trail (the engine
 * hands it to its revoke hooks); the engine does not store it on the key, so
 * the key's page never shows it.
 */
export function RevokeKeyDialog({
  open,
  onOpenChange,
  keyId,
  masked,
  onDone,
}: KeyStateDialogProps) {
  const revoke = useCommand<KeyOnly>("keys.revoke")
  const { reset } = revoke
  const reasonId = useId()
  const [reason, setReason] = useState("")
  const sending = useRef(false)

  // A failure sticks to the hook, so it is cleared as the dialog opens.
  useEffect(() => {
    if (open) reset()
  }, [open, reset])
  // And so is the reason the last attempt carried, during the render that
  // opens the dialog, so the old text never shows for a frame.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setReason("")
  }

  const trimmed = reason.trim()

  async function confirm() {
    if (sending.current || revoke.loading || trimmed === "") return
    sending.current = true
    let result: KeyOnly | undefined
    try {
      result = await revoke.execute({ id: keyId, reason: trimmed })
    } finally {
      sending.current = false
    }
    if (!result) return
    onDone?.()
    onOpenChange(false)
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        // Closing while the command is out would hide its answer.
        if (!next && (revoke.loading || sending.current)) return
        onOpenChange(next)
      }}
      title={`Revoke ${masked}?`}
      description="Requests using this key fail from now on, and any open grace window ends with it. A revoked key cannot be brought back."
      confirmLabel="Revoke"
      pending={revoke.loading}
      confirmDisabled={trimmed === ""}
      onConfirm={() => void confirm()}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={reasonId}>Reason</Label>
        <Textarea
          id={reasonId}
          value={reason}
          disabled={revoke.loading}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      {revoke.error && (
        <p role="alert" className="text-sm text-destructive">
          {revoke.error.message}
        </p>
      )}
    </ConfirmDialog>
  )
}

/** The confirmation for keys.suspend. Suspending can be undone, so it is not painted destructive. */
export function SuspendKeyDialog({
  open,
  onOpenChange,
  keyId,
  masked,
  onDone,
}: KeyStateDialogProps) {
  const suspend = useCommand<KeyOnly>("keys.suspend")
  const { reset } = suspend
  const sending = useRef(false)

  useEffect(() => {
    if (open) reset()
  }, [open, reset])

  async function confirm() {
    if (sending.current || suspend.loading) return
    sending.current = true
    let result: KeyOnly | undefined
    try {
      result = await suspend.execute({ id: keyId })
    } finally {
      sending.current = false
    }
    if (!result) return
    onDone?.()
    onOpenChange(false)
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && (suspend.loading || sending.current)) return
        onOpenChange(next)
      }}
      title={`Suspend ${masked}?`}
      description="Requests using it fail until you reactivate it. Open grace windows keep running."
      confirmLabel="Suspend"
      destructive={false}
      pending={suspend.loading}
      onConfirm={() => void confirm()}
    >
      {suspend.error && (
        <p role="alert" className="text-sm text-destructive">
          {suspend.error.message}
        </p>
      )}
    </ConfirmDialog>
  )
}
