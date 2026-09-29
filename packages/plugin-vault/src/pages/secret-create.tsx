import { useRef, useState } from "react"
import type { ComponentType, FormEvent } from "react"
import {
  PluginLink,
  useCommand,
  useNavigateTo,
} from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { CommandAlert } from "@forge-go/dashboard-kit/components/query-boundary"
import { secretPath } from "../keys"
import type { SecretSummary } from "./secrets"

/** Mirrors the Go `secretsCreateResponse`. It never carries a value. */
interface CreateResponse {
  secret: SecretSummary
}

/**
 * Turns a `datetime-local` string into the RFC3339 UTC instant the contract
 * takes. The input has no zone, so `new Date(local)` reads it in the
 * operator's own, and `toISOString` writes it back out as UTC with a "Z".
 * Returns undefined for an empty or unparseable string.
 */
function toRFC3339(local: string): string | undefined {
  if (local === "") return undefined
  const at = new Date(local)
  return Number.isNaN(at.getTime()) ? undefined : at.toISOString()
}

/**
 * Whether an RFC3339 instant has already passed. Read at the moment of the
 * call, not memoised: the render-time answer drives the message and the
 * disabled button, and submit asks again because the clock moves between them.
 */
function isPast(iso: string): boolean {
  return Date.parse(iso) <= Date.now()
}

/**
 * The create-secret form.
 *
 * Secrets are write-only. The value lives in the password field's own DOM
 * value for as long as it takes to type it and for one request, and nowhere
 * else: it is not React state, not a query param, not a label, not a preview,
 * not an error string, and the field is emptied before the page navigates away
 * on success. On failure it stays in the field so the operator can retry
 * without retyping.
 *
 * The field is uncontrolled on purpose. React writes a controlled input's
 * value into its HTML `value` attribute, password or not, and anything that
 * serialises markup (an error reporter, a page save, a replay tool) can then
 * read the secret. With no `value` prop React never touches the attribute.
 */
export const SecretCreatePage: ComponentType<PluginPageProps> = () => {
  const create = useCommand<CreateResponse>("secrets.create")
  const navigateTo = useNavigateTo()
  const [key, setKey] = useState("")
  // Only whether the field is empty is tracked, for gating submit. The value
  // itself is read from the input at submit time and never held in state.
  const valueRef = useRef<HTMLInputElement>(null)
  const [hasValue, setHasValue] = useState(false)
  const [expires, setExpires] = useState("")
  // The key as it was sent. A CONFLICT is about this key, not whatever the
  // field holds now, so its message and link must not follow later edits.
  const [submittedKey, setSubmittedKey] = useState("")

  const trimmedKey = key.trim()
  const expiresAt = toRFC3339(expires)
  const expiryInPast = expiresAt !== undefined && isPast(expiresAt)
  const canSubmit =
    !create.loading && trimmedKey !== "" && hasValue && !expiryInPast

  async function submit(event: FormEvent) {
    event.preventDefault()
    // Re-checked here rather than trusting the disabled button: Enter in a
    // field submits the form, and the clock moves between renders.
    if (!canSubmit) return
    if (expiresAt !== undefined && isPast(expiresAt)) return
    const input = valueRef.current
    if (!input || input.value === "") return

    // Exactly key, value, and expiresAt only when set. No appId (the server
    // uses the vault's own app) and no metadata (not part of this form).
    const payload: { key: string; value: string; expiresAt?: string } = {
      key: trimmedKey,
      value: input.value,
    }
    if (expiresAt !== undefined) payload.expiresAt = expiresAt

    setSubmittedKey(trimmedKey)
    const result = await create.execute(payload)
    // execute resolves undefined only when the client throws, so this is the
    // failure check. Key, expiry and value all stay put for a retry.
    if (result === undefined) return

    // Empty the field before leaving, so nothing after this point can hold
    // the value, whatever the navigation does.
    input.value = ""
    setHasValue(false)
    navigateTo(secretPath(trimmedKey))
  }

  const conflict = create.error?.code === "CONFLICT"

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="New secret"
        description="The value is write-only. Once you save it, it cannot be shown again."
      />
      <CommandAlert
        title="Could not create the secret"
        error={
          create.error && conflict
            ? {
                code: create.error.code,
                message: `A secret with the key "${submittedKey}" already exists. Creating it again would not change it. To give it a new value, open it and update it.`,
              }
            : create.error
        }
      />
      {conflict ? (
        <p className="text-sm">
          <PluginLink to={secretPath(submittedKey)} className="underline">
            Open the existing secret
          </PluginLink>
        </p>
      ) : null}
      <form onSubmit={(e) => void submit(e)} className="flex max-w-lg flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="secret-key">Key</Label>
          <Input
            id="secret-key"
            className="font-mono"
            autoComplete="off"
            spellCheck={false}
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="secret-value">Value</Label>
          {/*
            "new-password" rather than "off": browsers ignore "off" on
            password fields and offer to fill or save them anyway, but they
            honour "new-password" by not offering a saved credential here.
            spellCheck is off so the value is never sent to a spelling service.
          */}
          <Input
            id="secret-value"
            ref={valueRef}
            type="password"
            autoComplete="new-password"
            spellCheck={false}
            onChange={(e) => setHasValue(e.target.value !== "")}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="secret-expires">Expires (optional)</Label>
          <Input
            id="secret-expires"
            type="datetime-local"
            value={expires}
            onChange={(e) => setExpires(e.target.value)}
            aria-invalid={expiryInPast || undefined}
          />
          {expiryInPast ? (
            <p role="alert" className="text-sm text-destructive">
              The expiry is in the past. Pick a time that has not happened yet.
            </p>
          ) : null}
        </div>
        <div className="flex gap-2">
          <Button type="submit" disabled={!canSubmit}>
            {create.loading ? "Creating…" : "Create secret"}
          </Button>
          <PluginLink to="/secrets" className="text-sm underline self-center">
            Cancel
          </PluginLink>
        </div>
      </form>
    </div>
  )
}
