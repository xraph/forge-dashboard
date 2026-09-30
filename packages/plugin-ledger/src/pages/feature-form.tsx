import { useState } from "react"
import type { FormEvent } from "react"
import { PluginLink } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { NativeSelect, NativeSelectOption } from "@forge-go/dashboard-kit/components/native-select"
import { CommandAlert } from "@forge-go/dashboard-kit/components/query-boundary"
import { Textarea } from "@forge-go/dashboard-kit/components/textarea"
import type { CatalogFeature, FeatureType, Period } from "../types"

const number = new Intl.NumberFormat()

/**
 * A catalog feature's default limit as a person reads it. An on-or-off
 * feature is included only above zero: the engine reads -1 there as off, not
 * as unlimited, so it never reads "Unlimited".
 */
export function defaultLimitText(f: Pick<CatalogFeature, "type" | "default_limit">): string {
  if (f.type === "boolean") return f.default_limit > 0 ? "Included" : "Not included"
  if (f.default_limit === -1) return "Unlimited"
  return number.format(f.default_limit)
}

export interface FeatureFormValue {
  key: string
  name: string
  description: string
  type: FeatureType
  limit: string
  unlimited: boolean
  period: Period
  soft_limit: boolean
}

export interface ParsedFeature {
  key: string
  name: string
  description: string
  type: FeatureType
  default_limit: number
  period: Period
  soft_limit: boolean
}

export function emptyFeatureForm(): FeatureFormValue {
  return { key: "", name: "", description: "", type: "metered", limit: "0", unlimited: false, period: "monthly", soft_limit: false }
}

export function featureToForm(f: CatalogFeature): FeatureFormValue {
  // A stored -1 on an on-or-off feature means "off" to the engine, so the form
  // shows 0 rather than an Unlimited box the type does not offer.
  const unlimited = f.default_limit === -1 && f.type !== "boolean"
  return {
    key: f.key,
    name: f.name,
    description: f.description ?? "",
    type: f.type,
    limit: unlimited ? "" : String(Math.max(0, f.default_limit)),
    unlimited,
    period: f.period,
    soft_limit: f.soft_limit,
  }
}

export function parseFeatureForm(v: FeatureFormValue, mode: "create" | "edit"): { ok: true; value: ParsedFeature } | { ok: false; errors: string[] } {
  const errors: string[] = []
  const key = v.key.trim()
  if (mode === "create" && key === "") errors.push("Key is required.")
  const unlimited = v.unlimited && v.type !== "boolean"
  let limit = -1
  if (!unlimited) {
    if (!/^\d+$/.test(v.limit.trim())) {
      errors.push(
        v.type === "boolean"
          ? "The default limit must be a whole number, 0 or more. 1 or more includes the feature and 0 leaves it out."
          : "The default limit must be a whole number, 0 or more, or unlimited.",
      )
    } else limit = Number(v.limit.trim())
  }
  if (errors.length > 0) return { ok: false, errors }
  return {
    ok: true,
    value: { key, name: v.name.trim() || key, description: v.description.trim(), type: v.type, default_limit: limit, period: v.period, soft_limit: v.soft_limit },
  }
}

export function FeatureForm({
  mode,
  initial,
  submitLabel,
  pendingLabel,
  pending,
  error,
  errorTitle,
  cancelTo,
  onSubmit,
}: {
  mode: "create" | "edit"
  initial: FeatureFormValue
  submitLabel: string
  pendingLabel: string
  pending: boolean
  error?: { code: string; message: string }
  errorTitle: string
  cancelTo: string
  onSubmit: (f: ParsedFeature) => void
}) {
  const [v, setV] = useState(initial)
  const [problems, setProblems] = useState<string[]>([])
  const set = <K extends keyof FeatureFormValue>(key: K, value: FeatureFormValue[K]) => setV((prev) => ({ ...prev, [key]: value }))
  const isBoolean = v.type === "boolean"

  function changeType(type: FeatureType) {
    setV((prev) => {
      if (type !== "boolean") return { ...prev, type }
      // Starts included, as the engine's own dashboard does, and never unlimited.
      const untouched = prev.unlimited || prev.limit.trim() === "" || prev.limit.trim() === "0"
      return { ...prev, type, unlimited: false, limit: untouched ? "1" : prev.limit }
    })
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (pending) return
    const parsed = parseFeatureForm(v, mode)
    if (!parsed.ok) {
      setProblems(parsed.errors)
      return
    }
    setProblems([])
    onSubmit(parsed.value)
  }

  return (
    <form onSubmit={submit} className="flex max-w-2xl flex-col gap-4">
      <CommandAlert error={error} title={errorTitle} />
      {problems.length > 0 && (
        <div role="alert" className="flex flex-col gap-0.5 rounded-md border border-destructive/50 px-3 py-2 text-sm text-destructive">
          {problems.map((p) => (
            <span key={p}>{p}</span>
          ))}
        </div>
      )}
      {mode === "create" ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="feature-key">Key</Label>
          <Input id="feature-key" className="font-mono" autoComplete="off" spellCheck={false} value={v.key} onChange={(e) => set("key", e.target.value)} />
          <p className="text-xs text-muted-foreground">What code checks entitlements with. It cannot change later.</p>
        </div>
      ) : (
        <p className="text-sm">
          Key <span className="font-mono text-xs">{v.key}</span>, type {v.type}. Neither can change.
        </p>
      )}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="feature-name">Name</Label>
        <Input id="feature-name" value={v.name} onChange={(e) => set("name", e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="feature-description">Description</Label>
        <Textarea id="feature-description" value={v.description} onChange={(e) => set("description", e.target.value)} />
      </div>
      {mode === "create" && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="feature-type">Type</Label>
          <NativeSelect id="feature-type" value={v.type} onChange={(e) => changeType(e.target.value as FeatureType)}>
            <NativeSelectOption value="metered">Metered</NativeSelectOption>
            <NativeSelectOption value="seat">Seats</NativeSelectOption>
            <NativeSelectOption value="boolean">On or off</NativeSelectOption>
          </NativeSelect>
          <p className="text-xs text-muted-foreground">It cannot change later.</p>
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="feature-limit">Default limit</Label>
        <Input
          id="feature-limit"
          inputMode="numeric"
          className="w-40 text-right tabular-nums"
          disabled={v.unlimited && !isBoolean}
          value={v.unlimited && !isBoolean ? "" : v.limit}
          onChange={(e) => set("limit", e.target.value)}
        />
        {isBoolean ? (
          <p className="text-xs text-muted-foreground">1 or more includes the feature. 0 leaves it out.</p>
        ) : (
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={v.unlimited} onChange={(e) => set("unlimited", e.target.checked)} />
            Unlimited
          </label>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="feature-period">Resets</Label>
        <NativeSelect id="feature-period" value={v.period} onChange={(e) => set("period", e.target.value as Period)}>
          <NativeSelectOption value="monthly">Monthly</NativeSelectOption>
          <NativeSelectOption value="yearly">Yearly</NativeSelectOption>
          <NativeSelectOption value="none">Never</NativeSelectOption>
        </NativeSelect>
      </div>
      <label className="flex items-center gap-1.5 text-sm">
        <input type="checkbox" checked={v.soft_limit} onChange={(e) => set("soft_limit", e.target.checked)} />
        Soft limit: allow use past the limit and bill it as overage
      </label>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? pendingLabel : submitLabel}
        </Button>
        <PluginLink to={cancelTo} className="self-center text-sm underline">
          Cancel
        </PluginLink>
      </div>
    </form>
  )
}
