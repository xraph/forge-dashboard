import { useEffect, useRef, useState } from "react"
import { ContractError, usePluginClient } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { CommandAlert } from "@forge-go/dashboard-kit/components/query-boundary"
import { PayloadView } from "./payload"
import { Section, Text } from "./components"
import type { DurablePayload, RunKey } from "./durable-types"

export function decodePayload(value: string) {
  return new TextDecoder("utf-8", { fatal: true }).decode(
    Uint8Array.from(atob(value), (char) => char.charCodeAt(0))
  )
}
/** Imperative audited read. Never useQuery, storage, telemetry or URL state. */
export function DurablePayloadPanel({ target }: { target: RunKey }) {
  const client = usePluginClient()
  const [state, setState] = useState<{
    loading: boolean
    owner: typeof client
    data?: DurablePayload
    error?: ContractError
  }>({ loading: false, owner: client })
  if (state.owner !== client) setState({ loading: false, owner: client })
  const request = useRef<AbortController | null>(null)
  useEffect(() => {
    const hide = () => {
      request.current?.abort()
      setState({ loading: false, owner: client })
    }
    const visibility = () => {
      if (document.visibilityState === "hidden") hide()
    }
    document.addEventListener("visibilitychange", visibility)
    return () => {
      request.current?.abort()
      document.removeEventListener("visibilitychange", visibility)
    }
  }, [client])
  async function reveal() {
    request.current?.abort()
    const abort = new AbortController()
    request.current = abort
    setState({ loading: true, owner: client })
    try {
      const data = await client.query<DurablePayload>(
        "durable.payload",
        { ...target },
        { signal: abort.signal }
      )
      if (!abort.signal.aborted)
        setState({ data, loading: false, owner: client })
    } catch (cause) {
      if (!abort.signal.aborted)
        setState({
          loading: false,
          owner: client,
          error:
            cause instanceof ContractError
              ? cause
              : new ContractError("TRANSPORT", "Payload reveal failed."),
        })
    }
  }
  return (
    <Section title="Protected payload">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-muted-foreground">
          Each reveal requires payload permission and durable audit acceptance.
        </p>
        <Button
          variant="outline"
          size="sm"
          disabled={state.loading}
          onClick={
            state.data
              ? () => {
                  request.current?.abort()
                  setState({ loading: false, owner: client })
                }
              : reveal
          }
        >
          {state.loading
            ? "Revealing…"
            : state.data
              ? "Hide payload"
              : "Reveal payload"}
        </Button>
      </div>
      <CommandAlert title="Payload remains restricted" error={state.error} />
      {state.data && (
        <>
          <p className="text-xs text-muted-foreground">
            Revealed at revision{" "}
            <span className="font-mono">{state.data.revision}</span>
          </p>
          {(["input", "output"] as const).map((field) => (
            <PayloadBytes
              key={field}
              label={field}
              value={state.data![field]}
            />
          ))}
        </>
      )}
    </Section>
  )
}
function PayloadBytes({
  label,
  value,
}: {
  label: string
  value: string | null
}) {
  if (value === null)
    return (
      <p className="text-xs">
        {label}: <Text value={null} label={label} />
      </p>
    )
  let text: string
  try {
    text = decodePayload(value)
  } catch {
    return (
      <p className="text-xs">
        {label}: Binary payload, unavailable as UTF-8 text.
      </p>
    )
  }
  return <PayloadView label={label} value={{ kind: "json", jsonText: text }} />
}
