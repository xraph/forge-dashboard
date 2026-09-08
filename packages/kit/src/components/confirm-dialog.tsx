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
            disabled={pending}
            onClick={onConfirm}
          >
            {pending ? "Working…" : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
