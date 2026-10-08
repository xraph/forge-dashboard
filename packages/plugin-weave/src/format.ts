const grouped = new Intl.NumberFormat("en-US")
const encoder = new TextEncoder()

export function formatCount(n: number): string {
  return grouped.format(n)
}

/** An exact byte count: "4,812 B". */
export function formatBytes(n: number): string {
  return `${grouped.format(n)} B`
}

/** A score as the retrieval page shows it: three decimals, no colour. */
export function formatScore(n: number): string {
  return n.toFixed(3)
}

export function formatMs(ms: number): string {
  return ms < 10 ? `${ms.toFixed(1)} ms` : `${grouped.format(Math.round(ms))} ms`
}

export function plural(n: number, one: string, many: string): string {
  return `${grouped.format(n)} ${n === 1 ? one : many}`
}

/** "47 min", "3 h", "2 d": whole units, rounded down, never under a minute. */
export function formatAge(seconds: number): string {
  if (seconds < 3600) return `${Math.max(1, Math.floor(seconds / 60))} min`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h`
  return `${Math.floor(seconds / 86400)} d`
}

export function ageSeconds(iso: string, now: number = Date.now()): number {
  return Math.max(0, Math.floor((now - Date.parse(iso)) / 1000))
}

/**
 * Whether a timestamp names a real moment. An orphaned retrieval hit carries
 * Go's zero time, "0001-01-01T00:00:00Z", which must never render as a date.
 */
export function isRealTime(iso: string | null | undefined): iso is string {
  return typeof iso === "string" && iso !== "" && !iso.startsWith("0001-01-01")
}

export function utf8Length(text: string): number {
  return encoder.encode(text).length
}
