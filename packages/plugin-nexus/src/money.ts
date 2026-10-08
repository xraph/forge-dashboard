const decimal = /^-?\d+(?:\.\d+)?$/

function parts(value: string) {
  if (!decimal.test(value)) throw new Error("Invalid decimal amount")
  const negative = value.startsWith("-")
  const [whole, fraction = ""] = (negative ? value.slice(1) : value).split(".")
  return { negative, whole: whole.replace(/^0+(?=\d)/, ""), fraction }
}

export function moneyParts(value: string) {
  const { negative, whole, fraction } = parts(value)
  const sign = negative ? "-" : ""
  return {
    main: `${sign}$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction.padEnd(2, "0").slice(0, 2)}`,
    tail: fraction.slice(2),
    exact: `${sign}$${whole}${fraction ? `.${fraction}` : ""}`,
  }
}

function aligned(left: string, right: string): [bigint, bigint] {
  const a = parts(left),
    b = parts(right)
  const scale = Math.max(a.fraction.length, b.fraction.length)
  return [a, b].map((p) =>
    BigInt(`${p.negative ? "-" : ""}${p.whole}${p.fraction.padEnd(scale, "0")}`)
  ) as [bigint, bigint]
}

export function compareMoney(left: string, right: string): -1 | 0 | 1 {
  const [a, b] = aligned(left, right)
  return a < b ? -1 : a > b ? 1 : 0
}

export function sharePercent(amount: string, total: string): string | null {
  const [a, b] = aligned(amount, total)
  if (b <= 0n) return null
  const scaled = a <= 0n ? 0n : a >= b ? 10000n : (a * 10000n) / b
  const text = scaled.toString().padStart(3, "0")
  return `${text.slice(0, -2)}.${text.slice(-2)}`.replace(/\.?0+$/, "")
}

export function validBudget(value: string): boolean {
  return /^\d+(?:\.\d+)?$/.test(value)
}
