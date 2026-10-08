import { describe, expect, it } from "vitest"
import { checkpointRows, checksOf } from "../../src/verification/checks"
import type { CheckpointResult } from "../../src/types"
import { plainNoCheckpoints, report, truncated } from "./fixtures"

const byLabel = (rows: ReturnType<typeof checksOf>) =>
  Object.fromEntries(rows.map((r) => [r.label, r]))

describe("checksOf", () => {
  it("covers all three states for every tri-state field", () => {
    // checked and held
    const held = byLabel(checksOf(report()))
    expect(held["Head"].state).toBe("held")
    expect(held["Checkpoints"].state).toBe("held")
    expect(held["Checkpoint against head"].state).toBe("held")
    // checked and failed
    const failed = byLabel(checksOf(truncated))
    expect(failed["Head"].state).toBe("failed")
    expect(failed["Checkpoint against head"].state).toBe("failed")
    // not checked
    const none = byLabel(
      checksOf(plainNoCheckpoints, { checkpointingConfigured: false })
    )
    expect(none["Checkpoints"].state).toBe("not-checked")
    expect(none["Checkpoints"].notChecked).toBe(
      "Not checked, this deployment stores no checkpoints"
    )
    expect(none["Checkpoint against head"].state).toBe("not-checked")
  })
  it("says why the head was not checked on a bounded range", () => {
    const rows = byLabel(
      checksOf(report({ partial: true, headChecked: false, lastEvent: 5000 }))
    )
    expect(rows["Head"].state).toBe("not-checked")
    expect(rows["Head"].notChecked).toBe(
      "Not checked: a partial range does not check the head"
    )
  })
  it("blames the partial range, not where it stops, on the default window that ends at the head", () => {
    // The verifier checks the head only on a range that is not partial, and a
    // window starting after 1 is partial even when it ends at the head.
    const rows = byLabel(
      checksOf(
        report({
          partial: true,
          headChecked: false,
          firstEvent: 2432,
          lastEvent: 12431,
          headSeq: 12431,
        })
      )
    )
    expect(rows["Head"].notChecked).toBe(
      "Not checked: a partial range does not check the head"
    )
    expect(rows["Head"].notChecked).not.toMatch(/stops before the head/)
  })
  it("says a chain with no checkpoint yet was not checked against one", () => {
    const rows = byLabel(
      checksOf(
        report({ checkpointHeadChecked: false, checkpointHeadOk: false })
      )
    )
    expect(rows["Checkpoint against head"].notChecked).toMatch(
      /no checkpoint yet/
    )
  })
  it("says all checkpoints hold only when every hash and continuity check ran", () => {
    expect(
      byLabel(checksOf(report({ checkpoints: [truncated.checkpoints![0]] })))[
        "Checkpoints"
      ].held
    ).toBe("All hold")
    // The truncated shape: the second checkpoint's hash could not be compared.
    const rows = byLabel(checksOf(truncated))
    expect(rows["Checkpoints"].state).toBe("held")
    expect(rows["Checkpoints"].held).toBe(
      "Signatures valid; some hash or continuity checks did not run"
    )
    const noContinuity = report({
      checkpoints: [
        {
          ...truncated.checkpoints![0],
          continuityChecked: false,
          continuityOk: false,
        },
      ],
    })
    expect(byLabel(checksOf(noContinuity))["Checkpoints"].held).toBe(
      "Signatures valid; some hash or continuity checks did not run"
    )
  })
  it("fails the checkpoint row when any checkpoint failed a check that ran", () => {
    expect(byLabel(checksOf(truncated))["Checkpoints"].state).toBe("held")
    const bad = report({
      checkpoints: [
        {
          id: "c",
          fromSeq: 1,
          toSeq: 10,
          signatureValid: false,
          hashMatch: true,
          hashChecked: true,
          continuityOk: true,
          continuityChecked: true,
        },
      ],
    })
    expect(byLabel(checksOf(bad))["Checkpoints"].state).toBe("failed")
  })
})

describe("checksOf, deployment context", () => {
  const wiped = report({
    valid: false,
    verified: 0,
    firstEvent: 0,
    lastEvent: 0,
    headSeq: 0,
    coverage: undefined,
    checkpointsChecked: false,
    checkpointHeadChecked: true,
    checkpointHeadOk: false,
  })
  it("does not claim the deployment stores no checkpoints when it does", () => {
    for (const ctx of [{ checkpointingConfigured: true }, undefined]) {
      const rows = checksOf(wiped, ctx)
      const all = rows
        .flatMap((r) => [r.held, r.failed, r.notChecked])
        .join("\n")
      expect(all).not.toMatch(/stores no checkpoints/)
    }
    const rows = byLabel(checksOf(wiped, { checkpointingConfigured: true }))
    expect(rows["Checkpoints"].notChecked).toBe(
      "Not checked, the range holds no events"
    )
    expect(rows["Checkpoint against head"].state).toBe("failed")
  })
  it("falls back to a bare not-checked when events were examined and the store is unknown", () => {
    const rows = byLabel(
      checksOf(
        report({
          checkpointsChecked: false,
          checkpointHeadChecked: false,
          checkpointHeadOk: false,
        })
      )
    )
    expect(rows["Checkpoints"].notChecked).toBe("Not checked")
    expect(rows["Checkpoint against head"].notChecked).toBe("Not checked")
  })
  it("does not call a run that examined nothing free of gaps", () => {
    const rows = byLabel(
      checksOf(
        report({
          verified: 0,
          firstEvent: 0,
          lastEvent: 0,
          headSeq: 0,
          coverage: undefined,
        })
      )
    )
    expect(rows["Gaps"].state).toBe("not-checked")
    expect(rows["Gaps"].notChecked).toBe(
      "Not checked, the range holds no events"
    )
  })
  it("counts a range retention emptied as checked for gaps", () => {
    const rows = byLabel(
      checksOf(
        report({
          verified: 0,
          retained: [{ fromSeq: 1, toSeq: 400, recordSeq: 401 }],
        })
      )
    )
    expect(rows["Gaps"].state).toBe("held")
  })
  it("shows gaps the check found as failed even when no event came back", () => {
    const rows = byLabel(checksOf(report({ verified: 0, gaps: [5, 6] })))
    expect(rows["Gaps"].state).toBe("failed")
  })
})

describe("checkpointRows", () => {
  it("keeps hash and continuity three-state per checkpoint", () => {
    const rows = checkpointRows(truncated.checkpoints![1])
    expect(rows.map((r) => [r.label, r.state])).toEqual([
      ["Signature", "held"],
      ["Hash", "not-checked"],
      ["Continuity", "held"],
    ])
  })

  // chronicle keeps one note per checkpoint: the first reason it found, in the
  // order signature, hash, continuity. It belongs to the first row that did not hold.
  const cp = (over: Partial<CheckpointResult>): CheckpointResult => ({
    id: "ckpt_1",
    fromSeq: 1,
    toSeq: 100,
    signatureValid: true,
    hashMatch: true,
    hashChecked: true,
    continuityOk: true,
    continuityChecked: true,
    ...over,
  })
  const rowsOf = (c: CheckpointResult) =>
    Object.fromEntries(checkpointRows(c).map((r) => [r.label, r]))

  it("puts a failed hash's note on the hash row", () => {
    const rows = rowsOf(
      cp({
        hashMatch: false,
        note: "chain hash at to_seq no longer matches what the checkpoint recorded",
      })
    )
    expect(rows["Hash"].state).toBe("failed")
    expect(rows["Hash"].failedNote).toBe(
      "chain hash at to_seq no longer matches what the checkpoint recorded"
    )
    expect(rows["Signature"].failedNote).toBeUndefined()
  })

  it("puts an invalid signature's note on the signature row, never on a hash that did not run", () => {
    const rows = rowsOf(
      cp({
        signatureValid: false,
        hashChecked: false,
        hashMatch: false,
        note: "signature does not verify: bad key",
      })
    )
    expect(rows["Signature"].failedNote).toBe(
      "signature does not verify: bad key"
    )
    expect(rows["Hash"].notChecked).toBe("Not checked")
  })

  it("puts broken continuity's note on the continuity row", () => {
    const rows = rowsOf(
      cp({
        continuityOk: false,
        note: "does not continue from the previous checkpoint without a gap",
      })
    )
    expect(rows["Continuity"].failedNote).toBe(
      "does not continue from the previous checkpoint without a gap"
    )
    expect(rows["Hash"].failedNote).toBeUndefined()
  })

  it("says why continuity was not checked when that is the note", () => {
    const rows = rowsOf(
      cp({
        continuityChecked: false,
        continuityOk: false,
        note: "predecessor checkpoint not in the verified range; continuity not checked",
      })
    )
    expect(rows["Continuity"].notChecked).toBe(
      "Not checked. predecessor checkpoint not in the verified range; continuity not checked"
    )
    expect(rows["Hash"].notChecked).toBe("Not checked")
  })
})
