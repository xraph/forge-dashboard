/**
 * A wait or a latency, the way an operator reads one: "850 ms", "5s", "2m",
 * "1h 5m". Precision drops as the number grows, because the difference
 * between 3601 and 3605 seconds is never what anyone is looking for.
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "–"
  if (ms < 1000) return `${Math.round(ms)} ms`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return s % 60 === 0 || m >= 10 ? `${m}m` : `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  if (h < 24) return m % 60 === 0 ? `${h}h` : `${h}h ${m % 60}m`
  const d = Math.floor(h / 24)
  return h % 24 === 0 ? `${d}d` : `${d}d ${h % 24}h`
}

/** The gap between two instants, as formatDuration reads it. */
export function between(from: string, to: string): string {
  return formatDuration(Date.parse(to) - Date.parse(from))
}

/**
 * A status code, or what its absence means. A 0 is not an HTTP status: the
 * attempt got no response at all, and the error says why.
 */
export function describeStatus(code: number): string {
  return code === 0 ? "No response" : String(code)
}
