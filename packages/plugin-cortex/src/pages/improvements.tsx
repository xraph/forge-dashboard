import { useState } from "react"
import { PluginLink, useCommand, useQuery } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import {
  CommandAlert,
  QueryBoundary,
} from "@forge-go/dashboard-kit/components/query-boundary"
import { Section } from "@forge-go/dashboard-kit/components/section"
import { ZeroState } from "@forge-go/dashboard-kit/components/zero-state"

type Page<T> = { items: T[]; complete: boolean; next_cursor?: string }
type Ref = { id: string; digest: string }
interface Experiment {
  id: string
  revision: number
  state: string
  phase: string
  spec: { agent_id: string; mode: string; budget: { token_only?: boolean } }
}
interface Decision {
  id: string
  outcome: string
  evidence_class: string
  selection_kind: string
  candidate: Ref
  reasons: string[]
  comparison: {
    complete: boolean
    missing_reasons: string[]
    required_failures: string[]
    mean_delta: number
    lower_bound: number
    upper_bound: number
    cost_ratio?: number
    latency_ratio?: number
  }
}
interface Comparison {
  revision: number
  decision?: Decision
  evaluations: Page<unknown>
  retained_baseline?: unknown
}
interface Capabilities {
  permissions: Record<string, boolean>
  checks: Record<string, string>
  pricing_quality: string
  trials_ready: boolean
}
interface Activation {
  id: string
  generation: number
  version: Ref
  deactivated?: boolean
  reason?: string
}
type Pending = {
  intent: string
  label: string
  payload: Record<string, unknown>
  key: string
}
const safeRevision = (value: number) =>
  Number.isSafeInteger(value) && value >= 0

function ReviewCommand({
  pending,
  close,
}: {
  pending: Pending
  close: () => void
}) {
  const command = useCommand(pending.intent)
  return (
    <>
      <CommandAlert title="Review command" error={command.error} />
      <ConfirmDialog
        open
        onOpenChange={(open) => {
          if (!open && !command.loading) close()
        }}
        title={`${pending.label}?`}
        description="The host rechecks your permission, evidence and the reviewed revision. A changed route or stale experiment refuses this command. Existing runs keep their pinned version."
        confirmLabel={pending.label}
        pending={command.loading}
        onConfirm={async () => {
          if (
            (await command.execute(pending.payload, {
              idempotencyKey: pending.key,
            })) !== undefined
          )
            close()
        }}
      />
    </>
  )
}

function RouteReview({
  experiment,
  decision,
  permissions,
  propose,
}: {
  experiment: Experiment
  decision: Decision
  permissions: Capabilities["permissions"]
  propose: (p: Omit<Pending, "key">) => void
}) {
  const kind = decision.selection_kind
  const history = useQuery<Page<Activation>>("optimization.activations.list", {
    agent_id: experiment.spec.agent_id,
    kind,
    channel: "default",
    limit: 100,
  })
  const [reason, setReason] = useState("")
  return (
    <QueryBoundary title="Activation history" query={history}>
      {(page) => {
        // A partial history cannot establish the current route generation.
        const valid =
          page.complete &&
          page.items.every((row) => safeRevision(row.generation))
        const current = valid
          ? Math.max(0, ...page.items.map((row) => row.generation))
          : undefined
        const allowed =
          current !== undefined &&
          reason.trim().length > 0 &&
          reason.length <= 2048
        const base = {
          agent_id: experiment.spec.agent_id,
          channel: "default",
          kind,
          expected_generation: current,
          reason,
        }
        return (
          <div className="grid min-w-0 gap-3">
            <p className="text-xs text-muted-foreground">
              Default {kind} route ·{" "}
              {current === undefined
                ? "current generation unavailable"
                : `generation ${current}`}
              . Review applies to future runs.
            </p>
            <label className="grid gap-1 text-sm">
              Review reason
              <Input
                value={reason}
                maxLength={2048}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              {permissions["optimization.activate"] && (
                <Button
                  size="sm"
                  disabled={
                    !allowed ||
                    !decision.comparison.complete ||
                    decision.evidence_class !== "validated" ||
                    !["select", "recommend"].includes(decision.outcome)
                  }
                  onClick={() =>
                    propose({
                      intent: "optimization.activations.activate",
                      label: "Activate reviewed version",
                      payload: {
                        ...base,
                        version_id: decision.candidate.id,
                        version_digest: decision.candidate.digest,
                        decision_id: decision.id,
                      },
                    })
                  }
                >
                  Activate reviewed version
                </Button>
              )}
              {permissions["optimization.retain"] && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={
                    !reason.trim() || !safeRevision(experiment.revision)
                  }
                  onClick={() =>
                    propose({
                      intent: "optimization.decisions.retain",
                      label: "Retain baseline",
                      payload: {
                        id: experiment.id,
                        expected_revision: experiment.revision,
                        decision_id: decision.id,
                        reason,
                      },
                    })
                  }
                >
                  Retain baseline
                </Button>
              )}
            </div>
            {page.items.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No activation has been recorded on this route.
              </p>
            ) : (
              <div className="grid gap-2">
                {page.items.map((item) => (
                  <div
                    key={item.id}
                    className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-md border p-2"
                  >
                    <p className="min-w-0 text-xs break-all">
                      Generation {item.generation} ·{" "}
                      {item.deactivated ? "deactivated" : item.version.id}
                    </p>
                    {permissions["optimization.rollback"] &&
                      !item.deactivated &&
                      item.generation !== current && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!allowed}
                          onClick={() =>
                            propose({
                              intent: "optimization.activations.rollback",
                              label: `Restore generation ${item.generation}`,
                              payload: { ...base, target_id: item.id },
                            })
                          }
                        >
                          Restore generation {item.generation}
                        </Button>
                      )}
                  </div>
                ))}
              </div>
            )}
            {!page.complete && (
              <p role="status" className="text-xs">
                This route has more history than the review window. Route
                changes are disabled until the host can establish its current
                generation.
              </p>
            )}
          </div>
        )
      }}
    </QueryBoundary>
  )
}

function ExperimentReview({ experiment }: { experiment: Experiment }) {
  const evidence = useQuery<Comparison>("optimization.comparison", {
    id: experiment.id,
    limit: 25,
  })
  const capabilities = useQuery<Capabilities>("optimization.capabilities", {
    experiment_id: experiment.id,
  })
  const [pending, setPending] = useState<Pending>()
  const propose = (value: Omit<Pending, "key">) =>
    setPending({ ...value, key: crypto.randomUUID() })
  return (
    <Section title="Improvement review">
      <div className="grid min-w-0 gap-3 p-3">
        <p className="text-xs break-all">
          {experiment.id} · revision {experiment.revision} · {experiment.state}{" "}
          / {experiment.phase}
        </p>
        <QueryBoundary title="Current improvement grants" query={capabilities}>
          {(caps) => (
            <>
              <p className="text-xs text-muted-foreground">
                Trial readiness:{" "}
                {caps.trials_ready ? "available" : "not established"} · pricing:{" "}
                {caps.pricing_quality || "unknown"}
              </p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(caps.checks)
                  .filter(([, value]) => value !== "ready")
                  .map(([key, value]) => (
                    <span className="text-xs" key={key}>
                      {key.replaceAll("_", " ")}: {value}
                    </span>
                  ))}
              </div>
              <div className="flex flex-wrap gap-2">
                {caps.permissions["optimization.start"] &&
                  experiment.state === "draft" && (
                    <Button
                      size="sm"
                      disabled={
                        !caps.trials_ready || !safeRevision(experiment.revision)
                      }
                      onClick={() =>
                        propose({
                          intent: "optimization.experiments.start",
                          label: "Start evaluation",
                          payload: {
                            id: experiment.id,
                            expected_revision: experiment.revision,
                          },
                        })
                      }
                    >
                      Start evaluation
                    </Button>
                  )}
                {caps.permissions["optimization.resume"] &&
                  experiment.state === "paused" && (
                    <Button
                      size="sm"
                      disabled={!safeRevision(experiment.revision)}
                      onClick={() =>
                        propose({
                          intent: "optimization.experiments.resume",
                          label: "Resume evaluation",
                          payload: {
                            id: experiment.id,
                            expected_revision: experiment.revision,
                          },
                        })
                      }
                    >
                      Resume evaluation
                    </Button>
                  )}
              </div>
              <QueryBoundary title="Comparison evidence" query={evidence}>
                {(value) =>
                  !value.decision ? (
                    <ZeroState
                      title="No measured decision"
                      body="Evaluation has not produced a retained comparison. No version can be activated from this review."
                    />
                  ) : (
                    <>
                      <p className="text-sm">
                        Recommendation: {value.decision.outcome} · evidence:{" "}
                        {value.decision.evidence_class} ·{" "}
                        {value.decision.comparison.complete
                          ? "comparison complete"
                          : "comparison incomplete"}
                      </p>
                      <p className="text-xs">
                        Measured delta {value.decision.comparison.mean_delta} (
                        {value.decision.comparison.lower_bound} to{" "}
                        {value.decision.comparison.upper_bound}). Cost ratio:{" "}
                        {value.decision.comparison.cost_ratio ?? "unknown"}.
                        Latency ratio:{" "}
                        {value.decision.comparison.latency_ratio ?? "unknown"}.
                      </p>
                      {[
                        ...value.decision.reasons,
                        ...value.decision.comparison.missing_reasons,
                        ...value.decision.comparison.required_failures,
                      ].map((reason, i) => (
                        <p className="text-xs break-words" key={i}>
                          {reason}
                        </p>
                      ))}
                      <p className="text-xs text-muted-foreground">
                        {value.evaluations.items.length} evaluation records in
                        this page
                        {value.evaluations.complete
                          ? ""
                          : "; more records retained"}
                        . A complete comparison is separate from this page
                        length.
                      </p>
                      {value.revision !== experiment.revision ? (
                        <p role="status">
                          The experiment changed during review. Refresh before
                          acting.
                        </p>
                      ) : (
                        ["execution", "improvement"].includes(
                          value.decision.selection_kind
                        ) && (
                          <RouteReview
                            experiment={experiment}
                            decision={value.decision}
                            permissions={caps.permissions}
                            propose={propose}
                          />
                        )
                      )}
                    </>
                  )
                }
              </QueryBoundary>
            </>
          )}
        </QueryBoundary>
        {pending && (
          <ReviewCommand
            key={pending.key}
            pending={pending}
            close={() => setPending(undefined)}
          />
        )}
      </div>
    </Section>
  )
}

type Choice = {
  kind: string
  name: string
  description?: string
  ref: { ref: string; revision: string; digest: string }
}
function CreateExperiment() {
  const catalog = useQuery<Page<Choice>>("optimization.catalog", { limit: 100 })
  const grants = useQuery<Capabilities>("optimization.capabilities")
  const command = useCommand<Experiment>("optimization.experiments.create")
  const [selection, setSelection] = useState<Record<string, Choice["ref"]>>({})
  const [key, setKey] = useState(() => crypto.randomUUID())
  const kinds = ["agent", "evaluation", "controller", "environment"]
  return (
    <Section title="Create from approved sources">
      <div className="grid gap-3 p-3">
        <QueryBoundary title="Creation grants" query={grants}>
          {(caps) =>
            !caps.permissions["optimization.create"] ? (
              <p className="text-sm">
                You do not have permission to create experiments.
              </p>
            ) : (
              <QueryBoundary title="Approved sources" query={catalog}>
                {(page) =>
                  page.items.length === 0 ? (
                    <ZeroState
                      title="No approved sources"
                      body="Your host must register executable agent, evaluation, controller and environment revisions before you can create an experiment."
                    />
                  ) : (
                    <form
                      className="grid gap-3"
                      onSubmit={async (event) => {
                        event.preventDefault()
                        if (
                          (await command.execute(
                            { selection },
                            { idempotencyKey: key }
                          )) !== undefined
                        ) {
                          setKey(crypto.randomUUID())
                          setSelection({})
                        }
                      }}
                    >
                      <p className="text-xs text-muted-foreground">
                        Creation freezes the selected source revisions.
                        Evaluation starts separately and does not activate a
                        version.
                      </p>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {kinds.map((kind) => (
                          <label
                            key={kind}
                            className="grid min-w-0 gap-1 text-sm"
                          >
                            {kind[0].toUpperCase() + kind.slice(1)}
                            <select
                              required
                              className="h-9 min-w-0 rounded-md border bg-background px-2"
                              value={
                                selection[kind]
                                  ? JSON.stringify(selection[kind])
                                  : ""
                              }
                              onChange={(event) => {
                                const choice = page.items.find(
                                  (item) =>
                                    item.kind === kind &&
                                    JSON.stringify(item.ref) ===
                                      event.target.value
                                )
                                setSelection((old) => {
                                  const next = { ...old }
                                  if (choice) next[kind] = choice.ref
                                  else delete next[kind]
                                  return next
                                })
                                setKey(crypto.randomUUID())
                                command.reset()
                              }}
                            >
                              <option value="">
                                Select an approved revision
                              </option>
                              {page.items
                                .filter((item) => item.kind === kind)
                                .map((item) => (
                                  <option
                                    key={JSON.stringify(item.ref)}
                                    value={JSON.stringify(item.ref)}
                                  >
                                    {item.name} · {item.ref.revision}
                                  </option>
                                ))}
                            </select>
                          </label>
                        ))}
                      </div>
                      {!page.complete && (
                        <p className="text-xs">
                          Only this catalog page is shown. The host still
                          rechecks every selected revision.
                        </p>
                      )}
                      <div>
                        <Button
                          type="submit"
                          size="sm"
                          disabled={
                            command.loading ||
                            kinds.some((kind) => !selection[kind])
                          }
                        >
                          Create experiment
                        </Button>
                      </div>
                    </form>
                  )
                }
              </QueryBoundary>
            )
          }
        </QueryBoundary>
        <CommandAlert title="Create experiment" error={command.error} />
        {command.data && (
          <p role="status" className="text-sm break-all">
            Created {command.data.id}. Open it below to review readiness and
            start evaluation.
          </p>
        )}
      </div>
    </Section>
  )
}

export function ImprovementsPage() {
  const [cursors, setCursors] = useState([""])
  const [selected, setSelected] = useState("")
  const [creating, setCreating] = useState(false)
  const query = useQuery<Page<Experiment>>("optimization.experiments.list", {
    limit: 25,
    cursor: cursors[cursors.length - 1],
  })
  const detail = useQuery<Experiment>(
    "optimization.experiments.detail",
    { id: selected },
    { enabled: !!selected }
  )
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <PageHeader
        title="Improvement review"
        description="Review measured changes and control which version future runs use."
        actions={
          <Button
            size="sm"
            variant="outline"
            onClick={() => setCreating((old) => !old)}
          >
            {creating ? "Close creation" : "Create experiment"}
          </Button>
        }
      />
      {creating && <CreateExperiment />}
      <PluginLink to="/learning" className="text-sm underline">
        Governed lessons
      </PluginLink>
      <QueryBoundary title="Improvement experiments" query={query}>
        {(page) => (
          <>
            {!page.items.length ? (
              <ZeroState
                title="No improvement experiments"
                body="Host-approved experiments appear here after creation. Evaluation and a separate authorized activation are required before a production version changes."
              />
            ) : (
              <div className="grid min-w-0 gap-2">
                {page.items.map((item) => (
                  <button
                    key={item.id}
                    className="flex min-w-0 flex-wrap justify-between gap-2 rounded-md border p-3 text-left text-sm focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => setSelected(item.id)}
                  >
                    <span className="min-w-0 break-all">{item.id}</span>
                    <span>
                      {item.state} · {item.phase}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {(page.items.length > 0 || cursors.length > 1) && (
              <div className="flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={cursors.length === 1 || query.loading}
                  onClick={() => setCursors((old) => old.slice(0, -1))}
                >
                  Previous
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!page.next_cursor || query.loading}
                  onClick={() =>
                    setCursors((old) => [...old, page.next_cursor!])
                  }
                >
                  Next
                </Button>
              </div>
            )}
          </>
        )}
      </QueryBoundary>
      {selected && (
        <QueryBoundary title="Selected experiment" query={detail}>
          {(experiment) => (
            <ExperimentReview
              key={`${experiment.id}:${experiment.revision}`}
              experiment={experiment}
            />
          )}
        </QueryBoundary>
      )}
    </section>
  )
}
