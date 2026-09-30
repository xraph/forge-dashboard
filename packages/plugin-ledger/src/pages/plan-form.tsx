import { useState } from "react"
import type { FormEvent } from "react"
import { PluginLink } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { NativeSelect, NativeSelectOption } from "@forge-go/dashboard-kit/components/native-select"
import { CommandAlert } from "@forge-go/dashboard-kit/components/query-boundary"
import { Textarea } from "@forge-go/dashboard-kit/components/textarea"
import { ProblemsAlert } from "../components/problems-alert"
import { PERIOD_LABEL, TYPE_LABEL } from "../lib/features"
import { currencyDigits, parseMajor, toMajorInput } from "../lib/money"
import type { FeatureType, Period, Plan, TierType } from "../types"

export interface FeatureRow {
  /** Kept from the stored plan, so a save does not give every feature a new id. */
  id?: string
  /** Kept from the stored plan: dropping it on save would unlink the feature from its catalog entry. */
  catalog_id?: string
  /** Kept for the same reason: plans.update replaces features wholesale, so what is not sent is wiped. */
  metadata?: Record<string, string>
  key: string
  name: string
  type: FeatureType
  limit: string
  unlimited: boolean
  period: Period
  soft_limit: boolean
}

export interface TierRow {
  feature_key: string
  type: TierType
  up_to: string
  unbounded: boolean
  unit: string
  flat: string
}

export interface PlanFormValue {
  name: string
  slug: string
  description: string
  currency: string
  trial_days: string
  base: string
  billing_period: "monthly" | "yearly"
  /** The stored price's id, kept so an edit does not mint a new one. Absent for a plan with no price. */
  pricing_id?: string
  features: FeatureRow[]
  tiers: TierRow[]
}

interface MoneyInput {
  amount: number
  currency: string
}

export interface ParsedPlan {
  name: string
  slug: string
  description: string
  currency: string
  trial_days: number
  features: {
    id?: string
    catalog_id?: string
    metadata?: Record<string, string>
    key: string
    name: string
    type: FeatureType
    limit: number
    period: Period
    soft_limit: boolean
  }[]
  /**
   * Absent when an edit leaves an unpriced plan unpriced: the operator never
   * touched the price, so none is sent.
   */
  pricing?: {
    id?: string
    base_amount: MoneyInput
    billing_period: "monthly" | "yearly"
    tiers: { feature_key: string; type: TierType; up_to: number; unit_amount: MoneyInput; flat_amount: MoneyInput; priority: number }[]
  }
}

export function emptyPlanForm(): PlanFormValue {
  return { name: "", slug: "", description: "", currency: "usd", trial_days: "0", base: "0", billing_period: "monthly", features: [], tiers: [] }
}

export function planToForm(p: Plan): PlanFormValue {
  const form: PlanFormValue = {
    name: p.name,
    slug: p.slug,
    description: p.description ?? "",
    currency: p.currency,
    trial_days: String(p.trial_days),
    base: toMajorInput(p.pricing?.base_amount.amount ?? 0, p.currency),
    billing_period: p.pricing?.billing_period === "yearly" ? "yearly" : "monthly",
    features: (p.features ?? []).map((f) => {
      const row: FeatureRow = {
        id: f.id,
        key: f.key,
        name: f.name,
        type: f.type,
        // An on-or-off feature is on only above zero, so a stored -1 is "off", not "unlimited".
        limit: f.limit === -1 ? (f.type === "boolean" ? "0" : "") : String(f.limit),
        unlimited: f.limit === -1 && f.type !== "boolean",
        period: f.period,
        soft_limit: f.soft_limit,
      }
      if (f.catalog_id) row.catalog_id = f.catalog_id
      if (f.metadata) row.metadata = f.metadata
      return row
    }),
    tiers: (p.pricing?.tiers ?? []).map((t) => ({
      feature_key: t.feature_key,
      type: t.type,
      // The engine reads any up_to of 0 or below as no ceiling (isUnbounded), and an import or the SDK can store 0.
      up_to: t.up_to <= 0 ? "" : String(t.up_to),
      unbounded: t.up_to <= 0,
      unit: toMajorInput(t.unit_amount.amount, p.currency),
      flat: toMajorInput(t.flat_amount.amount, p.currency),
    })),
  }
  if (p.pricing?.id) form.pricing_id = p.pricing.id
  return form
}

const WHOLE = /^\d+$/

/** A whole number the wire can carry exactly: a 20-digit entry is refused, never rounded. */
function wholeNumber(text: string, min = 0): number | undefined {
  const t = text.trim()
  if (!WHOLE.test(t)) return undefined
  const n = Number(t)
  return Number.isSafeInteger(n) && n >= min ? n : undefined
}

/**
 * Checks the form the way the contract will, so an operator hears every
 * problem at once rather than one refusal per round trip. The server stays
 * the authority: anything this lets through that it refuses still arrives
 * as a CommandAlert.
 */
export function parsePlanForm(v: PlanFormValue, mode: "create" | "edit"): { ok: true; value: ParsedPlan } | { ok: false; errors: string[] } {
  const errors: string[] = []
  const currency = v.currency.trim().toLowerCase()
  const code = currency.toUpperCase()
  const digits = currencyDigits(currency)
  const moneyRule = `an amount in ${code} with at most ${digits} decimal${digits === 1 ? "" : "s"}`
  const money = (text: string): MoneyInput | undefined => {
    const amount = parseMajor(text, currency)
    return amount === undefined ? undefined : { amount, currency }
  }

  if (v.name.trim() === "") errors.push("Name is required.")
  if (v.slug.trim() === "") errors.push("Slug is required.")
  if (mode === "create" && !/^[a-z]{3}$/.test(currency)) errors.push("Currency must be a three-letter code such as usd.")
  const trialDays = wholeNumber(v.trial_days)
  if (trialDays === undefined) errors.push("Trial days must be a whole number, 0 or more.")
  const base = money(v.base)
  if (!base) errors.push(`The base price must be ${moneyRule}.`)

  const seen = new Set<string>()
  const features = v.features.map((f, i) => {
    const n = i + 1
    const key = f.key.trim()
    if (key === "") errors.push(`Feature ${n}: the key is required.`)
    else if (seen.has(key)) errors.push(`Feature ${n}: the key ${key} is already used.`)
    seen.add(key)
    let limit = -1
    if (!(f.unlimited && f.type !== "boolean")) {
      const parsedLimit = wholeNumber(f.limit)
      if (parsedLimit === undefined) errors.push(`Feature ${n}: the limit must be a whole number, 0 or more, or unlimited.`)
      else limit = parsedLimit
    }
    const out: ParsedPlan["features"][number] = { key, name: f.name.trim() || key, type: f.type, limit, period: f.period, soft_limit: f.soft_limit }
    if (f.id) out.id = f.id
    if (f.catalog_id) out.catalog_id = f.catalog_id
    if (f.metadata) out.metadata = f.metadata
    return out
  })

  const priorities = new Map<string, number>()
  const tiers = v.tiers.map((t, i) => {
    const n = i + 1
    if (!seen.has(t.feature_key)) errors.push(`Tier ${n}: ${t.feature_key || "the feature"} is not one of this plan's features.`)
    let upTo = -1
    if (!t.unbounded) {
      const parsedUpTo = wholeNumber(t.up_to, 1)
      if (parsedUpTo === undefined) errors.push(`Tier ${n}: up to must be a whole number above 0, or no limit.`)
      else upTo = parsedUpTo
    }
    const unit = money(t.unit)
    const flat = money(t.flat)
    if (!unit) errors.push(`Tier ${n}: the unit price must be ${moneyRule}.`)
    if (!flat) errors.push(`Tier ${n}: the flat fee must be ${moneyRule}.`)
    const priority = priorities.get(t.feature_key) ?? 0
    priorities.set(t.feature_key, priority + 1)
    return { feature_key: t.feature_key, type: t.type, up_to: upTo, unit_amount: unit ?? { amount: 0, currency }, flat_amount: flat ?? { amount: 0, currency }, priority }
  })

  if (errors.length > 0) return { ok: false, errors }
  // An edit of a plan that never had a price stays unpriced until the
  // operator sets one: a zero base price with no tiers is "untouched".
  const priced =
    mode === "create" || v.pricing_id !== undefined || tiers.length > 0 || base!.amount > 0 || v.billing_period !== "monthly"
  const pricing: ParsedPlan["pricing"] = { base_amount: base!, billing_period: v.billing_period, tiers }
  if (v.pricing_id) pricing.id = v.pricing_id
  return {
    ok: true,
    value: {
      name: v.name.trim(),
      slug: v.slug.trim(),
      description: v.description.trim(),
      currency,
      trial_days: trialDays!,
      features,
      ...(priced ? { pricing } : {}),
    },
  }
}

const FEATURE_TYPES: { value: FeatureType; label: string }[] = (["metered", "seat", "boolean"] as const).map((value) => ({ value, label: TYPE_LABEL[value] }))
const PERIODS: { value: Period; label: string }[] = (["monthly", "yearly", "none"] as const).map((value) => ({ value, label: PERIOD_LABEL[value] }))
const TIER_TYPES: { value: TierType; label: string }[] = [
  { value: "graduated", label: "Graduated" },
  { value: "volume", label: "Volume" },
  { value: "flat", label: "Flat" },
]

export interface PlanFormProps {
  mode: "create" | "edit"
  initial: PlanFormValue
  submitLabel: string
  pendingLabel: string
  pending: boolean
  error?: { code: string; message: string }
  errorTitle: string
  cancelTo: string
  onSubmit: (plan: ParsedPlan) => void
}

/**
 * The plan editor shared by create and edit. Features and tiers are edited
 * as whole lists and sent whole, which is what plans.update's replace
 * semantics expect; a feature keeps its id so the engine does not mint new
 * ones on every save.
 */
export function PlanForm({ mode, initial, submitLabel, pendingLabel, pending, error, errorTitle, cancelTo, onSubmit }: PlanFormProps) {
  const [v, setV] = useState<PlanFormValue>(initial)
  const [problems, setProblems] = useState<string[]>([])
  const set = <K extends keyof PlanFormValue>(key: K, value: PlanFormValue[K]) => setV((prev) => ({ ...prev, [key]: value }))
  const setFeature = (i: number, patch: Partial<FeatureRow>) =>
    setV((prev) => ({ ...prev, features: prev.features.map((f, j) => (j === i ? { ...f, ...patch } : f)) }))
  const setTier = (i: number, patch: Partial<TierRow>) =>
    setV((prev) => ({ ...prev, tiers: prev.tiers.map((t, j) => (j === i ? { ...t, ...patch } : t)) }))

  function submit(event: FormEvent) {
    event.preventDefault()
    if (pending) return
    const parsed = parsePlanForm(v, mode)
    if (!parsed.ok) {
      setProblems(parsed.errors)
      return
    }
    setProblems([])
    onSubmit(parsed.value)
  }

  const featureKeys = v.features.map((f) => f.key.trim()).filter((k) => k !== "")

  return (
    <form onSubmit={submit} className="flex max-w-4xl flex-col gap-6">
      <CommandAlert error={error} title={errorTitle} />
      <ProblemsAlert heading="Fix these before saving" problems={problems} />

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-base font-medium">Plan</legend>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="plan-name">Name</Label>
          <Input id="plan-name" value={v.name} onChange={(e) => set("name", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="plan-slug">Slug</Label>
          <Input id="plan-slug" className="font-mono" autoComplete="off" spellCheck={false} value={v.slug} onChange={(e) => set("slug", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="plan-description">Description</Label>
          <Textarea id="plan-description" value={v.description} onChange={(e) => set("description", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="plan-currency">Currency</Label>
          <Input
            id="plan-currency"
            className="font-mono uppercase"
            disabled={mode === "edit"}
            value={v.currency}
            onChange={(e) => set("currency", e.target.value)}
          />
          {mode === "edit" && <p className="text-xs text-muted-foreground">A plan's currency cannot change once it exists.</p>}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="plan-trial">Trial days</Label>
          <Input id="plan-trial" inputMode="numeric" className="tabular-nums" value={v.trial_days} onChange={(e) => set("trial_days", e.target.value)} />
        </div>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-base font-medium">Price</legend>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="plan-base">Base price</Label>
          <Input id="plan-base" inputMode="decimal" className="text-right tabular-nums" value={v.base} onChange={(e) => set("base", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="plan-period">Billed</Label>
          <NativeSelect id="plan-period" value={v.billing_period} onChange={(e) => set("billing_period", e.target.value as "monthly" | "yearly")}>
            <NativeSelectOption value="monthly">Monthly</NativeSelectOption>
            <NativeSelectOption value="yearly">Yearly</NativeSelectOption>
          </NativeSelect>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-base font-medium">Features</legend>
        {v.features.length === 0 && <p className="text-sm text-muted-foreground">No features yet. A plan with none grants nothing beyond its base price.</p>}
        {v.features.map((f, i) => {
          const n = i + 1
          return (
            <div key={i} className="grid items-end gap-2 rounded-md border p-3 sm:grid-cols-[1fr_1fr_8rem_8rem_8rem_auto]">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`feature-${n}-key`}>Feature {n} key</Label>
                <Input id={`feature-${n}-key`} className="font-mono" value={f.key} onChange={(e) => setFeature(i, { key: e.target.value })} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`feature-${n}-name`}>Feature {n} name</Label>
                <Input id={`feature-${n}-name`} value={f.name} onChange={(e) => setFeature(i, { name: e.target.value })} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`feature-${n}-type`}>Feature {n} type</Label>
                <NativeSelect id={`feature-${n}-type`} value={f.type} onChange={(e) => {
                    const type = e.target.value as FeatureType
                    // A fresh row's limit is 0 and an unlimited one is -1, and both read as "off" for a boolean feature.
                    const startOn = type === "boolean" && (f.unlimited || f.limit.trim() === "" || f.limit.trim() === "0")
                    setFeature(i, startOn ? { type, limit: "1", unlimited: false } : { type })
                  }}>
                  {FEATURE_TYPES.map((t) => (
                    <NativeSelectOption key={t.value} value={t.value}>
                      {t.label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`feature-${n}-limit`}>Feature {n} limit</Label>
                <Input
                  id={`feature-${n}-limit`}
                  inputMode="numeric"
                  className="text-right tabular-nums"
                  disabled={f.unlimited && f.type !== "boolean"}
                  value={f.unlimited && f.type !== "boolean" ? "" : f.limit}
                  onChange={(e) => setFeature(i, { limit: e.target.value })}
                />
                {f.type === "boolean" && <p className="text-xs text-muted-foreground">1 means on, 0 means off</p>}
                {f.type !== "boolean" && (
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <input type="checkbox" aria-label={`Feature ${n}: unlimited`} checked={f.unlimited} onChange={(e) => setFeature(i, { unlimited: e.target.checked })} />
                    Unlimited
                  </label>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`feature-${n}-period`}>Feature {n} resets</Label>
                <NativeSelect id={`feature-${n}-period`} value={f.period} onChange={(e) => setFeature(i, { period: e.target.value as Period })}>
                  {PERIODS.map((p) => (
                    <NativeSelectOption key={p.value} value={p.value}>
                      {p.label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <input type="checkbox" aria-label={`Feature ${n}: soft limit`} checked={f.soft_limit} onChange={(e) => setFeature(i, { soft_limit: e.target.checked })} />
                  Soft limit
                </label>
              </div>
              <Button type="button" variant="ghost" size="sm" aria-label={`Remove feature ${n}`} onClick={() => set("features", v.features.filter((_, j) => j !== i))}>
                Remove
              </Button>
            </div>
          )
        })}
        <div>
          <Button
            type="button"
            variant="outline"
            onClick={() => set("features", [...v.features, { key: "", name: "", type: "metered", limit: "0", unlimited: false, period: "monthly", soft_limit: false }])}
          >
            Add feature
          </Button>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-base font-medium">Usage pricing</legend>
        <p className="text-sm text-muted-foreground">
          Tiers price a feature's usage beyond the base price. A tier with no upper bound catches everything above the one before it.
        </p>
        {v.tiers.map((t, i) => {
          const n = i + 1
          return (
            <div key={i} className="grid items-end gap-2 rounded-md border p-3 sm:grid-cols-[1fr_8rem_8rem_8rem_8rem_auto]">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`tier-${n}-feature`}>Tier {n} feature</Label>
                <NativeSelect id={`tier-${n}-feature`} value={t.feature_key} onChange={(e) => setTier(i, { feature_key: e.target.value })}>
                  <NativeSelectOption value="">Choose a feature</NativeSelectOption>
                  {featureKeys.map((k) => (
                    <NativeSelectOption key={k} value={k}>
                      {k}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`tier-${n}-type`}>Tier {n} type</Label>
                <NativeSelect id={`tier-${n}-type`} value={t.type} onChange={(e) => setTier(i, { type: e.target.value as TierType })}>
                  {TIER_TYPES.map((x) => (
                    <NativeSelectOption key={x.value} value={x.value}>
                      {x.label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`tier-${n}-upto`}>Tier {n} up to</Label>
                <Input
                  id={`tier-${n}-upto`}
                  inputMode="numeric"
                  className="text-right tabular-nums"
                  disabled={t.unbounded}
                  value={t.unbounded ? "" : t.up_to}
                  onChange={(e) => setTier(i, { up_to: e.target.value })}
                />
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <input type="checkbox" aria-label={`Tier ${n}: no limit`} checked={t.unbounded} onChange={(e) => setTier(i, { unbounded: e.target.checked })} />
                  No limit
                </label>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`tier-${n}-unit`}>Tier {n} unit price</Label>
                <Input id={`tier-${n}-unit`} inputMode="decimal" className="text-right tabular-nums" value={t.unit} onChange={(e) => setTier(i, { unit: e.target.value })} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`tier-${n}-flat`}>Tier {n} flat fee</Label>
                <Input id={`tier-${n}-flat`} inputMode="decimal" className="text-right tabular-nums" value={t.flat} onChange={(e) => setTier(i, { flat: e.target.value })} />
              </div>
              <Button type="button" variant="ghost" size="sm" aria-label={`Remove tier ${n}`} onClick={() => set("tiers", v.tiers.filter((_, j) => j !== i))}>
                Remove
              </Button>
            </div>
          )
        })}
        <div>
          <Button
            type="button"
            variant="outline"
            disabled={featureKeys.length === 0}
            onClick={() => set("tiers", [...v.tiers, { feature_key: featureKeys[0] ?? "", type: "graduated", up_to: "", unbounded: true, unit: "0", flat: "0" }])}
          >
            Add tier
          </Button>
        </div>
      </fieldset>

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
