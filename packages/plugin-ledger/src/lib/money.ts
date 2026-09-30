import type { Money } from "../types"

/**
 * Money in this plugin is always minor units, as the contract sends it: 4999
 * is $49.99, 500 is ¥500, 1500 is 1.500 KWD. The scale comes from the
 * currency, never from a hardcoded 100, which is the mistake that prints ¥5.00
 * for five hundred yen.
 */

/** How many minor units a currency's major unit holds: USD 2, JPY 0, KWD 3. */
export function currencyDigits(currency: string): number {
  try {
    return (
      new Intl.NumberFormat("en", { style: "currency", currency: currency.toUpperCase() }).resolvedOptions()
        .maximumFractionDigits ?? 2
    )
  } catch {
    return 2
  }
}

/** Minor units formatted in the operator's locale. */
export function formatMinor(amount: number, currency: string): string {
  const code = (currency || "usd").toUpperCase()
  const digits = currencyDigits(code)
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(amount / 10 ** digits)
  } catch {
    return `${(amount / 10 ** digits).toFixed(digits)} ${code}`
  }
}

export function formatMoney(m: Money): string {
  return formatMinor(m.amount, m.currency)
}

/**
 * What an operator typed, "49.99", as minor units, 4999. Undefined for
 * anything it cannot represent exactly: a negative number, exponent
 * notation, more decimals than the currency has, or a value past the safe
 * integer range. It never rounds: a price that silently became a different
 * price is the worst thing a billing form can do.
 */
export function parseMajor(input: string, currency: string): number | undefined {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(input.trim())
  if (!match) return undefined
  const digits = currencyDigits(currency)
  const whole = match[1]
  const fraction = match[2] ?? ""
  if (fraction.length > digits) return undefined
  const minor = Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, "0") || "0")
  return Number.isSafeInteger(minor) ? minor : undefined
}

/** Minor units as the text a major-unit input shows: 4999 is "49.99". */
export function toMajorInput(amount: number, currency: string): string {
  const digits = currencyDigits(currency)
  if (digits === 0) return String(amount)
  const sign = amount < 0 ? "-" : ""
  const abs = Math.abs(amount)
  const scale = 10 ** digits
  return `${sign}${Math.floor(abs / scale)}.${String(abs % scale).padStart(digits, "0")}`
}
