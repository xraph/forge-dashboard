import { describe, expect, it } from "vitest"
import { checkpointRows, checksOf } from "../../src/verification/checks"
import { plainNoCheckpoints, report, truncated } from "./fixtures"

const byLabel = (rows: ReturnType<typeof checksOf>) => Object.fromEntries(rows.map((r) => [r.label, r]))

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
    const none = byLabel(checksOf(plainNoCheckpoints))
    expect(none["Checkpoints"].state).toBe("not-checked")
    expect(none["Checkpoints"].notChecked).toBe("Not checked, this deployment stores no checkpoints")
    expect(none["Checkpoint against head"].state).toBe("not-checked")
  })
  it("says why the head was not checked on a bounded range", () => {
    const rows = byLabel(checksOf(report({ partial: true, headChecked: false, lastEvent: 5000 })))
    expect(rows["Head"].state).toBe("not-checked")
    expect(rows["Head"].notChecked).toMatch(/stops before the head/)
  })
  it("says a chain with no checkpoint yet was not checked against one", () => {
    const rows = byLabel(checksOf(report({ checkpointHeadChecked: false, checkpointHeadOk: false })))
    expect(rows["Checkpoint against head"].notChecked).toMatch(/no checkpoint yet/)
  })
  it("fails the checkpoint row when any checkpoint failed a check that ran", () => {
    expect(byLabel(checksOf(truncated))["Checkpoints"].state).toBe("held")
    const bad = report({
      checkpoints: [{ id: "c", fromSeq: 1, toSeq: 10, signatureValid: false, hashMatch: true, hashChecked: true, continuityOk: true, continuityChecked: true }],
    })
    expect(byLabel(checksOf(bad))["Checkpoints"].state).toBe("failed")
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
})
