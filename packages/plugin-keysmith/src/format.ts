import type {
  Environment,
  KeyState,
  PolicyDetail,
  RotationItem,
  RotationReason,
  UsageBucket,
  UsagePeriod,
} from "./types"

/**
 * A key as a person may see it: prefix, environment, then only the hint.
 * The raw key is never on the wire, so this is all there is to show.
 */
export function maskedKey(k: {
  prefix: string
  environment: string
  hint: string
}): string {
  return `${k.prefix}_${k.environment}_…${k.hint}`
}

/**
 * Either key of a rotation, masked like `maskedKey`. A key that no longer
 * exists has no prefix to show, so only the hint is left. A record written
 * before hints existed has neither, and says so.
 */
export function rotationMasked(
  item: Pick<RotationItem, "prefix" | "environment" | "oldHint" | "newHint">,
  which: "old" | "new"
): string {
  const hint = which === "old" ? item.oldHint : item.newHint
  if (hint === "") return "(no hint)"
  if (item.prefix === null || item.environment === null) return `…${hint}`
  return maskedKey({ prefix: item.prefix, environment: item.environment, hint })
}

/** The detail page for one key. The id is encoded so a stray "/" cannot change the route. */
export function keyPath(id: string): string {
  return `/keys/${encodeURIComponent(id)}`
}

/** The page for one policy. Encoded for the same reason as keyPath. */
export function policyPath(id: string): string {
  return `/policies/${encodeURIComponent(id)}`
}

export const STATE_LABEL: Record<KeyState, string> = {
  active: "Active",
  suspended: "Suspended",
  revoked: "Revoked",
  expired: "Expired",
}

/** The states a list can be filtered on. The engine never assigns "rotated". */
export const STATES: { value: KeyState; label: string }[] = [
  { value: "active", label: STATE_LABEL.active },
  { value: "suspended", label: STATE_LABEL.suspended },
  { value: "revoked", label: STATE_LABEL.revoked },
  { value: "expired", label: STATE_LABEL.expired },
]

export const REASON_LABEL: Record<RotationReason, string> = {
  manual: "Manual",
  compromise: "Compromise",
  policy: "Policy",
  scheduled: "Scheduled",
}

/** The reasons a rotation list can be filtered on: every one the contract accepts. */
export const ROTATION_REASONS: { value: RotationReason; label: string }[] = [
  { value: "manual", label: REASON_LABEL.manual },
  { value: "compromise", label: REASON_LABEL.compromise },
  { value: "policy", label: REASON_LABEL.policy },
  { value: "scheduled", label: REASON_LABEL.scheduled },
]

export const ENVIRONMENTS: { value: Environment; label: string }[] = [
  { value: "live", label: "Live" },
  { value: "test", label: "Test" },
  { value: "staging", label: "Staging" },
]

/**
 * A length of time as people say it: the largest unit that divides the
 * seconds exactly, so 90 days stays "90 days" and 25 hours does not become
 * "1 day". Never rounds.
 *
 * `largest` caps the unit, for a value people already know by another name:
 * the default grace is "24 hours" everywhere it is mentioned, not "1 day".
 */
export function formatDuration(
  seconds: number,
  largest: "day" | "hour" | "minute" = "day"
): string {
  const all: [number, string][] = [
    [86400, "day"],
    [3600, "hour"],
    [60, "minute"],
  ]
  const units = all.slice(all.findIndex(([, name]) => name === largest))
  for (const [size, name] of units) {
    if (seconds !== 0 && seconds % size === 0) {
      const n = seconds / size
      return `${n} ${name}${n === 1 ? "" : "s"}`
    }
  }
  return `${seconds} ${seconds === 1 ? "second" : "seconds"}`
}

export type DurationUnit = "seconds" | "minutes" | "hours" | "days"

const UNIT_SECONDS: Record<DurationUnit, number> = {
  seconds: 1,
  minutes: 60,
  hours: 3600,
  days: 86400,
}

/**
 * Seconds as a form shows them: a whole number and one of the units the form
 * offers. The largest offered unit that divides exactly wins, so 86400 reads
 * "1 day" and 61 seconds stays "61 seconds". Never rounds.
 *
 * Unset (null) is a blank value in the last unit offered, the one a person
 * most likely types in. Zero is "0" in the smallest unit offered. When no
 * offered unit divides exactly (90 minutes against hours and days), this
 * answers the exact seconds in "seconds", which a form whose list lacks
 * seconds has to offer for that value rather than round it away.
 */
export function splitDuration(
  seconds: number | null,
  units: DurationUnit[]
): { value: string; unit: DurationUnit } {
  if (seconds === null) {
    return { value: "", unit: units[units.length - 1] ?? "seconds" }
  }
  const bySize = [...units].sort((a, b) => UNIT_SECONDS[b] - UNIT_SECONDS[a])
  if (seconds === 0) {
    return { value: "0", unit: bySize[bySize.length - 1] ?? "seconds" }
  }
  for (const unit of bySize) {
    if (seconds % UNIT_SECONDS[unit] === 0) {
      return { value: String(seconds / UNIT_SECONDS[unit]), unit }
    }
  }
  return { value: String(seconds), unit: "seconds" }
}

/**
 * What a duration field holds, in seconds. Blank is null (unset). Anything
 * that is not a whole non-negative number, or that overflows a safe integer,
 * is NaN so the form can refuse it with the server's wording.
 */
export function toSeconds(value: string, unit: DurationUnit): number | null {
  const trimmed = value.trim()
  if (trimmed === "") return null
  if (!/^\d+$/.test(trimmed)) return NaN
  const seconds = Number(trimmed) * UNIT_SECONDS[unit]
  return Number.isSafeInteger(seconds) ? seconds : NaN
}

/**
 * A rate limit as people say it: "100 per 1 minute". Null when the policy sets
 * none (the engine reads 0 as unset too). A limit stored with no window, which
 * the contract now refuses but an older row can hold, says so.
 */
export function formatRateLimit(
  p: Pick<PolicyDetail, "rateLimit" | "rateLimitWindowSeconds">
): string | null {
  if (!p.rateLimit) return null
  if (!p.rateLimitWindowSeconds) return `${p.rateLimit} with no window`
  return `${p.rateLimit} per ${formatDuration(p.rateLimitWindowSeconds)}`
}

/**
 * The ranges the Usage page offers. Each one ends with the bucket now falls
 * in, so the current hour, day or month is always the last column.
 */
export interface UsageRange {
  id: string
  label: string
  period: UsagePeriod
  hours?: number
  days?: number
  months?: number
}

export const USAGE_RANGES = [
  { id: "24h", label: "24 hours", period: "hourly", hours: 24 },
  { id: "7d", label: "7 days", period: "daily", days: 7 },
  { id: "30d", label: "30 days", period: "daily", days: 30 },
  { id: "12m", label: "12 months", period: "monthly", months: 12 },
] as const satisfies readonly UsageRange[]

export type UsageRangeId = (typeof USAGE_RANGES)[number]["id"]

const HOUR_MS = 3_600_000

/** RFC3339 in UTC with whole seconds, the form the contract echoes back. */
function rfc3339(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z")
}

/**
 * The usage.series window for a range, in UTC. `before` is the start of the
 * bucket after the one `now` falls in, so the current bucket is included,
 * and `after` is whole buckets earlier, so every column is a whole hour, day
 * or month. UTC because the contract buckets in UTC: a local day would
 * straddle two columns.
 */
export function rangeBounds(
  id: UsageRangeId,
  now: number | Date
): { after: string; before: string; period: UsagePeriod } {
  const range: UsageRange =
    USAGE_RANGES.find((r) => r.id === id) ?? USAGE_RANGES[0]
  const ms = typeof now === "number" ? now : now.getTime()
  const d = new Date(ms)
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth()
  const day = d.getUTCDate()
  let after: number
  let before: number
  switch (range.period) {
    case "hourly":
      before = Math.floor(ms / HOUR_MS) * HOUR_MS + HOUR_MS
      after = before - (range.hours ?? 24) * HOUR_MS
      break
    case "daily":
      // Date.UTC carries a day or month past its end into the next one.
      before = Date.UTC(y, m, day + 1)
      after = Date.UTC(y, m, day + 1 - (range.days ?? 7))
      break
    case "monthly":
      before = Date.UTC(y, m + 1, 1)
      after = Date.UTC(y, m + 1 - (range.months ?? 12), 1)
      break
  }
  return {
    after: rfc3339(after),
    before: rfc3339(before),
    period: range.period,
  }
}

// Fixed English names, not the browser's locale: the axis and the table must
// say the same thing, and both say UTC.
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
]

const pad2 = (n: number) => String(n).padStart(2, "0")

/** A bucket's axis label, in UTC: "14:00", "3 Oct" or "Oct 2026". */
export function bucketTick(start: string, period: UsagePeriod): string {
  const d = new Date(start)
  switch (period) {
    case "hourly":
      return `${pad2(d.getUTCHours())}:00`
    case "daily":
      return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
    case "monthly":
      return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
  }
}

/**
 * A bucket named in full, for the tooltip and the table: "3 Oct 2026, 14:00
 * UTC", "3 Oct 2026" or "Oct 2026". 24 hours spans two dates, so an hour
 * alone would be ambiguous there.
 */
export function bucketTitle(start: string, period: UsagePeriod): string {
  const d = new Date(start)
  const date = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
  switch (period) {
    case "hourly":
      return `${date}, ${pad2(d.getUTCHours())}:00 UTC`
    case "daily":
      return date
    case "monthly":
      return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
  }
}

/**
 * A request's time in UTC, to the minute: "5 Oct 2026, 14:10 UTC". The
 * chart and the bucket table are UTC, so a request listed here lines up with
 * the column it was counted in.
 */
export function formatUtcMinute(at: string): string {
  const d = new Date(at)
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())} UTC`
}

// en-US, like the fixed English month names above: the axis, the table and
// the tooltip read the same whatever the browser's locale.
const count = new Intl.NumberFormat("en-US")

/** A count with thousands separators: "1,200". */
export function formatCount(n: number): string {
  return count.format(n)
}

/** Latency in whole milliseconds, as the contract sends it: "12 ms". */
export function formatLatency(ms: number): string {
  return `${count.format(ms)} ms`
}

/** A range of usage in four numbers, as the Usage page's summary line says it. */
export interface UsageSummary {
  requests: number
  /** 4xx and 5xx over requests, 0 to 1; null when there were no requests. */
  errorRate: number | null
  serverErrors: number
  /**
   * Each bucket's average weighted by its requests, so a busy hour counts for
   * more than a quiet one; null when no bucket had requests to average.
   */
  avgLatencyMs: number | null
}

/** Sums a series' buckets into the range's summary. */
export function summarizeUsage(buckets: readonly UsageBucket[]): UsageSummary {
  let requests = 0
  let errors = 0
  let serverErrors = 0
  let latencyTotal = 0
  let latencyRequests = 0
  for (const b of buckets) {
    requests += b.requests
    errors += b.clientErrors + b.serverErrors
    serverErrors += b.serverErrors
    if (b.requests > 0 && b.avgLatencyMs !== null) {
      latencyTotal += b.avgLatencyMs * b.requests
      latencyRequests += b.requests
    }
  }
  return {
    requests,
    errorRate: requests > 0 ? errors / requests : null,
    serverErrors,
    avgLatencyMs: latencyRequests > 0 ? latencyTotal / latencyRequests : null,
  }
}

const percent = new Intl.NumberFormat("en-US", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})

/**
 * An error rate to one decimal, "0.5%", or "no requests" when there is none.
 * A rate above zero that one decimal would round away reads "<0.1%": a range
 * with a few 4xx in it is not a clean one.
 */
export function formatErrorRate(rate: number | null): string {
  if (rate === null) return "no requests"
  if (rate > 0 && rate < 0.0005) return "<0.1%"
  return percent.format(rate)
}
