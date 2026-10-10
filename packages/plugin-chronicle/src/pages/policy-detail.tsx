import { IconButton } from "@forge-go/dashboard-kit/components/icon-button"
import { useState } from "react"
import type { ComponentType, FormEvent } from "react"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Checkbox } from "@forge-go/dashboard-kit/components/checkbox"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { DescriptionList } from "@forge-go/dashboard-kit/components/detail-layout"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import {
  CommandAlert,
  QueryBoundary,
} from "@forge-go/dashboard-kit/components/query-boundary"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import {
  PluginLink,
  useCommand,
  useNavigateTo,
  useQuery,
} from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import type { PolicySummary } from "../types"
import { DurationField } from "../components/duration-field"
import { durationLabel } from "../format"
import {
  categoryLabel,
  durationProblem,
  goDuration,
  policyScopeLabel,
  splitDuration,
} from "../policy"
import type { DurationUnit } from "../policy"

export const PolicyDetailPage: ComponentType<PluginPageProps> = ({
  params,
}) => {
  const id = params.id ?? ""
  const q = useQuery<PolicySummary>("retention.policyDetail", { id })
  // The delete invalidates this page's own read, and the host navigates in a
  // transition, so the refetch can answer NOT_FOUND while this page is still
  // on screen. That answer is the delete working, not a failure to show.
  const [deleted, setDeleted] = useState(false)
  const onDeleted = () => setDeleted(true)
  return (
    <section className="flex min-w-0 flex-col gap-4">
      <PageHeader
        title={id}
        description="A retention policy removes events in its category once they are older than its duration."
      />
      {deleted ? (
        <p role="status" className="text-sm">
          Policy deleted.
        </p>
      ) : q.data !== undefined ? (
        /* Once there is a policy the page stays up through the refresh a save triggers, so the form and its dialog keep their state. */
        <PolicyView key={q.data.id} policy={q.data} onDeleted={onDeleted} />
      ) : (
        <QueryBoundary title="policy" query={q} skeletonRows={5}>
          {(policy) => (
            <PolicyView key={policy.id} policy={policy} onDeleted={onDeleted} />
          )}
        </QueryBoundary>
      )}
    </section>
  )
}

function PolicyView({
  policy,
  onDeleted,
}: {
  policy: PolicySummary
  onDeleted: () => void
}) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <DescriptionList
        items={[
          {
            term: "Policy",
            value: <span className="font-mono text-xs">{policy.id}</span>,
          },
          { term: "Category", value: categoryLabel(policy.category) },
          { term: "Keeps for", value: durationLabel(policy.duration) },
          {
            term: "Archive",
            value: policy.archive ? "Archived first" : "Not archived",
          },
          { term: "Scope", value: policyScopeLabel(policy) },
          {
            term: "App",
            value: <span className="font-mono text-xs">{policy.appId}</span>,
          },
          {
            term: "Created",
            value: <Timestamp value={policy.createdAt} label="creation time" />,
          },
          {
            term: "Updated",
            value: <Timestamp value={policy.updatedAt} label="update time" />,
          },
        ]}
      />
      {!policy.tenantId && (
        <p className="max-w-prose text-sm">
          This policy has no tenant, so it removes events from every tenant in
          the app.
        </p>
      )}
      {policy.editable ? (
        <>
          <EditForm policy={policy} />
          <DeleteAction policy={policy} onDeleted={onDeleted} />
        </>
      ) : (
        <p className="max-w-prose text-sm">
          This policy is set at the app level and applies to your tenant. An
          app-wide operator manages it.
        </p>
      )}
      <PluginLink
        to="/retention"
        className="text-sm underline underline-offset-4"
      >
        Back to retention
      </PluginLink>
    </div>
  )
}

function EditForm({ policy }: { policy: PolicySummary }) {
  const save = useCommand<PolicySummary>("retention.savePolicy")
  // A duration that is not a whole number of hours ("1h30m0s") cannot be shown in this form.
  // The fields start empty then, and an untouched amount sends the server's own value back.
  const initial = splitDuration(policy.duration)
  const [amount, setAmount] = useState(initial?.amount ?? "")
  const [unit, setUnit] = useState<DurationUnit>(initial?.unit ?? "hours")
  const [archive, setArchive] = useState(policy.archive)

  const untouched = initial === null && amount === ""
  const ready =
    !save.loading &&
    (untouched || (amount !== "" && durationProblem(amount, unit) === null))

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!ready) return
    // The category is never sent: it is part of the policy's identity and the server refuses a change.
    await save.execute({
      id: policy.id,
      duration: untouched ? policy.duration : goDuration(amount, unit),
      archive,
    })
  }

  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="flex max-w-lg min-w-0 flex-col gap-4"
    >
      <p className="text-sm">
        The category cannot be changed. To use a different category, delete this
        policy and create a new one.
      </p>
      <DurationField
        amount={amount}
        unit={unit}
        placeholder={initial === null ? "hours or days" : undefined}
        onChange={(a, u) => {
          save.reset()
          setAmount(a)
          setUnit(u)
        }}
      />
      {initial === null && (
        <p className="text-xs text-muted-foreground">
          {`Currently ${policy.duration}, which this form cannot show as hours or days. Enter a new value to change it.`}
        </p>
      )}
      <div className="flex items-center gap-2">
        <Checkbox
          id="policy-archive"
          checked={archive}
          onCheckedChange={(checked) => {
            save.reset()
            setArchive(checked === true)
          }}
        />
        <Label htmlFor="policy-archive">
          Archive events before removing them
        </Label>
      </div>
      <p className="text-sm">
        Shortening the duration removes older events the next time retention
        runs, on the scheduler or from Run retention now. Removed events cannot
        be recovered.
      </p>
      <CommandAlert title="Could not save the policy" error={save.error} />
      {save.data && (
        <p role="status" className="text-sm">
          Saved.
        </p>
      )}
      <div>
        <Button type="submit" disabled={!ready}>
          {save.loading ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  )
}

function DeleteAction({
  policy,
  onDeleted,
}: {
  policy: PolicySummary
  onDeleted: () => void
}) {
  const [open, setOpen] = useState(false)
  const del = useCommand<{ id: string }>("retention.deletePolicy")
  const navigateTo = useNavigateTo()

  return (
    <div>
      <IconButton
        variant="outline"
        onClick={() => {
          // Reset on open, not on close: the state that matters is what the operator is looking at now.
          del.reset()
          setOpen(true)
        }}
        label="Delete policy"
      />
      <ConfirmDialog
        open={open}
        // Escape and an outside click would hide the result of a delete still in flight.
        onOpenChange={(next) => {
          if (!next && del.loading) return
          setOpen(next)
        }}
        title={`Delete ${policy.id}?`}
        confirmLabel="Delete policy"
        pending={del.loading}
        onConfirm={() => {
          void del.execute({ id: policy.id }).then((result) => {
            if (result === undefined) return
            onDeleted()
            navigateTo("/retention")
          })
        }}
        description={`Events in ${categoryLabel(policy.category)} stop being removed by this policy. Events already removed by it stay removed.`}
      >
        <CommandAlert title="Could not delete the policy" error={del.error} />
      </ConfirmDialog>
    </div>
  )
}
