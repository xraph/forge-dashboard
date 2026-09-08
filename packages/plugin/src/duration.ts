const UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
}

/**
 * Reads a Go duration string into milliseconds.
 *
 * `meta.cacheControl.staleTime` is produced by Go's `time.Duration.String()`,
 * so it looks like "30s", "1m", "500ms" or "1h30m". Only those four units
 * appear in a cache hint; nanoseconds and microseconds are not modelled
 * because a sub-millisecond stale time is not a thing a dashboard can act on.
 *
 * Anything unreadable returns 0, which the store treats as "always stale".
 * That is today's behaviour for every query, so a contributor sending a
 * malformed hint gets the old dashboard rather than a broken read. Throwing
 * here would turn a server typo into a page that will not render.
 *
 * The unit alternation puts `ms` before `s` and `m` so "500ms" is not read as
 * 500 minutes followed by a stray "s".
 */
export function parseGoDuration(value: string | undefined): number {
  if (!value) return 0

  const pattern = /(\d+(?:\.\d+)?)(ms|s|m|h)/g
  let total = 0
  let matched = 0
  let consumed = 0

  for (const match of value.matchAll(pattern)) {
    total += Number(match[1]) * UNIT_MS[match[2]]
    matched += 1
    consumed += match[0].length
  }

  // Every character has to belong to a unit-suffixed number. "30" alone and
  // "30s later" both fail here, so a value that is only partly a duration is
  // rejected rather than half-read.
  if (matched === 0 || consumed !== value.length) return 0

  return total
}
