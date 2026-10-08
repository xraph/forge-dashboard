import { useState } from "react"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { CommandAlert } from "@forge-go/dashboard-kit/components/query-boundary"
import { Textarea } from "@forge-go/dashboard-kit/components/textarea"
import { useCommand, useQuery } from "@forge-go/dashboard-plugin"
import type { ErasurePreviewResponse, ErasureResult } from "../types"
import { LIMITS } from "../types"
import { formatSeq } from "../format"

/** The server's rules for a subject id, checked before sending so the operator sees them at once. */
export function subjectProblem(s: string): string | null {
  if (s === "") return null
  if (s !== s.trim())
    return "A subject ID cannot have a leading or trailing space."
  if ([...s].length > LIMITS.erasureSubjectId)
    return `A subject ID is at most ${LIMITS.erasureSubjectId} characters.`
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f-\u009f]/.test(s))
    return "A subject ID cannot contain control characters."
  return null
}

export function reasonProblem(r: string): string | null {
  if ([...r].length > LIMITS.erasureReason)
    return `A reason is at most ${LIMITS.erasureReason} characters.`
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/.test(r))
    return "A reason cannot contain control characters other than a line break."
  return null
}

const plural = (n: number) => (n === 1 ? "event" : "events")

/**
 * The form is the confirm dialog's children, so it stays inside the dialog
 * that Base UI keeps interactive. The kit's confirm button does not close the
 * dialog, which is what lets the result stay on screen after erasing.
 */
export function ErasureRequestDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  // Mounted only while open, so every opening starts from an empty form, no
  // count and no result. The state that matters is what the operator is looking
  // at now, and a remount is the reset that cannot be forgotten or race a
  // command still in flight.
  return open ? <ErasureRequestForm onOpenChange={onOpenChange} /> : null
}

function ErasureRequestForm({
  onOpenChange,
}: {
  onOpenChange: (open: boolean) => void
}) {
  const [subject, setSubject] = useState("")
  const [reason, setReason] = useState("")
  const [counted, setCounted] = useState<string | null>(null)
  const request = useCommand<ErasureResult>("erasures.request")
  const preview = useQuery<ErasurePreviewResponse>(
    "erasures.preview",
    { subjectId: counted ?? "" },
    { enabled: counted !== null }
  )

  const sProblem = subjectProblem(subject)
  const rProblem = reasonProblem(reason)
  const current = counted !== null && counted === subject
  const done = request.data !== undefined
  const ready =
    current &&
    !preview.loading &&
    preview.data !== undefined &&
    !sProblem &&
    !rProblem &&
    reason.trim() !== ""

  return (
    <ConfirmDialog
      open
      // Escape and an outside click would unmount the form and drop the result of a request still in flight.
      onOpenChange={(next) => {
        if (!next && request.loading) return
        onOpenChange(next)
      }}
      title="Request an erasure"
      confirmLabel="Erase"
      cancelLabel={done ? "Close" : "Cancel"}
      pending={request.loading}
      confirmDisabled={!ready || done}
      // No idempotency key is passed: the client mints a fresh one for every
      // execute(), so each confirm is a new request rather than a replay of one
      // that may already have destroyed a key.
      onConfirm={() => void request.execute({ subjectId: subject, reason })}
      description="Erasure destroys this subject's encryption key in your scope. Their sealed fields become unreadable and cannot be recovered. The events stay in the chain, so verification is unchanged."
    >
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span>Subject ID</span>
          <Input
            aria-label="Subject ID"
            className="font-mono text-xs"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
        </label>
        {sProblem && <span className="text-destructive">{sProblem}</span>}
        <label className="flex flex-col gap-1">
          <span>Reason</span>
          <Textarea
            aria-label="Reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        {rProblem && <span className="text-destructive">{rProblem}</span>}
        <Button
          type="button"
          variant="outline"
          disabled={
            subject === "" ||
            sProblem !== null ||
            done ||
            (current && preview.loading)
          }
          // Counting the subject already counted asks again: the number is
          // what the operator is about to act on, so it should be current.
          onClick={() => (current ? preview.refetch() : setCounted(subject))}
        >
          Count affected events
        </Button>
        {current && preview.loading && <span role="status">Counting...</span>}
        {/* After the request the server invalidates this count, and a refreshed "0 events will be erased" beside the result would read as a contradiction. */}
        {current && !done && preview.data && (
          <span>{`${formatSeq(preview.data.eventsAffected)} ${plural(preview.data.eventsAffected)} in your scope will have their sealed fields erased.`}</span>
        )}
        {current && !done && (
          <CommandAlert
            title="Could not count the events"
            error={preview.error}
          />
        )}
        {request.data && <ErasureOutcome r={request.data} />}
        <CommandAlert
          title="Could not request the erasure"
          error={request.error}
        />
      </div>
    </ConfirmDialog>
  )
}

function ErasureOutcome({ r }: { r: ErasureResult }) {
  if (r.legacyKeyRetained) {
    return (
      <span role="status">
        {`${formatSeq(r.eventsAffected)} ${plural(r.eventsAffected)} ${r.eventsAffected === 1 ? "is" : "are"} marked erased, and no read path shows their content. The erasure is not yet cryptographic: their key predates per-scope keys and events in another scope still use it, so it was kept. It is destroyed the first time an erasure finds no other scope using it.`}
      </span>
    )
  }
  return (
    <span role="status">{`${formatSeq(r.eventsAffected)} ${plural(r.eventsAffected)} erased. The key is destroyed.`}</span>
  )
}
