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

/** A date without its time, for billing periods. Unparseable text prints as it arrived. */
export function formatDay(iso: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return iso
  return at.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
}

export function formatPeriod(start: string, end: string): string {
  return `${formatDay(start)} – ${formatDay(end)}`
}
