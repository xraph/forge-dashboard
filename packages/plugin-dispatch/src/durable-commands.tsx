import { useEffect, useRef, useState } from "react"
import {
  ContractError,
  PluginLink,
  queryStore,
  usePluginClient,
  useQuery,
} from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Textarea } from "@forge-go/dashboard-kit/components/textarea"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { CommandAlert } from "@forge-go/dashboard-kit/components/query-boundary"
import { ZeroState } from "@forge-go/dashboard-kit/components/zero-state"
import { Section } from "./components"
import { DurableSession } from "./durable-session"
import { DurableQueryPanel } from "./durable-query"
import { DurableInput, encodedInput } from "./durable-input"
import type { DurableInputValue } from "./durable-input"
import { textBytes, validIdentifier } from "./durable-bytes"
import { runPath } from "./durable-types"
import type {
  DurableAcceptance,
  DurableCapabilities,
  DurableCancel,
  DurableSignal,
  DurableSignalStart,
  DurableStart,
  RunKey,
} from "./durable-types"

type Operation = "start" | "signalStart" | "signal" | "cancel"
const labels: Record<Operation, string> = {
  start: "Start workflow",
  signalStart: "Signal with start",
  signal: "Send signal",
  cancel: "Request cancellation",
}
const actions: Record<Operation, string> = {
  start: "dispatch.workflow.start",
  signalStart: "dispatch.workflow.signal_start",
  signal: "dispatch.workflow.signal",
  cancel: "dispatch.workflow.cancel",
}
type Payload = DurableStart | DurableSignalStart | DurableSignal | DurableCancel
type Submission = Readonly<{
  operation: Operation
  payload: Payload
  key: string
  target: RunKey
  build: string
}>
const empty = {
  workflow_id: "",
  run_id: "",
  workflow_type: "",
  build_id: "",
  queue: "",
  name: "",
  reason: "",
}

export function DurableStartControls({ namespace }: { namespace: string }) {
  return (
    <DurableSession>
      <Commands key={namespace} namespace={namespace} />
    </DurableSession>
  )
}
export function DurableRunControls({
  target,
  build,
}: {
  target: RunKey
  build?: string
}) {
  return (
    <DurableSession>
      <RunControls key={runPath(target)} target={target} build={build ?? ""} />
    </DurableSession>
  )
}
function RunControls({ target, build }: { target: RunKey; build: string }) {
  const [accepted, setAccepted] = useState(0)
  const capabilities = useCapabilities({ ...target, build_id: build }, !!build)
  return (
    <>
      <Commands
        namespace={target.namespace}
        target={target}
        build={build}
        onAccepted={() => setAccepted((value) => value + 1)}
      />
      <DurableQueryPanel
        key={accepted}
        target={target}
        build={build}
        allowed={!!capabilities.data?.actions["dispatch.workflow.query"]}
      />
    </>
  )
}
function useCapabilities(params: Record<string, unknown>, enabled: boolean) {
  const query = useQuery<DurableCapabilities>("durable.capabilities", params, {
    enabled,
    cancelOnUnused: true,
    resetOnContextChange: true,
  })
  const data = query.data
  const valid =
    data &&
    (data.runtime === "available" || data.runtime === "unavailable") &&
    data.actions &&
    typeof data.actions === "object" &&
    !Array.isArray(data.actions) &&
    Object.values(data.actions).every((value) => typeof value === "boolean")
  return {
    ...query,
    data: valid ? data : undefined,
    error:
      data && !valid
        ? new ContractError(
            "BAD_RESPONSE",
            "The server returned invalid action availability."
          )
        : query.error,
  }
}
function Commands({
  namespace,
  target,
  build,
  onAccepted,
}: {
  namespace: string
  target?: RunKey
  build?: string
  onAccepted?: () => void
}) {
  const client = usePluginClient()
  const [draft, setDraft] = useState(empty)
  const [startInput, setStartInput] = useState<DurableInputValue>({ text: "" })
  const [signalInput, setSignalInput] = useState<DurableInputValue>({
    text: "",
  })
  const [operation, setOperation] = useState<Operation>(
    target ? "signal" : "start"
  )
  const [open, setOpen] = useState(false)
  const [inputEpoch, setInputEpoch] = useState(0)
  const [submission, setSubmission] = useState<Submission>()
  const [state, setState] = useState<{
    pending?: boolean
    uncertain?: boolean
    result?: DurableAcceptance
    error?: ContractError
  }>({})
  const active = useRef(true)
  const pending = useRef(false)
  const generation = useRef(0)
  useEffect(() => {
    const owner = generation
    active.current = true
    return () => {
      active.current = false
      owner.current++
    }
  }, [])
  const key = target ?? {
    namespace,
    workflow_id: draft.workflow_id,
    run_id: draft.run_id,
  }
  const selectedBuild = build ?? draft.build_id
  const validScope = [
    namespace,
    key.workflow_id,
    selectedBuild,
    ...(target ? [key.run_id] : [draft.workflow_type]),
  ].every((value) => validIdentifier(value))
  // Atomic start permission covers the workflow identity, never the proposed run.
  const capabilityParams = target
    ? { ...target, build_id: selectedBuild }
    : {
        namespace,
        workflow_id: key.workflow_id,
        build_id: selectedBuild,
        workflow_type: draft.workflow_type,
      }
  const capabilities = useCapabilities(capabilityParams, validScope)
  const allowed = !!capabilities.data?.actions[actions[operation]]
  function field(name: keyof typeof empty, label: string, multiline = false) {
    const props = {
      value: draft[name],
      disabled: state.pending,
      onChange: (
        event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
      ) => setDraft((value) => ({ ...value, [name]: event.target.value })),
    }
    return (
      <label
        className={`flex min-w-0 flex-col gap-1 text-xs ${multiline ? "col-span-full" : ""}`}
      >
        {label}
        {multiline ? (
          <Textarea {...props} rows={3} />
        ) : (
          <Input {...props} className="h-8" />
        )}
      </label>
    )
  }
  function prepare(): Submission {
    if (
      !validScope ||
      !validIdentifier(key.run_id) ||
      (!target && !validIdentifier(draft.queue))
    )
      throw new Error("Enter exact identifiers without surrounding whitespace.")
    if (
      (operation === "signal" || operation === "signalStart") &&
      !validIdentifier(draft.name, 200)
    )
      throw new Error("Enter a signal name within 200 UTF-8 bytes.")
    if (operation === "cancel") {
      textBytes(draft.reason, 4096)
      if (draft.reason.includes("\0"))
        throw new Error("Cancellation reason cannot contain a null character.")
    }
    const request_id = crypto.randomUUID()
    const start: DurableStart = {
      ...key,
      request_id,
      workflow_type: draft.workflow_type,
      build_id: selectedBuild,
      queue: draft.queue,
      input: encodedInput(startInput),
    }
    const payload: Payload =
      operation === "start"
        ? start
        : operation === "signalStart"
          ? {
              start: Object.freeze(start),
              name: draft.name,
              input: encodedInput(signalInput),
            }
          : operation === "signal"
            ? {
                ...key,
                build_id: selectedBuild,
                request_id,
                name: draft.name,
                input: encodedInput(signalInput),
              }
            : {
                ...key,
                build_id: selectedBuild,
                request_id,
                reason: draft.reason,
              }
    return Object.freeze({
      operation,
      payload: Object.freeze(payload),
      key: crypto.randomUUID(),
      target: Object.freeze({ ...key }),
      build: selectedBuild,
    })
  }
  async function send() {
    if (pending.current || state.result) return
    let snapshot = submission
    if (!snapshot) {
      if (!allowed) return
      try {
        snapshot = prepare()
      } catch (cause) {
        setState({
          error: new ContractError(
            "BAD_REQUEST",
            cause instanceof Error ? cause.message : "Invalid command input."
          ),
        })
        return
      }
      setSubmission(snapshot)
    }
    pending.current = true
    const version = ++generation.current
    const epoch = queryStore.contextSnapshot()
    const uncertain = !!state.uncertain
    const owns = () =>
      active.current &&
      generation.current === version &&
      queryStore.contextSnapshot() === epoch
    setState({ pending: true, uncertain })
    try {
      const result = await client.command<DurableAcceptance>(
        `durable.${snapshot.operation}`,
        snapshot.payload,
        { idempotencyKey: snapshot.key }
      )
      if (owns()) {
        setState({ result })
        onAccepted?.()
      }
    } catch (cause) {
      if (owns()) {
        const code = cause instanceof ContractError ? cause.code : "TRANSPORT"
        // Only recognized rejection codes establish nonacceptance. A malformed
        // or future response code cannot resolve whether this send committed.
        const unknown =
          uncertain ||
          ![
            "BAD_REQUEST",
            "NOT_FOUND",
            "CONFLICT",
            "PERMISSION_DENIED",
            "UNAUTHENTICATED",
          ].includes(code)
        const message =
          code === "PERMISSION_DENIED"
            ? "Permission denied for this attempt."
            : code === "CONFLICT"
              ? "The request conflicts with saved content, build or run state."
              : code === "UNAUTHENTICATED"
                ? "Authentication is required for this attempt."
                : "This attempt failed. Retry the original request or check access and runtime availability."
        setState({
          uncertain: unknown,
          error: new ContractError(code, message),
        })
      }
    } finally {
      if (owns()) pending.current = false
    }
  }
  function forget() {
    generation.current++
    setSubmission(undefined)
    setState({})
    setDraft(empty)
    setStartInput({ text: "" })
    setSignalInput({ text: "" })
    setOpen(false)
  }
  const choices: Operation[] = target
    ? ["signal", "cancel"]
    : ["start", "signalStart"]
  const summary = state.result
    ? state.result.status === "cancellation_requested"
      ? "Cancellation requested"
      : "Request accepted"
    : state.uncertain
      ? "Acceptance uncertain"
      : submission
        ? "Request needs attention"
        : undefined
  return (
    <Section title={target ? "Run commands" : "Start or signal a workflow"}>
      <div className="flex flex-wrap items-center gap-2">
        {submission ? (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            Review {labels[submission.operation].toLowerCase()}
          </Button>
        ) : (
          choices.map((choice) => (
            <Button
              key={choice}
              size="sm"
              variant="outline"
              disabled={
                target ? !capabilities.data?.actions[actions[choice]] : false
              }
              onClick={() => {
                setOperation(choice)
                setOpen(true)
              }}
            >
              {labels[choice]}
            </Button>
          ))
        )}
        {summary && (
          <span role="status" className="text-xs">
            {summary}
          </span>
        )}
        {state.result && (
          <PluginLink
            className="text-xs text-primary hover:underline"
            to={runPath(state.result)}
          >
            Open accepted run
          </PluginLink>
        )}
        {target && !submission && (
          <CapabilityStatus enabled={validScope} capabilities={capabilities} />
        )}
      </div>
      <ConfirmDialog
        open={open}
        onOpenChange={(value) => {
          if (!pending.current) {
            if (!value) {
              setInputEpoch((current) => current + 1)
              setStartInput((current) =>
                current.loading ? { text: "" } : current
              )
              setSignalInput((current) =>
                current.loading ? { text: "" } : current
              )
            }
            setOpen(value)
          }
        }}
        title={labels[submission?.operation ?? operation]}
        description={
          target
            ? "The command targets this exact run and build. The server checks your permission again."
            : operation === "signalStart"
              ? "Signal with start signals the open run, or creates the proposed run atomically. Both branches require permission."
              : "Start the proposed run on this exact build. The server checks your permission again."
        }
        destructive={operation === "cancel"}
        pending={state.pending}
        confirmLabel={submission ? "Retry original request" : labels[operation]}
        confirmDisabled={
          !!state.result ||
          (!submission &&
            (!allowed ||
              (!target && (startInput.loading || !!startInput.error)) ||
              ((operation === "signal" || operation === "signalStart") &&
                (signalInput.loading || !!signalInput.error))))
        }
        cancelLabel="Close"
        onConfirm={send}
        className="max-h-[90dvh] overflow-y-auto"
      >
        {submission ? (
          <>
            <p className="text-xs break-all">
              Saved target{" "}
              <span className="font-mono">
                {submission.target.namespace} / {submission.target.workflow_id}{" "}
                / {submission.target.run_id}
              </span>
              , build <span className="font-mono">{submission.build}</span>.
            </p>
            {state.uncertain && (
              <ZeroState
                title="Acceptance uncertain"
                body="The earlier request may have committed. A later failed or denied attempt does not resolve it. Retry sends the original identity and bytes."
              />
            )}
            {state.result && (
              <p role="status" className="text-xs">
                {summary}. Revision{" "}
                <span className="font-mono">{state.result.revision}</span>, last
                sequence{" "}
                <span className="font-mono">{state.result.last_sequence}</span>.{" "}
                {submission.operation === "cancel"
                  ? "The workflow may still be running."
                  : "Acceptance does not mean the workflow finished."}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              This request stays only on this page in this session. Navigation
              or reload loses the local retry. Clearing it does not cancel
              backend work.
            </p>
            <Button
              variant="ghost"
              size="sm"
              disabled={state.pending}
              onClick={forget}
            >
              {state.result ? "Clear completed request" : "Abandon local retry"}
            </Button>
          </>
        ) : (
          <>
            {target && (
              <p className="font-mono text-xs break-all">
                {target.namespace} / {target.workflow_id} / {target.run_id} /{" "}
                {build}
              </p>
            )}
            <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
              {!target && (
                <>
                  {field("workflow_id", "Workflow ID")}
                  {field("run_id", "Proposed run ID")}
                  {field("workflow_type", "Workflow type")}
                  {field("build_id", "Build ID")}
                  {field("queue", "Queue")}
                  <DurableInput
                    key={`start-${inputEpoch}`}
                    label="Start input text"
                    value={startInput}
                    onChange={setStartInput}
                    disabled={state.pending}
                  />
                </>
              )}
              {(operation === "signal" || operation === "signalStart") && (
                <>
                  {field("name", "Signal name")}
                  <DurableInput
                    key={`signal-${inputEpoch}`}
                    label="Signal input text"
                    value={signalInput}
                    onChange={setSignalInput}
                    disabled={state.pending}
                  />
                </>
              )}
              {operation === "cancel" &&
                field("reason", "Cancellation reason", true)}
            </div>
            <CapabilityStatus
              enabled={validScope}
              capabilities={capabilities}
              action={actions[operation]}
            />
          </>
        )}
        <CommandAlert
          title={
            state.uncertain
              ? "Latest attempt failed; earlier acceptance is still uncertain"
              : "Command failed"
          }
          error={state.error}
        />
      </ConfirmDialog>
    </Section>
  )
}
function CapabilityStatus({
  enabled,
  capabilities,
  action,
}: {
  enabled: boolean
  capabilities: ReturnType<typeof useCapabilities>
  action?: string
}) {
  if (!enabled)
    return (
      <p className="text-xs text-muted-foreground">
        Enter the workflow identity, type and build to check available actions.
      </p>
    )
  if (capabilities.error)
    return (
      <CommandAlert
        title="Action availability failed"
        error={capabilities.error}
      />
    )
  if (capabilities.loading && !capabilities.data)
    return (
      <p role="status" className="text-xs">
        Checking available actions…
      </p>
    )
  if (capabilities.data?.runtime === "unavailable")
    return (
      <p role="status" className="text-xs">
        Exact build runtime unavailable.
      </p>
    )
  if (
    capabilities.data &&
    (action
      ? !capabilities.data.actions[action]
      : !Object.values(capabilities.data.actions).some(Boolean))
  )
    return (
      <p role="status" className="text-xs">
        Permission denied for these commands.
      </p>
    )
  return (
    <p className="text-xs text-muted-foreground">
      The server rechecks permission on every request.
    </p>
  )
}
