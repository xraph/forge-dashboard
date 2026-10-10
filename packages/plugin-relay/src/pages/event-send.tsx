import { IconButton } from "@forge-go/dashboard-kit/components/icon-button"
import { useId, useState } from "react"
import { useCommand, useNavigateTo, useQuery } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import {
  NativeSelect,
  NativeSelectOption,
} from "@forge-go/dashboard-kit/components/native-select"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { CommandAlert } from "@forge-go/dashboard-kit/components/query-boundary"
import { Textarea } from "@forge-go/dashboard-kit/components/textarea"
import { prettyJSON } from "../components/json-view"
import type { EventTypeDetail, EventTypeSummary } from "../types"

interface SendResult {
  ok: boolean
  id?: string
  duplicate?: boolean
}

/** Parses the payload box: empty is no payload, anything else must be JSON. */
export function parsePayload(text: string): {
  value?: unknown
  error?: string
} {
  if (text.trim() === "") return { value: undefined }
  try {
    return { value: JSON.parse(text) }
  } catch {
    return {
      error: "Not valid JSON. Check for a missing quote, comma or brace.",
    }
  }
}

/**
 * Sends a real event through Relay, exactly as an application would: it is
 * checked against its type's schema, stored, and delivered to every endpoint
 * that matches. That makes this the way to test the whole path.
 */
export function RelayEventSendPage() {
  const types = useQuery<{ types: EventTypeSummary[] }>("eventTypes.list", {})
  const send = useCommand<SendResult>("events.send")
  const navigate = useNavigateTo()
  const id = useId()
  const [type, setType] = useState("")
  const [tenant, setTenant] = useState("")
  const [data, setData] = useState("")
  const [key, setKey] = useState("")
  const [notice, setNotice] = useState<string | null>(null)

  const payload = parsePayload(data)
  const refused = send.error?.details?.field
  const ready = type !== "" && tenant.trim() !== "" && !payload.error

  async function submit(e: { preventDefault: () => void }) {
    e.preventDefault()
    if (!ready || send.loading) return
    setNotice(null)
    const res = await send.execute({
      type,
      tenantId: tenant.trim(),
      ...(payload.value !== undefined ? { data: payload.value } : {}),
      ...(key.trim() ? { idempotencyKey: key.trim() } : {}),
    })
    if (res === undefined) return
    if (res.duplicate || !res.id) {
      setNotice(
        "That idempotency key has been used before, so nothing was sent."
      )
      return
    }
    navigate(`/events/${res.id}`)
  }

  const activeTypes = types.data?.types ?? []

  return (
    <section className="flex min-w-0 flex-col gap-4">
      <PageHeader
        title="Send an event"
        description="Relay checks it against its type's schema and delivers it to every endpoint that matches, as it would for your application."
      />
      <form
        className="flex max-w-xl min-w-0 flex-col gap-4"
        onSubmit={submit}
        noValidate
      >
        <CommandAlert error={send.error} title="Could not send the event" />
        {notice && (
          <p role="status" className="rounded-md border px-3 py-2 text-sm">
            {notice}
          </p>
        )}
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor={`${id}-type`}>Event type</Label>
          <NativeSelect
            id={`${id}-type`}
            value={type}
            onChange={(e) => setType(e.target.value)}
            aria-invalid={refused === "type" || undefined}
          >
            <NativeSelectOption value="">Choose a type</NativeSelectOption>
            {activeTypes.map((t) => (
              <NativeSelectOption key={t.name} value={t.name}>
                {t.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor={`${id}-tenant`}>Tenant ID</Label>
          <Input
            id={`${id}-tenant`}
            className="font-mono"
            value={tenant}
            onChange={(e) => setTenant(e.target.value)}
            aria-invalid={refused === "tenant_id" || undefined}
          />
          <span className="text-xs text-muted-foreground">
            Only this tenant's endpoints receive it.
          </span>
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <Label htmlFor={`${id}-data`}>Payload</Label>
            {type && <UseExample type={type} onUse={(text) => setData(text)} />}
          </div>
          <Textarea
            id={`${id}-data`}
            className="min-h-40 font-mono"
            value={data}
            onChange={(e) => setData(e.target.value)}
            aria-invalid={
              Boolean(payload.error) || refused === "data" || undefined
            }
            aria-describedby={payload.error ? `${id}-data-error` : undefined}
          />
          {payload.error && (
            <span
              id={`${id}-data-error`}
              className="text-xs font-medium text-destructive"
            >
              {payload.error}
            </span>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor={`${id}-key`}>Idempotency key</Label>
          <Input
            id={`${id}-key`}
            className="font-mono"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <span className="text-xs text-muted-foreground">
            Optional. Sending the same key twice sends the event once.
          </span>
        </div>
        <div>
          <Button type="submit" disabled={!ready || send.loading}>
            {send.loading ? "Sending…" : "Send event"}
          </Button>
        </div>
      </form>
    </section>
  )
}

/** Fills the payload from the type's registered example, when it has one. */
function UseExample({
  type,
  onUse,
}: {
  type: string
  onUse: (text: string) => void
}) {
  const detail = useQuery<EventTypeDetail>("eventTypes.detail", { name: type })
  const example = detail.data?.example
  if (example === undefined || example === null) return null
  return (
    <IconButton
      type="button"
      variant="ghost"
      onClick={() => onUse(prettyJSON(example))}
      label="Use the example"
    />
  )
}
