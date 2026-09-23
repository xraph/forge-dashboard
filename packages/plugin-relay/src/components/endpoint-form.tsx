import { useEffect, useId, useState, type ReactNode } from "react"
import type { ContractError } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { CommandAlert } from "@forge-go/dashboard-kit/components/query-boundary"
import { Textarea } from "@forge-go/dashboard-kit/components/textarea"

/** The form's raw text, one string per field, exactly as typed. */
export interface EndpointFormValues {
  tenantId: string
  url: string
  description: string
  eventTypes: string
  rateLimit: string
  headers: string
  metadata: string
}

export const emptyEndpointForm: EndpointFormValues = {
  tenantId: "",
  url: "",
  description: "",
  eventTypes: "",
  rateLimit: "",
  headers: "",
  metadata: "",
}

/**
 * What the form hands back once every field parses. Empty optional fields are
 * still present here, as "" or {} or undefined: create drops them, and edit
 * sends them, because to `endpoints.update` an empty value means "clear it".
 */
export interface ParsedEndpoint {
  tenantId: string
  url: string
  description: string
  eventTypes: string[]
  rateLimit?: number
  headers: Record<string, string>
  metadata: Record<string, string>
}

/** Commas and newlines both separate patterns. Blanks between them drop. */
export function splitPatterns(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((p) => p.trim())
    .filter(Boolean)
}

/**
 * "Name: value", one per line, split at the first colon so a value can carry
 * its own (an Authorization header usually does). Blank lines are skipped.
 */
export function parsePairs(text: string): {
  pairs: Record<string, string>
  error?: string
} {
  const pairs: Record<string, string> = {}
  const lines = text.split("\n")
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line === "") continue
    const colon = line.indexOf(":")
    if (colon <= 0)
      return {
        pairs,
        error: `Line ${i + 1} needs a name, a colon, then the value.`,
      }
    pairs[line.slice(0, colon).trim()] = line.slice(colon + 1).trim()
  }
  return { pairs }
}

function parseRateLimit(text: string): { value?: number; error?: string } {
  const t = text.trim()
  if (t === "") return {}
  if (!/^\d+$/.test(t))
    return {
      error: "A whole number of deliveries per second, or empty for no limit.",
    }
  return { value: Number(t) }
}

/** Joins a stored map back into the "Name: value" lines the form edits. */
export function pairsToText(m?: Record<string, string>): string {
  return Object.entries(m ?? {})
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n")
}

/**
 * Relay's validation fields, as its Go ValidationError names them, mapped to
 * the input each one belongs to. A field not listed here marks nothing.
 */
const SERVER_FIELDS: Record<string, "tenantId" | "url" | "eventTypes"> = {
  tenant_id: "tenantId",
  url: "url",
  event_types: "eventTypes",
}

const FIELD_LABELS = {
  tenantId: "Tenant ID",
  url: "URL",
  eventTypes: "Event types",
}

type ServerFieldKey = (typeof SERVER_FIELDS)[string]

interface FieldProps {
  id: string
  label: string
  help?: ReactNode
  error?: string
  children: (describedBy: string | undefined, invalid: boolean) => ReactNode
}

function Field({ id, label, help, error, children }: FieldProps) {
  const helpId = help ? `${id}-help` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [helpId, errorId].filter(Boolean).join(" ") || undefined
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children(describedBy, Boolean(error))}
      {help && (
        <span id={helpId} className="text-xs text-muted-foreground">
          {help}
        </span>
      )}
      {error && (
        <span id={errorId} className="text-xs font-medium text-destructive">
          {error}
        </span>
      )}
    </div>
  )
}

export interface EndpointFormProps {
  /** Create asks for a tenant. An endpoint cannot move tenants, so edit does not. */
  mode: "create" | "edit"
  initial: EndpointFormValues
  submitLabel: string
  pendingLabel: string
  pending: boolean
  error?: ContractError
  errorTitle: string
  onSubmit: (parsed: ParsedEndpoint) => void
  onCancel?: () => void
}

export function EndpointForm({
  mode,
  initial,
  submitLabel,
  pendingLabel,
  pending,
  error,
  errorTitle,
  onSubmit,
  onCancel,
}: EndpointFormProps) {
  const [values, setValues] = useState(initial)
  const id = useId()
  // The refusal whose field has since been edited. Compared by identity, so
  // the next refusal marks its field again even if it names the same one.
  const [answered, setAnswered] = useState<ContractError | undefined>()

  const rawField = error?.details?.field
  const refusedField: ServerFieldKey | undefined =
    typeof rawField === "string" && error !== answered
      ? SERVER_FIELDS[rawField]
      : undefined
  // The alert already names the field, so the copy beside it drops the
  // "URL: " the message leads with.
  const refusedMessage =
    refusedField && error
      ? error.message.replace(`${FIELD_LABELS[refusedField]}: `, "")
      : undefined
  const refusal = (key: ServerFieldKey) =>
    refusedField === key ? refusedMessage : undefined

  const inputId: Record<ServerFieldKey, string> = {
    tenantId: `${id}-tenant`,
    url: `${id}-url`,
    eventTypes: `${id}-events`,
  }
  // Focus moves to the refused field, which scrolls it into view: the
  // button that sent the form is at its bottom and the alert at its top.
  const focusTarget = refusedField ? inputId[refusedField] : undefined
  useEffect(() => {
    if (focusTarget) document.getElementById(focusTarget)?.focus()
  }, [error, focusTarget])

  const set =
    (key: keyof EndpointFormValues) => (e: { target: { value: string } }) => {
      if (error && key === refusedField) setAnswered(error)
      setValues((v) => ({ ...v, [key]: e.target.value }))
    }

  // Parsed on every render, so the button and the inline errors can never
  // disagree about whether the form is sendable.
  const patterns = splitPatterns(values.eventTypes)
  const headers = parsePairs(values.headers)
  const metadata = parsePairs(values.metadata)
  const rateLimit = parseRateLimit(values.rateLimit)
  const ready =
    (mode === "edit" || values.tenantId.trim() !== "") &&
    values.url.trim() !== "" &&
    patterns.length > 0 &&
    !headers.error &&
    !metadata.error &&
    !rateLimit.error

  function submit(e: { preventDefault: () => void }) {
    e.preventDefault()
    if (!ready || pending) return
    onSubmit({
      tenantId: values.tenantId.trim(),
      url: values.url.trim(),
      description: values.description.trim(),
      eventTypes: patterns,
      rateLimit: rateLimit.value,
      headers: headers.pairs,
      metadata: metadata.pairs,
    })
  }

  return (
    <form className="flex max-w-xl flex-col gap-4" onSubmit={submit} noValidate>
      {/* Relay's messages name their field ("URL: invalid URL"), so the
          alert reads on its own; the field it names is marked as well. */}
      <CommandAlert error={error} title={errorTitle} />
      {mode === "create" && (
        <Field
          id={`${id}-tenant`}
          label="Tenant ID"
          help="The tenant this endpoint delivers for. It cannot change later."
          error={refusal("tenantId")}
        >
          {(d, invalid) => (
            <Input
              id={`${id}-tenant`}
              className="font-mono"
              value={values.tenantId}
              onChange={set("tenantId")}
              aria-describedby={d}
              aria-invalid={invalid || undefined}
            />
          )}
        </Field>
      )}
      <Field
        id={`${id}-url`}
        label="URL"
        help="Where Relay POSTs each delivery."
        error={refusal("url")}
      >
        {(d, invalid) => (
          <Input
            id={`${id}-url`}
            type="url"
            placeholder="https://example.com/webhooks"
            value={values.url}
            onChange={set("url")}
            aria-describedby={d}
            aria-invalid={invalid || undefined}
          />
        )}
      </Field>
      <Field id={`${id}-description`} label="Description">
        {(d) => (
          <Input
            id={`${id}-description`}
            value={values.description}
            onChange={set("description")}
            aria-describedby={d}
          />
        )}
      </Field>
      <Field
        id={`${id}-events`}
        label="Event types"
        help={
          <>
            One pattern per line or comma separated.{" "}
            <code className="font-mono">invoice.*</code> matches every invoice
            event, and <code className="font-mono">*</code> matches everything.
          </>
        }
        error={refusal("eventTypes")}
      >
        {(d, invalid) => (
          <Textarea
            id={`${id}-events`}
            className="font-mono"
            value={values.eventTypes}
            onChange={set("eventTypes")}
            aria-describedby={d}
            aria-invalid={invalid || undefined}
          />
        )}
      </Field>
      <Field
        id={`${id}-rate`}
        label="Rate limit"
        help="Deliveries per second. Empty means no limit."
        error={rateLimit.error}
      >
        {(d, invalid) => (
          <Input
            id={`${id}-rate`}
            inputMode="numeric"
            value={values.rateLimit}
            onChange={set("rateLimit")}
            aria-describedby={d}
            aria-invalid={invalid || undefined}
          />
        )}
      </Field>
      <Field
        id={`${id}-headers`}
        label="Headers"
        help="Sent with every delivery. One Name: value per line."
        error={headers.error}
      >
        {(d, invalid) => (
          <Textarea
            id={`${id}-headers`}
            className="font-mono"
            value={values.headers}
            onChange={set("headers")}
            aria-describedby={d}
            aria-invalid={invalid || undefined}
          />
        )}
      </Field>
      <Field
        id={`${id}-metadata`}
        label="Metadata"
        help="Your own labels, stored and never sent. One name: value per line."
        error={metadata.error}
      >
        {(d, invalid) => (
          <Textarea
            id={`${id}-metadata`}
            className="font-mono"
            value={values.metadata}
            onChange={set("metadata")}
            aria-describedby={d}
            aria-invalid={invalid || undefined}
          />
        )}
      </Field>
      <div className="flex gap-2">
        <Button type="submit" disabled={!ready || pending}>
          {pending ? pendingLabel : submitLabel}
        </Button>
        {onCancel && (
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={pending}
          >
            Cancel
          </Button>
        )}
      </div>
    </form>
  )
}
