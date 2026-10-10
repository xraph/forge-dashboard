import { useCallback, useEffect, useRef, useState } from "react"
import {
  ContractError,
  queryStore,
  usePluginClient,
} from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { DurableInput, encodedInput } from "./durable-input"
import type { DurableInputValue } from "./durable-input"
import { ZeroState } from "@forge-go/dashboard-kit/components/zero-state"
import { CommandAlert } from "@forge-go/dashboard-kit/components/query-boundary"
import { DurableSession } from "./durable-session"
import { Section } from "./components"
import { PayloadView } from "./payload"
import { outputBytes, outputText, validIdentifier } from "./durable-bytes"
import type { DurableQueryResult, RunKey } from "./durable-types"

/** Mounted under DurableSession and keyed to exact run/build and command acceptance. */
export function DurableQueryPanel({
  target,
  build,
  allowed,
}: {
  target: RunKey
  build: string
  allowed: boolean
}) {
  return (
    <DurableSession>
      <QueryState
        key={JSON.stringify([
          target.namespace,
          target.workflow_id,
          target.run_id,
          build,
          allowed,
        ])}
        target={target}
        build={build}
        allowed={allowed}
      />
    </DurableSession>
  )
}
function QueryState({
  target,
  build,
  allowed,
}: {
  target: RunKey
  build: string
  allowed: boolean
}) {
  const client = usePluginClient()
  const [inputEpoch, setInputEpoch] = useState(0)
  const [name, setName] = useState("")
  const [input, setInput] = useState<DurableInputValue>({ text: "" })
  const [state, setState] = useState<{
    loading?: boolean
    data?: DurableQueryResult
    error?: ContractError
  }>({})
  const request = useRef<AbortController | null>(null)
  const generation = useRef(0)
  const clear = useCallback(() => {
    generation.current++
    request.current?.abort()
    setInputEpoch((value) => value + 1)
    setName("")
    setInput({ text: "" })
    setState({})
  }, [])
  useEffect(() => {
    const owner = generation
    const visibility = () => {
      if (document.visibilityState === "hidden") clear()
    }
    document.addEventListener("visibilitychange", visibility)
    return () => {
      owner.current++
      request.current?.abort()
      document.removeEventListener("visibilitychange", visibility)
    }
  }, [clear])
  async function run() {
    let encoded: string
    try {
      encoded = encodedInput(input)
    } catch {
      setState({
        error: new ContractError(
          "BAD_REQUEST",
          "Query input must be valid Unicode within 1 MiB."
        ),
      })
      return
    }
    request.current?.abort()
    const abort = new AbortController()
    request.current = abort
    const version = ++generation.current
    const epoch = queryStore.contextSnapshot()
    const owns = () =>
      !abort.signal.aborted &&
      generation.current === version &&
      queryStore.contextSnapshot() === epoch &&
      document.visibilityState !== "hidden"
    setState({ loading: true })
    try {
      const data = await client.query<DurableQueryResult>(
        "durable.query",
        { ...target, build_id: build, name, input: encoded },
        { signal: abort.signal }
      )
      if (owns()) setState({ data })
    } catch (cause) {
      if (owns())
        setState({
          error: new ContractError(
            cause instanceof ContractError ? cause.code : "TRANSPORT",
            cause instanceof ContractError && cause.code === "PERMISSION_DENIED"
              ? "Query permission denied."
              : "Query failed. Check the handler name, build and runtime availability."
          ),
        })
    }
  }
  return (
    <Section title="Workflow query">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-0 flex-col gap-1 text-xs">
          Query name
          <Input
            className="h-8 w-48 max-w-full"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <Button
          size="sm"
          variant="outline"
          disabled={
            !allowed ||
            !validIdentifier(name, 200) ||
            state.loading ||
            input.loading ||
            !!input.error
          }
          onClick={run}
        >
          {state.loading ? "Querying…" : "Run query"}
        </Button>
        <Button size="sm" variant="ghost" onClick={clear}>
          Clear query
        </Button>
        <p className="text-xs text-muted-foreground">
          Manual, audited read. Hidden results are discarded.
        </p>
      </div>
      <details
        className="text-xs"
        onToggle={(event) => {
          if (!event.currentTarget.open) {
            setInputEpoch((value) => value + 1)
            setInput({ text: "" })
          }
        }}
      >
        <summary className="cursor-pointer py-1">Query input</summary>
        <DurableInput
          key={inputEpoch}
          label="Query input text"
          value={input}
          onChange={setInput}
          disabled={state.loading}
        />
      </details>
      <CommandAlert title="Query unavailable" error={state.error} />
      {state.data && (
        <>
          <p className="text-xs">
            Observed revision{" "}
            <span className="font-mono">{state.data.revision}</span>, last
            sequence{" "}
            <span className="font-mono">{state.data.last_sequence}</span>.
          </p>
          <QueryBytes value={state.data.output} />
        </>
      )}
    </Section>
  )
}
function QueryBytes({ value }: { value: string | null }) {
  if (value === null || value === "")
    return (
      <ZeroState
        title="Empty query output"
        body="This query returned no output bytes."
      />
    )
  try {
    outputBytes(value)
  } catch {
    return (
      <ZeroState
        title="Invalid query output encoding"
        body="The server returned malformed base64. Run the query again to request a new result."
      />
    )
  }
  let text: string
  try {
    text = outputText(value)
  } catch {
    return (
      <>
        <ZeroState
          title="Binary query output"
          body="Output is not valid UTF-8 text. Its original base64 bytes are shown below."
        />
        <pre
          className="max-h-48 overflow-auto text-xs break-all whitespace-pre-wrap"
          aria-label="Query output base64"
        >
          {value}
        </pre>
      </>
    )
  }
  return (
    <PayloadView
      label="Query output"
      value={{ kind: "json", jsonText: text }}
    />
  )
}
