import type { CheckpointResult, VerifyReport } from "../types"
import { tri, type TriState } from "./tri-state"

export interface CheckRow {
  label: string
  state: TriState
  held: string
  failed: string
  notChecked: string
}

const NO_STORE = "Not checked, this deployment stores no checkpoints"

function checkpointOk(c: CheckpointResult): boolean {
  return c.signatureValid && (!c.hashChecked || c.hashMatch) && (!c.continuityChecked || c.continuityOk)
}

/** What the verification examined, one row per question, each in three states. */
export function checksOf(r: VerifyReport): CheckRow[] {
  const linksChecked = r.verified > 0
  const linksOk = (r.tampered ?? []).length === 0 && (r.downgrades ?? []).length === 0
  return [
    {
      label: "Digests and links",
      state: tri(linksChecked, linksOk),
      held: "Every event recomputes and links",
      failed: "Some events do not recompute or link",
      notChecked: "Not checked, the range holds no events",
    },
    {
      label: "Gaps",
      state: tri(linksChecked, (r.gaps ?? []).length === 0),
      held: "No unexplained gaps",
      failed: "Sequences missing",
      notChecked: "Not checked, the range holds no events",
    },
    {
      label: "Head",
      state: tri(r.headChecked, r.headMatch),
      held: "Matches the last event",
      failed: "Does not match the last event",
      notChecked: r.partial ? "Not checked, the range stops before the head" : "Not checked",
    },
    {
      label: "Checkpoints",
      state: tri(r.checkpointsChecked, (r.checkpoints ?? []).every(checkpointOk)),
      held: (r.checkpoints ?? []).length === 0 ? "None in this range" : "All hold",
      failed: "At least one fails",
      notChecked: NO_STORE,
    },
    {
      label: "Checkpoint against head",
      state: tri(r.checkpointHeadChecked, r.checkpointHeadOk),
      held: "Consistent with the head",
      failed: "Reaches past the head",
      notChecked: r.checkpointsChecked ? "Not checked, the chain has no checkpoint yet" : NO_STORE,
    },
  ]
}

export function checkpointRows(c: CheckpointResult): CheckRow[] {
  return [
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
      notChecked: c.note ?? "Not checked",
    },
    {
      label: "Continuity",
      state: tri(c.continuityChecked, c.continuityOk),
      held: "Continuous",
      failed: "Broken",
      notChecked: "Not checked",
    },
  ]
}
