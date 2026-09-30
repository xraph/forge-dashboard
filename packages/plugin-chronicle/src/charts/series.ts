import type { AggregateGroup } from "../types"

export type BucketUnit = "day" | "hour"

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const STEP: Record<BucketUnit, number> = { day: 86_400_000, hour: 3_600_000 }

function bucketKey(d: Date, unit: BucketUnit): string {
  const iso = d.toISOString()
  return unit === "day" ? iso.slice(0, 10) : `${iso.slice(0, 13)}:00:00Z`
}

function floor(d: Date, unit: BucketUnit): Date {
  const x = new Date(d)
  x.setUTCMinutes(0, 0, 0)
  if (unit === "day") x.setUTCHours(0)
  return x
}

/**
 * Every bucket between `from` and `to`, with the server's count where it
 * returned a group and null where it did not. The server returns no group for
 * a period nothing was recorded in; a gap is itself an audit finding, so it
 * stays null here, never zero.
 */
export function bucketSeries(groups: AggregateGroup[], from: Date, to: Date, unit: BucketUnit): { bucket: string; count: number | null }[] {
  const counts = new Map(groups.filter((g) => g.bucket).map((g) => [g.bucket as string, g.count]))
  const out: { bucket: string; count: number | null }[] = []
  for (let t = floor(from, unit).getTime(); t <= to.getTime(); t += STEP[unit]) {
    const key = bucketKey(new Date(t), unit)
    out.push({ bucket: key, count: counts.get(key) ?? null })
  }
  return out
}

export function emptyBuckets(series: { bucket: string; count: number | null }[]): string[] {
  return series.filter((s) => s.count === null).map((s) => s.bucket)
}

export function breakdown(groups: AggregateGroup[], key: "category" | "severity" | "outcome"): { label: string; count: number }[] {
  return groups.map((g) => ({ label: g[key] ?? "(none)", count: g.count })).sort((a, b) => b.count - a.count)
}

/** A bucket key is a day when it has no time part. */
export function bucketUnitOf(bucket: string): BucketUnit {
  return bucket.length === 10 ? "day" : "hour"
}

/**
 * A bucket the way an axis tick reads it, in UTC: "7 Sep" for a day, "03:00"
 * for an hour. `withDate` puts the day in front of an hour, for text where one
 * "03:00" could be either of two days.
 */
export function formatBucket(bucket: string, withDate = false): string {
  const d = new Date(bucket)
  const day = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
  if (bucketUnitOf(bucket) === "day") return day
  const time = `${String(d.getUTCHours()).padStart(2, "0")}:00`
  return withDate ? `${day} ${time}` : time
}

/**
 * Consecutive buckets folded into spans, so a quiet weekend reads as one span
 * and not as sixty separate hours. Input is in time order, as emptyBuckets
 * returns it.
 */
export function bucketRuns(buckets: string[], unit: BucketUnit): { from: string; to: string }[] {
  const runs: { from: string; to: string }[] = []
  for (const b of buckets) {
    const last = runs[runs.length - 1]
    if (last && new Date(b).getTime() - new Date(last.to).getTime() === STEP[unit]) last.to = b
    else runs.push({ from: b, to: b })
  }
  return runs
}
