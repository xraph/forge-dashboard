import type { ReactNode } from "react"
import { cn } from "@forge-go/dashboard-kit/lib/utils"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@forge-go/dashboard-kit/components/alert-dialog"

export interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Names the exact thing about to happen. "Ban ada@example.com?" */
  title: string
  /** What it costs. Consequences the operator cannot undo belong here. */
  description?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** Paints the confirm button as destructive. Default true. */
  destructive?: boolean
  /** The command is in flight. Disables confirm and swaps its label. */
  pending?: boolean
  /**
   * The dialog collects something and does not have it yet.
   *
   * Separate from `pending` because they are different states and read
   * differently: `pending` means "working on it" and swaps the label, this
   * means "not yet" and leaves the label alone. A dialog that asks for a
   * reason and cannot express "no reason yet" has to either block on nothing
   * or send an empty one, and both are worse than a button that waits.
   */
  confirmDisabled?: boolean
  onConfirm: () => void
  className?: string
}

/**
 * The step between clicking Delete and the row disappearing.
 *
 * Controlled, and with no trigger of its own. Every caller already knows which
 * row is being acted on, and a self-triggering dialog would need that value
 * passed in anyway.
 *
 * The confirm button stays enabled after `onConfirm` fires unless the caller
 * sets `pending`, because this block cannot know whether the command it
 * triggered is asynchronous.
 *
 * Cancel is disabled while `pending` and stays enabled while `confirmDisabled`.
 * An operator who cannot yet confirm must always still be able to back out.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = true,
  pending = false,
  confirmDisabled = false,
  onConfirm,
  className,
}: ConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className={cn(className)}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && (
            <AlertDialogDescription>{description}</AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            variant={destructive ? "destructive" : "default"}
            disabled={pending || confirmDisabled}
            onClick={onConfirm}
          >
            {pending ? "Working…" : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
