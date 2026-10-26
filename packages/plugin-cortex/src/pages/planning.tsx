import { useState } from "react"
import {
  PluginLink,
  useCommand,
  usePoll,
  useQuery,
  type PluginPageProps,
} from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import {
  CommandAlert,
  QueryBoundary,
} from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { Section } from "@forge-go/dashboard-kit/components/section"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { ZeroState } from "@forge-go/dashboard-kit/components/zero-state"
import { Reload, State, useAccess } from "../components"
import { newLessonID } from "./learning"

interface Plan {
  id: string
  revision: number
  digest: string
  objective: string
  tasks: number
  deadline: string
}
interface Capabilities {
  claim: boolean
  retry: boolean
  reassign: boolean
  replan: boolean
  reconcile: boolean
  cancel: boolean
  resolve_conflict: boolean
}
interface Plans {
  available: boolean
  reason?: string
  items: Plan[]
  capabilities: Capabilities
}
interface Budget {
  max_steps: number
  max_tokens: number
  max_tool_calls: number
  deadline: string
}
interface Task {
  id: string
  owner: string
  instruction: string
  depends_on?: string[]
  status: string
  claim_id?: string
  claim_revision?: number
  claim_state?: string
  run_id?: string
  assignment_id?: string
  assignment_revision?: number
  assignment_state?: string
  acceptance_id?: string
  accepted_artifact?: { id: string; sha256: string }
  currently_accepted: boolean
  ready: boolean
  review_required: boolean
  budget: Budget
  next_action: string
}
interface Replan {
  id: string
  run_id: string
  base_revision: number
  base_digest: string
  status: string
  proposed_digest?: string
  proposed_tasks?: Task[]
  accepted_revision?: number
}
interface BoardCandidate {
  id: string
  task_id: string
  owner: { agent: string; principal: string }
  artifact: { id: string; sha256: string }
  at: string
}
interface BoardResource {
  resource: { resource: string; revision: string; access: string }
  head_revision: number
  head_digest: string
  head?: BoardCandidate
  conflicts: BoardCandidate[]
}
interface Detail {
  plan: Plan
  tasks: Task[]
  replans: Replan[]
  artifacts?: BoardResource[]
  complete: boolean
  observed_at: string
  capabilities: Capabilities
  budget: {
    charged: { tokens: number; steps: number; fan_out: number }
    reservations: number
    overflow: boolean
  }
}
interface Command {
  operation: string
  operation_id: string
  plan_id: string
  expected_revision: number
  expected_digest: string
  task_id?: string
  expected_claim_revision?: number
  expected_assignment_revision?: number
  worker?: string
  conflict_id?: string
  expected_resource_revision?: number
  expected_resource_digest?: string
  reason: string
}

function operationID(prefix: string) {
  return newLessonID().replace(/^lesson_/, `${prefix}_`)
}

export function PlanningPage() {
  const [cursors, setCursors] = useState([""])
  const after = cursors[cursors.length - 1]!
  const query = useQuery<Plans>("planning.list", { after, limit: 25 })
  usePoll(query.refetch)
  return (
    <div className="grid min-w-0 gap-4">
      <PageHeader
        title="Team plans"
        description="Current ownership, verified artifacts and bounded execution."
        actions={<Reload onClick={query.refetch} />}
      />
      <Section title="Plans">
        <QueryBoundary title="Team plans" query={query}>
          {(data) =>
            !data.available ? (
              <ZeroState
                title="Team planning unavailable"
                body={
                  data.reason ??
                  "Your host has not installed authorized team planning."
                }
              />
            ) : data.items.length === 0 ? (
              <ZeroState
                title="No team plans"
                body="Create a plan through your host's governed planning workflow. Current execution permissions still apply."
              />
            ) : (
              <>
                <ResourceTable
                  rows={data.items}
                  rowKey={(row) => row.id}
                  emptyMessage="No team plans"
                  columns={[
                    {
                      id: "objective",
                      header: "Objective",
                      cell: (row) => (
                        <PluginLink
                          className="block max-w-lg text-sm whitespace-normal underline"
                          to={`/planning/${row.id}`}
                        >
                          {row.objective}
                        </PluginLink>
                      ),
                    },
                    {
                      id: "revision",
                      header: "Revision",
                      cell: (row) => row.revision,
                    },
                    { id: "tasks", header: "Tasks", cell: (row) => row.tasks },
                    {
                      id: "deadline",
                      header: "Deadline",
                      cell: (row) => (
                        <Timestamp value={row.deadline} label="deadline" />
                      ),
                    },
                  ]}
                />
                <div className="flex flex-wrap justify-end gap-2 p-3">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={cursors.length === 1}
                    onClick={() => setCursors(cursors.slice(0, -1))}
                  >
                    Previous
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={data.items.length < 25}
                    onClick={() =>
                      setCursors([...cursors, data.items.at(-1)!.id])
                    }
                  >
                    Next
                  </Button>
                </div>
              </>
            )
          }
        </QueryBoundary>
      </Section>
    </div>
  )
}

function DependencyGraph({
  tasks,
  selected,
  onSelect,
}: {
  tasks: Task[]
  selected: Task
  onSelect: (id: string) => void
}) {
  const upstream = tasks.filter((task) =>
    selected.depends_on?.includes(task.id)
  )
  const downstream = tasks.filter((task) =>
    task.depends_on?.includes(selected.id)
  )
  return (
    <Section
      title="Dependency graph"
      description="Select a task to inspect its immediate prerequisites and dependents."
    >
      <div className="grid min-w-0 gap-3 p-3 sm:grid-cols-3">
        {[
          { label: "Prerequisites", items: upstream },
          { label: "Selected task", items: [selected] },
          { label: "Dependents", items: downstream },
        ].map((group) => (
          <div key={group.label} className="min-w-0">
            <h3 className="mb-2 text-xs font-medium">{group.label}</h3>
            {group.items.length === 0 ? (
              <p className="text-xs text-muted-foreground">None</p>
            ) : (
              <ul className="grid max-h-56 gap-2 overflow-auto">
                {group.items.map((task) => (
                  <li key={task.id}>
                    <Button
                      size="sm"
                      variant={
                        task.id === selected.id ? "secondary" : "outline"
                      }
                      className="h-auto w-full justify-start text-left break-words whitespace-normal"
                      aria-pressed={task.id === selected.id}
                      onClick={() => onSelect(task.id)}
                    >
                      <span className="line-clamp-2">
                        {task.instruction || task.id}
                      </span>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </Section>
  )
}

function PlanReview({
  detail,
  refresh,
}: {
  detail: Detail
  refresh: () => void
}) {
  const manage = useAccess("manage")
  const command = useCommand("planning.command")
  const [selectedID, setSelectedID] = useState("")
  const [reason, setReason] = useState("")
  const [worker, setWorker] = useState("")
  const [pending, setPending] = useState<Command | null>(null)
  const selected =
    detail.tasks.find((task) => task.id === selectedID) ?? detail.tasks[0]
  const choose = (operation: string, task?: Task, replan?: Replan) => {
    command.reset()
    const prefix = operation === "propose_revision" ? "rplan" : "tclaim"
    setPending({
      operation,
      operation_id:
        replan?.id ??
        (operation === "cancel" || operation === "reconcile"
          ? task!.assignment_id!
          : operationID(prefix)),
      plan_id: detail.plan.id,
      expected_revision: detail.plan.revision,
      expected_digest: detail.plan.digest,
      task_id: task?.id,
      expected_claim_revision: task?.claim_revision ?? 0,
      expected_assignment_revision: task?.assignment_revision ?? 0,
      worker: operation === "reassign" ? worker : undefined,
      reason,
    })
  }
  const columns: Column<Task>[] = [
    {
      id: "task",
      header: "Task",
      className: "min-w-48 max-w-md",
      cell: (task) => (
        <div className="grid gap-1 whitespace-normal">
          <button
            type="button"
            onClick={() => setSelectedID(task.id)}
            className="line-clamp-2 text-left text-sm underline"
          >
            {task.instruction || task.id}
          </button>
          <span className="text-xs text-muted-foreground">
            {task.owner}
            {task.review_required ? " · independent review required" : ""}
          </span>
        </div>
      ),
    },
    {
      id: "status",
      header: "Current state",
      cell: (task) => (
        <div className="grid gap-1">
          <State value={task.status} />
          <span className="text-xs text-muted-foreground">
            {task.currently_accepted
              ? "Verified and accepted"
              : task.acceptance_id
                ? "Historical acceptance; current checks failed"
                : task.next_action.replaceAll("_", " ")}
          </span>
        </div>
      ),
    },
    {
      id: "dependencies",
      header: "Dependencies",
      cell: (task) => <span>{task.depends_on?.length ?? 0}</span>,
    },
    {
      id: "budget",
      header: "Limits",
      cell: (task) => (
        <span className="text-xs">
          {task.budget.max_steps} steps · {task.budget.max_tokens} tokens
        </span>
      ),
    },
    {
      id: "run",
      header: "Run",
      cell: (task) =>
        task.run_id ? (
          <PluginLink className="text-sm underline" to={`/runs/${task.run_id}`}>
            Review run
          </PluginLink>
        ) : (
          <span className="text-xs text-muted-foreground">Not dispatched</span>
        ),
    },
  ]
  return (
    <div className="grid min-w-0 gap-4">
      <PageHeader
        title="Team plan"
        description={detail.plan.objective}
        actions={<Reload onClick={refresh} />}
        meta={
          <>
            <span>Revision {detail.plan.revision}</span>
            <State value={detail.complete ? "completed" : "active"} />
            <Timestamp value={detail.observed_at} label="checked" />
          </>
        }
      />
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <span>{detail.budget.charged.tokens} tokens charged</span>
        <span>{detail.budget.charged.steps} steps charged</span>
        <span>{detail.budget.reservations} reservations</span>
        <Timestamp value={detail.plan.deadline} label="deadline" />
        {detail.budget.overflow && (
          <span role="alert">Budget overflow: dispatch is blocked</span>
        )}
      </div>
      <Section title="Tasks">
        <ResourceTable
          rows={detail.tasks}
          rowKey={(task) => task.id}
          columns={columns}
          emptyMessage="No tasks in this plan"
        />
      </Section>
      {selected && (
        <>
          <DependencyGraph
            tasks={detail.tasks}
            selected={selected}
            onSelect={setSelectedID}
          />
          <Section title="Selected task">
            <div className="grid min-w-0 gap-3 p-3">
              <p className="text-sm break-words">{selected.instruction}</p>
              <div className="flex flex-wrap gap-2 text-xs">
                <span>Owner: {selected.owner}</span>
                <span>Claim revision: {selected.claim_revision ?? 0}</span>
                <span>Assignment: {selected.assignment_state ?? "none"}</span>
              </div>
              {selected.currently_accepted && selected.accepted_artifact && (
                <p className="text-xs break-all">
                  Current accepted artifact: {selected.accepted_artifact.id}
                </p>
              )}
              {manage && (
                <>
                  <label className="grid gap-1 text-sm">
                    Reason
                    <Input
                      value={reason}
                      maxLength={4096}
                      onChange={(event) => setReason(event.target.value)}
                      placeholder="Explain the intended operation"
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {detail.capabilities.claim && (
                      <>
                        <Button
                          size="sm"
                          disabled={!selected.ready || !reason.trim()}
                          onClick={() => choose("claim", selected)}
                        >
                          Claim and run
                        </Button>
                      </>
                    )}
                    {detail.capabilities.retry && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!reason.trim()}
                        onClick={() => choose("retry", selected)}
                      >
                        Retry with current checks
                      </Button>
                    )}
                    {detail.capabilities.reconcile &&
                      selected.assignment_id && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!reason.trim()}
                          onClick={() => choose("reconcile", selected)}
                        >
                          Reconcile result
                        </Button>
                      )}
                    {detail.capabilities.cancel &&
                      selected.assignment_id &&
                      !selected.currently_accepted && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!reason.trim()}
                          onClick={() => choose("cancel", selected)}
                        >
                          Cancel assignment
                        </Button>
                      )}
                    {detail.capabilities.replan && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!reason.trim()}
                        onClick={() => choose("propose_revision")}
                      >
                        Propose revision
                      </Button>
                    )}
                  </div>
                  {detail.capabilities.reassign && (
                    <div className="flex flex-wrap items-end gap-2">
                      <label className="grid min-w-0 flex-1 gap-1 text-sm">
                        Replacement worker
                        <Input
                          value={worker}
                          maxLength={512}
                          onChange={(event) => setWorker(event.target.value)}
                          placeholder="Registered worker identity"
                        />
                      </label>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!worker.trim() || !reason.trim()}
                        onClick={() => choose("reassign", selected)}
                      >
                        Reassign with current checks
                      </Button>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Operations recheck current authority, prerequisites and
                    budgets. Cancellation retains ownership and unknown charges
                    until recovery proves they can close.
                  </p>
                </>
              )}
            </div>
          </Section>
        </>
      )}
      <Section title="Plan revisions">
        {detail.replans.length === 0 ? (
          <ZeroState
            title="No revision attempts"
            body="A revision proposal uses the shared budget and needs a separate acceptance step."
          />
        ) : (
          <div className="grid gap-3 p-3">
            {detail.replans.map((replan) => (
              <article
                key={replan.id}
                className="grid min-w-0 gap-2 rounded-md border p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <State value={replan.status} />
                  <span className="text-sm">
                    From revision {replan.base_revision}
                  </span>
                  <PluginLink
                    to={`/runs/${replan.run_id}`}
                    className="text-sm underline"
                  >
                    Review planner run
                  </PluginLink>
                </div>
                <p className="text-xs break-all">{replan.id}</p>
                {replan.proposed_tasks && (
                  <details>
                    <summary className="cursor-pointer text-sm">
                      Inspect proposed graph ({replan.proposed_tasks.length}{" "}
                      tasks)
                    </summary>
                    <ul className="mt-2 grid gap-2">
                      {replan.proposed_tasks.map((task) => (
                        <li key={task.id} className="text-sm break-words">
                          {task.instruction} · {task.owner} ·{" "}
                          {task.depends_on?.length ?? 0} prerequisites ·{" "}
                          {task.budget.max_tokens} token limit
                          {task.review_required
                            ? " · independent review required"
                            : ""}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                {manage &&
                  detail.capabilities.replan &&
                  replan.base_digest === detail.plan.digest && (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!reason.trim()}
                        onClick={() =>
                          choose("observe_revision", undefined, replan)
                        }
                      >
                        Reconcile proposal
                      </Button>
                      {replan.status === "proposed" && (
                        <Button
                          size="sm"
                          disabled={!reason.trim()}
                          onClick={() =>
                            choose("accept_revision", undefined, replan)
                          }
                        >
                          Accept reviewed revision
                        </Button>
                      )}
                    </div>
                  )}
              </article>
            ))}
          </div>
        )}
      </Section>
      {(detail.artifacts?.length ?? 0) > 0 && (
        <Section title="Artifact ownership">
          <div className="grid gap-3 p-3">
            {detail.artifacts!.map((board) => (
              <article
                key={board.resource.resource}
                className="grid min-w-0 gap-2 rounded-md border p-3"
              >
                <div className="flex flex-wrap gap-2 text-sm">
                  <span className="break-all">{board.resource.resource}</span>
                  <span>Head revision {board.head_revision}</span>
                  <span>{board.conflicts.length} unresolved conflicts</span>
                </div>
                {board.head && (
                  <p className="text-xs break-all">
                    Current owner: {board.head.owner.agent} · artifact{" "}
                    {board.head.artifact.id}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  These references record ownership history. Read the task's
                  current acceptance before relying on its content.
                </p>
                {board.conflicts.map((conflict) => (
                  <div
                    key={conflict.id}
                    className="flex flex-wrap items-center justify-between gap-2 border-t pt-2"
                  >
                    <span className="min-w-0 flex-1 text-xs break-all">
                      {conflict.owner.agent} · {conflict.artifact.id}
                    </span>
                    {manage && detail.capabilities.resolve_conflict && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!reason.trim()}
                        onClick={() => {
                          command.reset()
                          setPending({
                            operation: "resolve_conflict",
                            operation_id: operationID("btrans"),
                            plan_id: detail.plan.id,
                            expected_revision: detail.plan.revision,
                            expected_digest: detail.plan.digest,
                            conflict_id: conflict.id,
                            expected_resource_revision: board.head_revision,
                            expected_resource_digest: board.head_digest,
                            reason,
                          })
                        }}
                      >
                        Resolve selected conflict
                      </Button>
                    )}
                  </div>
                ))}
              </article>
            ))}
          </div>
        </Section>
      )}
      <CommandAlert title="Team operation failed" error={command.error} />
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null)
        }}
        title={
          pending
            ? `Confirm ${pending.operation.replaceAll("_", " ")}`
            : "Team operation"
        }
        description={`This targets plan revision ${pending?.expected_revision ?? detail.plan.revision}. The server rechecks the exact revision and current permissions. Keep this operation ID after a lost reply: ${pending?.operation_id ?? ""}.`}
        confirmLabel="Confirm operation"
        pending={command.loading}
        onConfirm={async () => {
          if (pending && (await command.execute(pending)) !== undefined) {
            setPending(null)
            refresh()
          }
        }}
      />
    </div>
  )
}

export function PlanningDetailPage({ params }: PluginPageProps) {
  const query = useQuery<Detail>("planning.detail", { id: params.id })
  usePoll(query.refetch)
  return (
    <div className="grid min-w-0 gap-3">
      <PluginLink to="/planning" className="text-sm underline">
        All team plans
      </PluginLink>
      <QueryBoundary title="Team plan" query={query}>
        {(detail) => <PlanReview detail={detail} refresh={query.refetch} />}
      </QueryBoundary>
    </div>
  )
}
