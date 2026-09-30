import type { CheckpointResult, VerifyReport } from "../types"
import { tri, type TriState } from "./tri-state"

export interface CheckRow {
  label: string
  state: TriState
  held: string
  failed: string
  notChecked: string
  /** Why a failed row failed, in the server's words. Shown beside the badge, never inside it. */
  failedNote?: string
}

const NO_STORE = "Not checked, this deployment stores no checkpoints"
const NO_EVENTS = "Not checked, the range holds no events"

/** What the page knows about the deployment that the report cannot say. */
export interface ChecksContext {
  /**
   * Whether the deployment stores checkpoints. A report's `checkpointsChecked`
   * is false for an empty range even when checkpoints exist, so "stores no
   * checkpoints" is only said when the deployment says so.
   */
  checkpointingConfigured?: boolean
}

function checkpointOk(c: CheckpointResult): boolean {
  return c.signatureValid && (!c.hashChecked || c.hashMatch) && (!c.continuityChecked || c.continuityOk)
}

/**
 * Nothing failed, but a signature alone is not the whole check: a hash or a
 * continuity check that did not run must not be summed up as "all hold".
 */
function checkpointsHeld(cps: CheckpointResult[]): string {
  if (cps.length === 0) return "None in this range"
  if (cps.every((c) => c.hashChecked && c.continuityChecked)) return "All hold"
  return "Signatures valid; some hash or continuity checks did not run"
}

/** What the verification examined, one row per question, each in three states. */
export function checksOf(r: VerifyReport, ctx: ChecksContext = {}): CheckRow[] {
  const noStore = ctx.checkpointingConfigured === false
  const linksChecked = r.verified > 0
  const linksOk = (r.tampered ?? []).length === 0 && (r.downgrades ?? []).length === 0
  return [
    {
      label: "Digests and links",
      state: tri(linksChecked, linksOk),
      held: "Every event recomputes and links",
      failed: "Some events do not recompute or link",
      notChecked: NO_EVENTS,
    },
    {
      label: "Gaps",
      // A gap found, or a range retention accounts for, means the check ran
      // even when no event came back. A run that examined nothing and found
      // nothing proves nothing, so it is not checked, never "no gaps".
      state: tri(r.verified > 0 || (r.gaps ?? []).length > 0 || (r.retained ?? []).length > 0, (r.gaps ?? []).length === 0),
      held: "No unexplained gaps",
      failed: "Sequences missing",
      notChecked: NO_EVENTS,
    },
    {
      label: "Head",
      state: tri(r.headChecked, r.headMatch),
      held: "Matches the last event",
      failed: "Does not match the last event",
      // The verifier checks the head only on a range that is not partial. The
      // default window ends at the head but starts after 1, so it is partial
      // too, and "stops before the head" would be the wrong reason.
      notChecked: r.partial ? "Not checked: a partial range does not check the head" : "Not checked",
    },
    {
      label: "Checkpoints",
      state: tri(r.checkpointsChecked, (r.checkpoints ?? []).every(checkpointOk)),
      held: checkpointsHeld(r.checkpoints ?? []),
      failed: "At least one fails",
      notChecked: noStore ? NO_STORE : r.verified === 0 ? NO_EVENTS : "Not checked",
    },
    {
      label: "Checkpoint against head",
      state: tri(r.checkpointHeadChecked, r.checkpointHeadOk),
      held: "Consistent with the head",
      failed: "Reaches past the head",
      notChecked: noStore
        ? NO_STORE
        : r.checkpointsChecked
          ? "Not checked, the chain has no checkpoint yet"
          : r.verified === 0
            ? NO_EVENTS
            : "Not checked",
    },
  ]
}

/**
 * One row per check on a checkpoint, with the checkpoint's note on the row it
 * explains.
 *
 * chronicle keeps one note per checkpoint: the first reason it found, trying
 * the signature, then the hash, then continuity (verify/verifier.go). So the
 * note belongs to the first row that did not hold. Beside any other row it
 * would name the wrong check: a hash that did not run after a bad signature
 * would read "Not checked. signature does not verify".
 */
export function checkpointRows(c: CheckpointResult): CheckRow[] {
  const rows: CheckRow[] = [
    {
      label: "Signature",
      state: tri(true, c.signatureValid),
      held: "Valid",
      failed: "Invalid",
      notChecked: "Not checked",
    },
    {
      label: "Hash",
      state: tri(c.hashChecked, c.hashMatch),
      held: "Matches",
      failed: "Does not match",
      notChecked: "Not checked",
    },
    {
      label: "Continuity",
      state: tri(c.continuityChecked, c.continuityOk),
      held: "Continuous",
      failed: "Broken",
      notChecked: "Not checked",
    },
  ]
  const owner = rows.find((r) => r.state !== "held")
  if (c.note && owner) {
    // An unchecked row still has to say first that it was not checked; the note says why.
    if (owner.state === "not-checked") owner.notChecked = `Not checked. ${c.note}`
    else owner.failedNote = c.note
  }
  return rows
}
