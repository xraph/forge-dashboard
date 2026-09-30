/*
 * `datetime-local` inputs and the RFC3339 instants the contract takes. A
 * datetime-local value has no zone; these read and write it in the
 * operator's own, which is what a person setting a coupon window means.
 */

export function toRFC3339(local: string): string | undefined {
  if (local === "") return undefined
  const at = new Date(local)
  return Number.isNaN(at.getTime()) ? undefined : at.toISOString()
}

export function toLocalInput(iso: string | undefined): string {
  if (!iso) return ""
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ""
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`
}

/**
 * A date without its time, for billing periods. Shown as the UTC date, because
 * the engine cuts periods at UTC instants: 2026-10-01T00:00:00Z is October 1
 * everywhere, not September 30 west of Greenwich. Unparseable text prints as
 * it arrived.
 */
export function formatDay(iso: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return iso
  return at.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" })
}

/**
 * A date without its time, in the operator's own zone. For instants an
 * operator entered, such as a coupon's validity window, unlike billing days
 * (`formatDay`, UTC): "until 23:59 on Dec 31" typed in their zone must read
 * Dec 31 to them, not Jan 1 west of Greenwich. Unparseable text prints as it
 * arrived.
 */
export function formatLocalDay(iso: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return iso
  return at.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
}

export function formatPeriod(start: string, end: string): string {
  return `${formatDay(start)} – ${formatDay(end)}`
}

/**
 * An instant with its time, read in UTC. The usage page cuts its chart into UTC
 * days, the days billing periods are cut on, so its event log shows the same
 * clock: an event at 23:30 UTC then sits visibly under the column it was
 * counted in, whatever zone the operator's machine is in. Unparseable text
 * prints as it arrived.
 */
export function formatUTCInstant(iso: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return iso
  return at.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium", timeZone: "UTC" })
}
