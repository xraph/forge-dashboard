import { IconButton } from "@forge-go/dashboard-kit/components/icon-button"
import { useState } from "react"
import type { FormEvent } from "react"
import { PluginLink } from "@forge-go/dashboard-plugin"
import type { ContractError } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Checkbox } from "@forge-go/dashboard-kit/components/checkbox"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { NativeSelect, NativeSelectOption } from "@forge-go/dashboard-kit/components/native-select"
import { CommandAlert } from "@forge-go/dashboard-kit/components/query-boundary"
import { routePath } from "../keys"
import type { RouteDetail, RouteFields, RouteProtocol } from "../types"

export const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const
const PROTOCOLS: RouteProtocol[] = ["http", "websocket", "sse", "grpc", "graphql"]

export interface TargetRow {
  url: string
  weight: string
  tags: string
}

/** Form state. Numbers are text so an empty field is representable. */
export interface RouteFormValues {
  path: string
  methods: string[]
  priority: string
  enabled: boolean
  protocol: RouteProtocol
  stripPrefix: boolean
  addPrefix: string
  rewritePath: string
  targets: TargetRow[]
  /** `present` means the route already carries an override, so unticking it sends it back disabled, not removed. */
  rateLimit: { on: boolean; present: boolean; requestsPerSec: string; burst: string; perClient: boolean; keyHeader: string }
  auth: { on: boolean; present: boolean; providers: string; scopes: string; skipAuth: boolean; forwardAuth: boolean }
}

export const EMPTY_ROUTE: RouteFormValues = {
  path: "",
  methods: [],
  priority: "",
  enabled: true,
  protocol: "http",
  stripPrefix: false,
  addPrefix: "",
  rewritePath: "",
  targets: [{ url: "", weight: "", tags: "" }],
  rateLimit: { on: false, present: false, requestsPerSec: "", burst: "", perClient: false, keyHeader: "" },
  auth: { on: false, present: false, providers: "", scopes: "", skipAuth: false, forwardAuth: false },
}

const list = (s: string) => s.split(",").map((x) => x.trim()).filter((x) => x !== "")
const num = (s: string, fallback: number) => (s.trim() === "" || Number.isNaN(Number(s)) ? fallback : Number(s))

/**
 * Form values from a route as the server describes it. Path and priority
 * come from `input`, as the operator entered them: the effective values
 * carry the base path and the +100 manual offset, and saving those back
 * would move the route.
 */
export function valuesFromDetail(d: RouteDetail): RouteFormValues {
  const rl = d.rateLimit
  const auth = d.auth
  return {
    path: d.input?.path ?? d.path,
    // Config files may spell methods in lower case; the boxes are upper case.
    methods: [...new Set(d.methods.map((m) => m.toUpperCase()))],
    priority: String(d.input?.priority ?? d.priority),
    enabled: d.enabled,
    protocol: d.protocol,
    stripPrefix: d.stripPrefix,
    addPrefix: d.addPrefix,
    rewritePath: d.rewritePath,
    // A masked URL goes back as shown. The server maps it to the stored one.
    targets: d.targets.map((t) => ({ url: t.url, weight: String(t.weight), tags: t.tags.join(", ") })),
    rateLimit: rl
      ? { on: !!rl.enabled, present: true, requestsPerSec: String(rl.requestsPerSec), burst: String(rl.burst), perClient: rl.perClient, keyHeader: rl.keyHeader ?? "" }
      : EMPTY_ROUTE.rateLimit,
    auth: auth
      ? { on: !!auth.enabled, present: true, providers: (auth.providers ?? []).join(", "), scopes: (auth.scopes ?? []).join(", "), skipAuth: !!auth.skipAuth, forwardAuth: !!auth.forwardAuth }
      : EMPTY_ROUTE.auth,
  }
}

export function fieldsFromValues(v: RouteFormValues): RouteFields {
  return {
    path: v.path.trim(),
    methods: [...v.methods],
    priority: num(v.priority, 0),
    enabled: v.enabled,
    protocol: v.protocol,
    stripPrefix: v.stripPrefix,
    addPrefix: v.addPrefix.trim(),
    rewritePath: v.rewritePath.trim(),
    targets: v.targets
      .filter((t) => t.url.trim() !== "")
      .map((t) => ({ url: t.url.trim(), weight: num(t.weight, 1), tags: list(t.tags) })),
    rateLimit:
      v.rateLimit.on || v.rateLimit.present
        ? {
            enabled: v.rateLimit.on,
            requestsPerSec: num(v.rateLimit.requestsPerSec, 0),
            // A blank burst would save a limit that never lets a request through.
            burst: num(v.rateLimit.burst, Math.max(1, Math.ceil(num(v.rateLimit.requestsPerSec, 0)))),
            perClient: v.rateLimit.perClient,
            ...(v.rateLimit.keyHeader.trim() ? { keyHeader: v.rateLimit.keyHeader.trim() } : {}),
          }
        : null,
    auth:
      v.auth.on || v.auth.present
        ? { enabled: v.auth.on, providers: list(v.auth.providers), scopes: list(v.auth.scopes), skipAuth: v.auth.skipAuth, forwardAuth: v.auth.forwardAuth }
        : null,
  }
}

/** Fields the form renders an error beside. */
const INLINE_FIELDS = ["path", "methods", "protocol", "targets", "rateLimit", "auth"]

export interface RouteFormProps {
  initial: RouteFormValues
  submitLabel: string
  pendingLabel: string
  pending: boolean
  error?: ContractError
  errorTitle: string
  cancelTo: string
  onSubmit: (fields: RouteFields) => void
}

/**
 * A checkbox named by aria-label, with clickable visible text beside it.
 * Kit's Checkbox renders a role="checkbox" span plus a hidden input, and any
 * <label> tied to it (wrapping or htmlFor) names both, so a lookup by name
 * finds two elements. The text is a plain span that toggles instead.
 */
function CheckField({ id, label, checked, onChange, className }: { id: string; label: string; checked: boolean; onChange: (on: boolean) => void; className?: string }) {
  return (
    <div className={`flex items-center gap-2 ${className ?? ""}`}>
      <Checkbox id={id} aria-labelledby={`${id}-label`} checked={checked} onCheckedChange={(on) => onChange(on === true)} />
      <span id={`${id}-label`} className="cursor-default select-none text-sm" onClick={() => onChange(!checked)}>{label}</span>
    </div>
  )
}

function FieldError({ show, error }: { show: boolean; error?: ContractError }) {
  if (!show || !error) return null
  return (
    <p role="alert" className="text-sm text-destructive">
      {error.message}
    </p>
  )
}

export function RouteForm({ initial, submitLabel, pendingLabel, pending, error, errorTitle, cancelTo, onSubmit }: RouteFormProps) {
  const [v, setV] = useState<RouteFormValues>(initial)
  // A stored method the list does not offer (TRACE, CONNECT) still shows, so it can be removed.
  const [extraMethods] = useState(() => initial.methods.filter((m) => !(METHODS as readonly string[]).includes(m)))
  const set = <K extends keyof RouteFormValues>(k: K, value: RouteFormValues[K]) => setV((prev) => ({ ...prev, [k]: value }))
  const named = error?.code === "BAD_REQUEST" ? (error.details?.field as string | undefined) : undefined
  // Only a field with an inline slot suppresses the alert; any other shows it.
  const field = named !== undefined && INLINE_FIELDS.includes(named) ? named : undefined
  const reason = error?.code === "CONFLICT" ? (error.details?.reason as string | undefined) : undefined
  const clashId = reason === "duplicate" ? (error?.details?.routeId as string | undefined) : undefined

  function submit(e: FormEvent) {
    e.preventDefault()
    if (pending) return
    onSubmit(fieldsFromValues(v))
  }

  const setTarget = (i: number, patch: Partial<TargetRow>) =>
    set("targets", v.targets.map((t, j) => (j === i ? { ...t, ...patch } : t)))

  return (
    <form onSubmit={submit} className="flex max-w-2xl flex-col gap-6">
      {/* A field-level error shows beside its field; anything else here. */}
      {error && !field ? <CommandAlert title={errorTitle} error={error} /> : null}
      {clashId ? (
        <p className="text-sm">
          <PluginLink to={routePath(clashId)} className="underline">
            Open the route it clashes with
          </PluginLink>
        </p>
      ) : null}

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-medium">Match</legend>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="route-path">Path</Label>
          <Input id="route-path" className="font-mono" value={v.path} aria-invalid={field === "path" || undefined}
            onChange={(e) => set("path", e.target.value)} spellCheck={false} autoComplete="off" />
          <p className="text-xs text-muted-foreground">
            Bastion serves this under the gateway's base path. End it with /* to match everything below it.
          </p>
          <FieldError show={field === "path"} error={error} />
        </div>
        <div className="flex flex-col gap-1.5" role="group" aria-labelledby="route-methods-label">
          <span id="route-methods-label" className="text-sm font-medium">Methods</span>
          <div className="flex flex-wrap gap-3">
            {[...METHODS, ...extraMethods].map((m) => (
              <CheckField key={m} id={`method-${m}`} label={m} className="font-mono text-xs"
                checked={v.methods.includes(m)}
                onChange={(on) => set("methods", on ? [...v.methods, m] : v.methods.filter((x) => x !== m))} />
            ))}
          </div>
          <p className="text-xs text-muted-foreground">None ticked matches every method.</p>
          <FieldError show={field === "methods"} error={error} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="route-protocol">Protocol</Label>
          <NativeSelect id="route-protocol" value={v.protocol} onChange={(e) => set("protocol", e.target.value as RouteProtocol)}>
            {PROTOCOLS.map((p) => (
              <NativeSelectOption key={p} value={p}>{p}</NativeSelectOption>
            ))}
          </NativeSelect>
          <FieldError show={field === "protocol"} error={error} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="route-priority">Priority</Label>
          <Input id="route-priority" type="number" className="font-mono w-32" value={v.priority}
            onChange={(e) => set("priority", e.target.value)} />
          <p className="text-xs text-muted-foreground">
            Higher wins among routes that match. Bastion adds 100 to every manual route so it sorts above discovered ones.
          </p>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3" aria-invalid={field === "targets" || undefined}>
        <legend className="text-sm font-medium">Upstreams</legend>
        {v.targets.map((t, i) => (
          <div key={i} className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1.5 grow">
              <Label htmlFor={`target-url-${i}`}>{`Upstream ${i + 1} URL`}</Label>
              <Input id={`target-url-${i}`} className="font-mono" value={t.url} spellCheck={false} autoComplete="off"
                onChange={(e) => setTarget(i, { url: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1.5 w-24">
              <Label htmlFor={`target-weight-${i}`}>{`Upstream ${i + 1} weight`}</Label>
              <Input id={`target-weight-${i}`} type="number" value={t.weight} onChange={(e) => setTarget(i, { weight: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1.5 w-40">
              <Label htmlFor={`target-tags-${i}`}>{`Upstream ${i + 1} tags`}</Label>
              <Input id={`target-tags-${i}`} value={t.tags} onChange={(e) => setTarget(i, { tags: e.target.value })} />
            </div>
            {v.targets.length > 1 ? (
              <IconButton type="button" variant="outline" onClick={() => set("targets", v.targets.filter((_, j) => j !== i))} label={`Remove upstream ${i + 1}`} />
            ) : null}
          </div>
        ))}
        <div>
          <IconButton type="button" variant="outline" onClick={() => set("targets", [...v.targets, { url: "", weight: "", tags: "" }])} label="Add upstream" />
        </div>
        <FieldError show={field === "targets"} error={error} />
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-medium">Rewriting</legend>
        <CheckField id="route-strip" label="Strip the matched prefix" checked={v.stripPrefix} onChange={(on) => set("stripPrefix", on)} />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="route-add-prefix">Add prefix</Label>
          <Input id="route-add-prefix" className="font-mono" value={v.addPrefix} onChange={(e) => set("addPrefix", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="route-rewrite">Rewrite path</Label>
          <Input id="route-rewrite" className="font-mono" value={v.rewritePath} onChange={(e) => set("rewritePath", e.target.value)} />
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-medium">Rate limit</legend>
        <CheckField id="rl-on" label="Limit this route" checked={v.rateLimit.on}
          onChange={(on) => set("rateLimit", { ...v.rateLimit, on })} />
        {v.rateLimit.on ? (
          <div className="flex flex-wrap gap-3">
            <div className="flex flex-col gap-1.5 w-40">
              <Label htmlFor="rl-rps">Requests per second</Label>
              <Input id="rl-rps" type="number" value={v.rateLimit.requestsPerSec}
                onChange={(e) => set("rateLimit", { ...v.rateLimit, requestsPerSec: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1.5 w-32">
              <Label htmlFor="rl-burst">Burst</Label>
              <Input id="rl-burst" type="number" value={v.rateLimit.burst}
                onChange={(e) => set("rateLimit", { ...v.rateLimit, burst: e.target.value })} />
            </div>
            <CheckField id="rl-per-client" label="Per client" className="self-end" checked={v.rateLimit.perClient}
              onChange={(on) => set("rateLimit", { ...v.rateLimit, perClient: on })} />
          </div>
        ) : null}
        <FieldError show={field === "rateLimit"} error={error} />
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-medium">Authentication</legend>
        <CheckField id="auth-on" label="Set authentication for this route" checked={v.auth.on}
          onChange={(on) => set("auth", { ...v.auth, on })} />
        {v.auth.on ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="auth-providers">Providers</Label>
              <Input id="auth-providers" value={v.auth.providers} onChange={(e) => set("auth", { ...v.auth, providers: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="auth-scopes">Scopes</Label>
              <Input id="auth-scopes" value={v.auth.scopes} onChange={(e) => set("auth", { ...v.auth, scopes: e.target.value })} />
            </div>
            <CheckField id="auth-skip" label="Skip gateway authentication" checked={v.auth.skipAuth}
              onChange={(on) => set("auth", { ...v.auth, skipAuth: on })} />
            <CheckField id="auth-forward" label="Forward identity headers" checked={v.auth.forwardAuth}
              onChange={(on) => set("auth", { ...v.auth, forwardAuth: on })} />
          </div>
        ) : null}
        <FieldError show={field === "auth"} error={error} />
      </fieldset>

      <CheckField id="route-enabled" label="Enabled" checked={v.enabled} onChange={(on) => set("enabled", on)} />

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>{pending ? pendingLabel : submitLabel}</Button>
        <PluginLink to={cancelTo} className="text-sm underline self-center">Cancel</PluginLink>
      </div>
    </form>
  )
}
