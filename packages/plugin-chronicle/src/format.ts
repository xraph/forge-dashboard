const grouped = new Intl.NumberFormat("en-US")

/** A sequence number or count for a person to read: 12,431. */
export function formatSeq(n: number): string {
  return grouped.format(n)
}

/** The first 12 characters of a hash. The full value goes in a title attribute. */
export function shortHash(h: string): string {
  return h.length > 12 ? h.slice(0, 12) : h
}

/**
 * A Go duration as a person reads it. Only whole hours are rewritten, since
 * that is how retention policies are written ("720h"); anything else is shown
 * exactly as the server sent it.
 */
export function durationLabel(goDuration: string): string {
  const m = /^(\d+)h0m0s$/.exec(goDuration)
  if (!m) return goDuration
  const hours = Number(m[1])
  if (hours % 24 === 0) {
    const days = hours / 24
    return days === 1 ? "1 day" : `${days} days`
  }
  return hours === 1 ? "1 hour" : `${hours} hours`
}
