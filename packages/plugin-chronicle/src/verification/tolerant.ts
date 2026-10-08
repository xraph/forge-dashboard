import type { VerifyReport } from "../types"
import { runs } from "./breaks"

export interface TolerantRow {
  fromSeq: number
  toSeq: number
  /** Also listed as altered. The fallback found no scheme that recomputes, or the event does not link. */
  altered: boolean
}

/**
 * The sequences chronicle resolved through its pre-migration fallback: the
 * event recorded no digest scheme, so one was inferred when it was checked.
 *
 * Tolerant is not a pass. The fallback marks an event tolerant whether or not
 * any scheme it tried recomputes, and one that fails is in `tampered` too. So
 * runs are split on that, and a run never reads as fine while its break row
 * says otherwise.
 */
export function tolerantRowsOf(r: VerifyReport): TolerantRow[] {
  const tampered = new Set(r.tampered ?? [])
  const tolerant = r.tolerant ?? []
  const rows: TolerantRow[] = [
    ...runs(tolerant.filter((s) => !tampered.has(s))).map(
      ([fromSeq, toSeq]) => ({ fromSeq, toSeq, altered: false })
    ),
    ...runs(tolerant.filter((s) => tampered.has(s))).map(
      ([fromSeq, toSeq]) => ({ fromSeq, toSeq, altered: true })
    ),
  ]
  return rows.sort((a, b) => a.fromSeq - b.fromSeq)
}
