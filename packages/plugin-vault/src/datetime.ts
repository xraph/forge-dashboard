/*
 * `datetime-local` strings and the RFC3339 instants the contract takes.
 *
 * A `datetime-local` value has no zone, so somebody has to say which one it is
 * in. The secret expiry says the operator's own; a flag schedule says UTC,
 * because the ladder prints every schedule in UTC and a label that said
 * "(UTC)" over a local reading would be a lie the server then believed.
 */

/**
 * The operator's-zone reading, for a secret's expiry. `new Date(local)` takes
 * the string in the zone the browser is in and `toISOString` writes it back
 * out as UTC with a "Z". Undefined for an empty or unparseable string.
 */
export function toRFC3339(local: string): string | undefined {
  if (local === "") return undefined
  const at = new Date(local)
  return Number.isNaN(at.getTime()) ? undefined : at.toISOString()
}

const LOCAL_SHAPE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/

/**
 * The UTC reading, for a schedule: the fields in the string ARE the UTC
 * fields, whatever zone the browser is in. Undefined for anything a
 * `datetime-local` control would not produce.
 */
export function utcInputToRFC3339(local: string): string | undefined {
  if (!LOCAL_SHAPE.test(local)) return undefined
  const at = new Date(`${local}${local.length === 16 ? ":00" : ""}Z`)
  return Number.isNaN(at.getTime()) ? undefined : at.toISOString()
}

/**
 * An RFC3339 instant as the UTC fields a `datetime-local` control holds:
 * "2026-03-01T09:00", with seconds only when they are not zero so a control
 * with the default one-minute step can show it. Empty for anything
 * unparseable.
 */
export function toUTCInput(iso: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ""
  return at
    .toISOString()
    .replace(/\.\d+Z$/, "")
    .replace(/:00$/, "")
}

/**
 * What to send for a schedule end. Untouched text sends the instant as it was
 * read, byte for byte, so saving never rewrites a time the operator did not
 * change (the control cannot show fractions of a second, the instant may
 * carry them). Empty text is an open end.
 */
export function scheduleTime(text: string, original: string | undefined): string | undefined {
  if (text === "") return undefined
  if (original !== undefined && text === toUTCInput(original)) return original
  return utcInputToRFC3339(text)
}
