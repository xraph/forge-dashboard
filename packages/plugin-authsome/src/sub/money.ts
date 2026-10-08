export function currencyDivisor(currency: string): number {
  try {
    const digits = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "USD",
    }).resolvedOptions().maximumFractionDigits
    return 10 ** (digits ?? 2)
  } catch {
    return 100
  }
}

export function formatMinorMoney(amount: number, currency: string): string {
  const code = currency || "USD"
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code,
    }).format(amount / currencyDivisor(code))
  } catch {
    return `${(amount / 100).toFixed(2)} ${code.toUpperCase()}`
  }
}
