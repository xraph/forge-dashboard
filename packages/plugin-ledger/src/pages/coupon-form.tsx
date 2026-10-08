import { useRef, useState } from "react"
import type { FormEvent } from "react"
import { PluginLink } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import {
  NativeSelect,
  NativeSelectOption,
} from "@forge-go/dashboard-kit/components/native-select"
import { CommandAlert } from "@forge-go/dashboard-kit/components/query-boundary"
import { ProblemsAlert } from "../components/problems-alert"
import { describeDiscount } from "../lib/coupons"
import { toLocalInput, toRFC3339 } from "../lib/datetime"
import { currencyDigits, parseMajor, toMajorInput } from "../lib/money"
import type { Coupon, CouponType } from "../types"

export interface CouponFormValue {
  code: string
  name: string
  type: CouponType
  percentage: string
  amount: string
  currency: string
  max: string
  valid_from: string
  valid_until: string
}

export function emptyCouponForm(): CouponFormValue {
  return {
    code: "",
    name: "",
    type: "percentage",
    percentage: "",
    amount: "",
    currency: "",
    max: "0",
    valid_from: "",
    valid_until: "",
  }
}

export function couponToForm(c: Coupon): CouponFormValue {
  return {
    code: c.code,
    name: c.name,
    type: c.type,
    percentage: c.percentage !== undefined ? String(c.percentage) : "",
    amount: toMajorInput(c.amount.amount, c.currency),
    currency: c.currency,
    // The engine reads a cap of 0 or less as no cap. The form only takes 0 or more, so a stored -1 shows as 0 and an edit is not refused over it.
    max: String(Math.max(0, c.max_redemptions)),
    valid_from: toLocalInput(c.valid_from),
    valid_until: toLocalInput(c.valid_until),
  }
}

type Result<T> = { ok: true; value: T } | { ok: false; errors: string[] }

function windowErrors(v: CouponFormValue, errors: string[]) {
  const from = toRFC3339(v.valid_from)
  const until = toRFC3339(v.valid_until)
  if (v.valid_from !== "" && from === undefined)
    errors.push("Valid from is not a date and time.")
  if (v.valid_until !== "" && until === undefined)
    errors.push("Valid until is not a date and time.")
  if (from && until && Date.parse(until) < Date.parse(from))
    errors.push("Valid until is before valid from.")
  return { from, until }
}

function maxErrors(v: CouponFormValue, errors: string[]): number {
  const text = v.max.trim() === "" ? "0" : v.max.trim()
  // Past the safe integers the number is no longer what was typed, and Go's int would refuse it anyway.
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(Number(text))) {
    errors.push("Max redemptions must be a whole number, 0 for no cap.")
    return 0
  }
  return Number(text)
}

function amountError(currency: string): string {
  const digits = currencyDigits(currency)
  const code = currency.toUpperCase()
  if (digits === 0)
    return `The amount must be a whole number of ${code}, which has no decimals.`
  return `The amount must be an amount in ${code} with at most ${digits} decimal${digits === 1 ? "" : "s"}.`
}

/**
 * coupons.create's payload. The window keys are sent only when set. The code
 * keeps its case because the engine looks codes up exactly; the currency is
 * lowercased, as the engine does. A percentage coupon may have no currency
 * (sent as ""), which the engine applies to a plan in any currency; an amount
 * coupon always needs one, because its money is in it.
 */
export function createCouponPayload(
  v: CouponFormValue
): Result<Record<string, unknown>> {
  const errors: string[] = []
  const code = v.code.trim()
  const currency = v.currency.trim().toLowerCase()
  if (code === "") errors.push("Code is required.")
  const currencyOk = /^[a-z]{3}$/.test(currency)
  if (!currencyOk && !(v.type === "percentage" && currency === "")) {
    if (v.type === "amount")
      errors.push(
        currency === ""
          ? "An amount coupon needs a currency, such as usd."
          : "Currency must be a three-letter code such as usd."
      )
    else
      errors.push(
        "Currency must be a three-letter code such as usd, or empty for any currency."
      )
  }
  const value: Record<string, unknown> = {
    code,
    name: v.name.trim(),
    type: v.type,
  }
  if (v.type === "percentage") {
    const p = v.percentage.trim()
    if (!/^\d+$/.test(p) || Number(p) > 100)
      errors.push("The percentage must be a whole number from 0 to 100.")
    else value.percentage = Number(p)
  } else {
    const amount = parseMajor(v.amount, currency)
    // With no valid currency there is no scale to read the amount in, and the currency error above already says so.
    if (amount !== undefined) value.amount = { amount, currency }
    else if (currencyOk) errors.push(amountError(currency))
  }
  value.currency = currency
  value.max_redemptions = maxErrors(v, errors)
  const { from, until } = windowErrors(v, errors)
  if (from) value.valid_from = from
  if (until) value.valid_until = until
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value }
}

/**
 * coupons.update's payload, which is omit-versus-null: a key left out leaves
 * that field alone, and `null` on a validity bound clears it (the engine's
 * Nullable). So a bound the operator did not touch is left out (sending it
 * back could shift it by the seconds the input cannot show), a bound they
 * emptied is sent as null, and a bound that was never set is never sent as
 * null. Only name, max_redemptions and the window can change: the engine
 * refuses a code, type, value or currency that differs, and metadata is left
 * out so the engine keeps it.
 */
export function updateCouponPayload(
  v: CouponFormValue,
  original: Coupon
): Result<Record<string, unknown>> {
  const errors: string[] = []
  const value: Record<string, unknown> = { id: original.id }
  // The engine trims a name it is sent, so a stored name that only differs by that whitespace is not a change.
  if (v.name !== original.name && v.name.trim() !== original.name)
    value.name = v.name.trim()
  const max = maxErrors(v, errors)
  if (max !== Math.max(0, original.max_redemptions)) value.max_redemptions = max
  const { from, until } = windowErrors(v, errors)
  for (const [field, text, parsed] of [
    ["valid_from", v.valid_from, from],
    ["valid_until", v.valid_until, until],
  ] as const) {
    const stored = original[field]
    if (text === toLocalInput(stored)) continue
    if (text === "") {
      if (stored) value[field] = null
    } else if (parsed) {
      value[field] = parsed
    }
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value }
}

export function CouponForm({
  mode,
  initial,
  original,
  submitLabel,
  pendingLabel,
  pending,
  error,
  errorTitle,
  cancelTo,
  onSubmit,
}: {
  mode: "create" | "edit"
  initial: CouponFormValue
  original?: Coupon
  submitLabel: string
  pendingLabel: string
  pending: boolean
  error?: { code: string; message: string }
  errorTitle: string
  cancelTo: string
  onSubmit: (payload: Record<string, unknown>) => void
}) {
  const [v, setV] = useState(initial)
  const [problems, setProblems] = useState<string[]>([])
  const set = <K extends keyof CouponFormValue>(
    key: K,
    value: CouponFormValue[K]
  ) => setV((prev) => ({ ...prev, [key]: value }))
  // Whether the operator typed a currency themselves, so a currency this form filled in is not left restricting a percentage coupon.
  const currencyTyped = useRef(initial.currency !== "")

  function changeType(type: CouponType) {
    setV((prev) => {
      if (type === "amount")
        return {
          ...prev,
          type,
          currency: prev.currency.trim() === "" ? "usd" : prev.currency,
        }
      return {
        ...prev,
        type,
        currency: currencyTyped.current ? prev.currency : "",
      }
    })
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (pending) return
    const out =
      mode === "create" || !original
        ? createCouponPayload(v)
        : updateCouponPayload(v, original)
    if (!out.ok) {
      setProblems(out.errors)
      return
    }
    setProblems([])
    onSubmit(out.value)
  }

  return (
    <form onSubmit={submit} className="flex max-w-2xl flex-col gap-4">
      <CommandAlert error={error} title={errorTitle} />
      <ProblemsAlert problems={problems} />
      {mode === "create" ? (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="coupon-code">Code</Label>
            <Input
              id="coupon-code"
              aria-describedby="coupon-code-help"
              className="font-mono"
              autoComplete="off"
              spellCheck={false}
              value={v.code}
              onChange={(e) => set("code", e.target.value)}
            />
            <p id="coupon-code-help" className="text-xs text-muted-foreground">
              Unique within this app. Codes are matched exactly, so Launch and
              LAUNCH are two coupons.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="coupon-type">Type</Label>
              <NativeSelect
                id="coupon-type"
                value={v.type}
                onChange={(e) => changeType(e.target.value as CouponType)}
              >
                <NativeSelectOption value="percentage">
                  Percentage off
                </NativeSelectOption>
                <NativeSelectOption value="amount">
                  Amount off
                </NativeSelectOption>
              </NativeSelect>
            </div>
            {v.type === "percentage" ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="coupon-percentage">Percentage</Label>
                <Input
                  id="coupon-percentage"
                  inputMode="numeric"
                  className="text-right tabular-nums"
                  value={v.percentage}
                  onChange={(e) => set("percentage", e.target.value)}
                />
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="coupon-amount">Amount</Label>
                <Input
                  id="coupon-amount"
                  inputMode="decimal"
                  className="text-right tabular-nums"
                  value={v.amount}
                  onChange={(e) => set("amount", e.target.value)}
                />
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="coupon-currency">Currency</Label>
              <Input
                id="coupon-currency"
                aria-describedby="coupon-currency-help"
                className="font-mono uppercase"
                placeholder={
                  v.type === "percentage" ? "Any currency" : undefined
                }
                value={v.currency}
                onChange={(e) => {
                  currencyTyped.current = true
                  set("currency", e.target.value)
                }}
              />
            </div>
          </div>
          <p
            id="coupon-currency-help"
            className="text-xs text-muted-foreground"
          >
            {v.type === "percentage"
              ? "Leave empty and the coupon applies to a plan in any currency, or enter one currency to limit it to plans billed in it."
              : "The coupon can only be applied to plans billed in this currency."}{" "}
            The code, type, discount and currency cannot change after you create
            the coupon.
          </p>
        </>
      ) : (
        original && (
          <p className="text-sm">
            <span className="font-mono text-xs">{original.code}</span> gives{" "}
            {describeDiscount(original)} in{" "}
            {original.currency === ""
              ? "any currency"
              : original.currency.toUpperCase()}
            . The code, the discount and the currency cannot change once a
            coupon exists, because applied coupons are priced from them on every
            future invoice.
          </p>
        )
      )}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="coupon-name">Name</Label>
        <Input
          id="coupon-name"
          value={v.name}
          onChange={(e) => set("name", e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="coupon-max">Max redemptions</Label>
        <Input
          id="coupon-max"
          aria-describedby="coupon-max-help"
          inputMode="numeric"
          className="w-40 text-right tabular-nums"
          value={v.max}
          onChange={(e) => set("max", e.target.value)}
        />
        <p id="coupon-max-help" className="text-xs text-muted-foreground">
          0 means no cap.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="coupon-from">Valid from</Label>
          <Input
            id="coupon-from"
            aria-describedby="coupon-window-help"
            type="datetime-local"
            value={v.valid_from}
            onChange={(e) => set("valid_from", e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="coupon-until">Valid until</Label>
          <Input
            id="coupon-until"
            aria-describedby="coupon-window-help"
            type="datetime-local"
            value={v.valid_until}
            onChange={(e) => set("valid_until", e.target.value)}
          />
        </div>
      </div>
      <p id="coupon-window-help" className="text-xs text-muted-foreground">
        Times are in your own time zone. Leave a bound empty for no limit on
        that side.
      </p>
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
