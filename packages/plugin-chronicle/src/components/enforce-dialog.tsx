import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { useCommand, useQuery } from "@forge-go/dashboard-plugin"
import type { EnforceResponse, RetentionPreviewResponse } from "../types"
import { LIMITS } from "../types"
import { formatSeq } from "../format"
import { categoryLabel } from "../policy"
import { DialogError } from "./dialog-error"

const events = (n: number) => (n === 1 ? "event" : "events")

/**
 * Retention permanently deletes audit events, so this dialog counts what is
 * eligible before it offers to run anything.
 *
 * The count is asked for when the dialog opens and never otherwise, and the
 * form is mounted only while open. A reset in an effect would race a run still
 * in flight, and a remount is the reset that cannot be forgotten: each opening
 * starts with no result and a count of its own.
 */
export function EnforceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return open ? <EnforceForm onOpenChange={onOpenChange} /> : null
}

function EnforceForm({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const preview = useQuery<RetentionPreviewResponse>("retention.preview", {})
  const enforce = useCommand<EnforceResponse>("retention.enforce")

  const done = enforce.data !== undefined
  // The cache can still hold the last opening's answer while this one is in
  // flight, so a count is only current once nothing is loading.
  const counted = !preview.loading && preview.data !== undefined ? preview.data : undefined
  const ready = counted !== undefined && !counted.noPolicies && !done

  return (
    <ConfirmDialog
      open
      // Escape and an outside click would unmount the form and drop the result of a run still in flight.
      onOpenChange={(next) => {
        if (!next && enforce.loading) return
        onOpenChange(next)
      }}
      title="Permanently remove eligible events?"
      confirmLabel="Run retention"
      cancelLabel={done ? "Close" : "Cancel"}
      pending={enforce.loading}
      confirmDisabled={!ready}
      onConfirm={() => void enforce.execute()}
      description={
        <span className="flex flex-col gap-3">
          {/* After a run the server invalidates the count, and a refreshed "eligible" figure beside the result would read as a contradiction. */}
          {!done && preview.loading && <span role="status">Counting...</span>}
          {!done && counted && <PreviewSummary preview={counted} />}
          {!done && <DialogError what="count the eligible events" error={preview.error} />}
          {enforce.data && <RunOutcome r={enforce.data} />}
          <DialogError what="run retention" error={enforce.error} />
        </span>
      }
    />
  )
}

function GoverningSentence({ n }: { n: number }) {
  if (n <= 0) return null
  return (
    <span>
      {n === 1
        ? "1 app-level policy also removes events from your chain on the scheduler's run."
        : `${formatSeq(n)} app-level policies also remove events from your chain on the scheduler's run.`}
    </span>
  )
}

function PreviewSummary({ preview }: { preview: RetentionPreviewResponse }) {
  if (preview.noPolicies) {
    return (
      <>
        <span>You have no retention policies of your own, so running retention here removes nothing.</span>
        <GoverningSentence n={preview.governingAppPolicies} />
      </>
    )
  }
  return (
    <>
      <span>
        {`${preview.capped ? "At least " : ""}${formatSeq(preview.eventCount)} ${preview.eventCount === 1 ? "event is" : "events are"} eligible under your policies.`}
      </span>
      <span className="flex flex-col gap-1">
        {preview.byPolicy.map((p) => (
          <span key={p.policyId}>
            <span className="font-medium">{categoryLabel(p.category)}</span>
            {`: ${p.capped ? "at least " : ""}${formatSeq(p.eventCount)} ${events(p.eventCount)}`}
          </span>
        ))}
      </span>
      <span>
        {`One run removes at most ${formatSeq(LIMITS.enforcePerPolicy)} events per policy, so eligible is not the same as removed.`}
      </span>
      <span>
        Removed events are recorded in the chain as removed by retention, so verification still links across them; what they said is gone.
      </span>
      <GoverningSentence n={preview.governingAppPolicies} />
    </>
  )
}

function RunOutcome({ r }: { r: EnforceResponse }) {
  // A run that stopped part-way still answers as a success with a flag, and
  // what it removed is already gone. It is shown as the failure it is.
  if (r.failed) {
    return (
      <span role="alert" className="block font-medium text-destructive">
        {`Retention stopped part-way. ${formatSeq(r.purged)} ${events(r.purged)} ${r.purged === 1 ? "was" : "were"} removed before it stopped, and that cannot be undone. Open the preview again to see what remains.`}
      </span>
    )
  }
  return (
    <span role="status">
      {`${formatSeq(r.purged)} ${events(r.purged)} removed${r.archived > 0 ? `, ${formatSeq(r.archived)} archived` : ""}.`}
      {r.moreRemain ? " More remain: run it again." : ""}
    </span>
  )
}
