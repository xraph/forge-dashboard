import { useEffect, useId, useRef, useState } from "react"
import type { FormEvent } from "react"
import { useCommand } from "@forge-go/dashboard-plugin"
import type { CommandState } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@forge-go/dashboard-kit/components/dialog"
import { Field, FieldDescription, FieldGroup } from "@forge-go/dashboard-kit/components/field"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import type { Baseline, Run } from "../types"

/**
 * runs.cancel. Cases already scored keep their results and no new case
 * starts, which is the cost worth saying; the run cannot be resumed.
 */
export function CancelRunDialog({
  open,
  onOpenChange,
  run,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  run: Pick<Run, "id" | "completedCases" | "totalCases">
}) {
  const command = useCommand<Run>("runs.cancel")
  const { reset } = command
  const sending = useRef(false)
  useEffect(() => {
    if (open) reset()
  }, [open, reset])
  async function confirm() {
    if (sending.current || command.loading) return
    sending.current = true
    let result: Run | undefined
    try {
      result = await command.execute({ runId: run.id })
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
      title="Cancel this run?"
      description={`${run.completedCases} of ${run.totalCases} cases are scored. They keep their results, no new case starts, and the run cannot be resumed.`}
      confirmLabel="Cancel run"
      cancelLabel="Keep running"
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

const NAME_REQUIRED = "a baseline needs a name"

/**
 * baselines.save. The new baseline becomes the suite's only current one, so
 * every later run compares against it; the dialog says so before the name is
 * typed.
 */
export function SaveBaselineDialog({
  open,
  onOpenChange,
  runId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  runId: string
}) {
  const command = useCommand<Baseline>("baselines.save")
  const { reset } = command
  useEffect(() => {
    if (open) reset()
  }, [open, reset])
  const locked = command.loading
  return (
    <Dialog
      open={open}
      onOpenChange={(next, details) => {
        if (!next && locked) {
          details.cancel()
          return
        }
        onOpenChange(next)
      }}
      disablePointerDismissal={locked}
    >
      <DialogContent showCloseButton={!locked} className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-md">
        <SaveBaselineForm command={command} runId={runId} onSaved={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function SaveBaselineForm({
  command,
  runId,
  onSaved,
}: {
  command: CommandState<Baseline>
  runId: string
  onSaved: () => void
}) {
  const id = useId()
  const [name, setName] = useState("")
  const [problem, setProblem] = useState<string | null>(null)
  const sending = useRef(false)
  const message = problem ?? command.error?.message
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (sending.current || command.loading) return
    if (name.trim() === "") return setProblem(NAME_REQUIRED)
    setProblem(null)
    sending.current = true
    let saved: Baseline | undefined
    try {
      saved = await command.execute({ runId, name: name.trim() })
    } finally {
      sending.current = false
    }
    if (saved) onSaved()
  }
  return (
    <form onSubmit={(e) => void submit(e)} className="contents" noValidate>
      <DialogHeader>
        <DialogTitle>Save as baseline</DialogTitle>
      </DialogHeader>
      <FieldGroup>
        <Field>
          <Label htmlFor={`${id}-name`}>Name</Label>
          <Input
            id={`${id}-name`}
            value={name}
            autoComplete="off"
            aria-invalid={message ? true : undefined}
            aria-describedby={message ? `${id}-error` : undefined}
            onChange={(e) => setName(e.target.value)}
          />
          <FieldDescription>
            It becomes the suite's current baseline, so every later run is compared with this one.
          </FieldDescription>
        </Field>
      </FieldGroup>
      {message && (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />} disabled={command.loading}>
          Cancel
        </DialogClose>
        <Button type="submit" disabled={command.loading}>
          Save baseline
        </Button>
      </DialogFooter>
    </form>
  )
}
