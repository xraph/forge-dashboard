/** One decimal and a percent sign, or null when nothing was measured. */
export function formatPercent(v: number | null | undefined): string | null {
  return v == null ? null : `${v.toFixed(1)}%`
}

/** Milliseconds below a second, seconds from there up, or null. */
export function formatMs(v: number | null | undefined): string | null {
  if (v == null) return null
  return v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${v.toFixed(1)} ms`
}

export function formatCount(n: number): string {
  return n.toLocaleString("en-US")
}

/** The two largest units: "3d 4h", "2h 5m", "45s". */
export function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${seconds % 60}s`
  return `${seconds}s`
}
