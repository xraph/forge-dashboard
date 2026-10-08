import { describe, expect, it } from "vitest"
import { breakAnchor, breaksOf } from "../../src/verification/breaks"
import { broken, report, truncated } from "./fixtures"

describe("breaksOf", () => {
  it("names each break with its kind and exact position, in sequence order", () => {
    const b = breaksOf(broken)
    expect(b.map((x) => [x.kind, x.fromSeq, x.toSeq])).toEqual([
      ["missing", 2311, 2312],
      ["altered", 2780, 2780],
      ["relabelled", 2901, 2901],
    ])
  })
  it("collapses consecutive missing sequences into one range", () => {
    expect(
      breaksOf(report({ valid: false, gaps: [5, 6, 7, 9] })).map((x) => [
        x.fromSeq,
        x.toSeq,
      ])
    ).toEqual([
      [5, 7],
      [9, 9],
    ])
  })
  it("never lists a retained range as a break", () => {
    expect(breaksOf(broken).some((x) => x.fromSeq === 101)).toBe(false)
  })
  it("reports truncation and a contradicting checkpoint at the head", () => {
    const b = breaksOf(truncated)
    expect(b.map((x) => x.kind)).toEqual(["truncated", "head-contradicted"])
    expect(b[0].fromSeq).toBe(3000)
  })
  it("does not report truncation when the head was not checked", () => {
    expect(breaksOf(report({ headChecked: false, headMatch: false }))).toEqual(
      []
    )
  })
  it("does not report a contradiction when no checkpoint was checked", () => {
    expect(
      breaksOf(
        report({ checkpointHeadChecked: false, checkpointHeadOk: false })
      )
    ).toEqual([])
  })
  it("says who to go and ask about a relabelled event or a cut-short head", () => {
    const relabelled = breaksOf(broken).find((x) => x.kind === "relabelled")!
    expect(relabelled.explanation).toMatch(
      /Treat it as tampering, and find out who has write access to the events table\.$/
    )
    for (const b of breaksOf(truncated)) {
      expect(b.explanation).toMatch(
        /find out who holds write access to the events and streams tables\.$/i
      )
    }
  })
  it("gives no write-access advice for a missing or altered event", () => {
    for (const b of breaksOf(broken).filter(
      (x) => x.kind === "missing" || x.kind === "altered"
    )) {
      expect(b.explanation).not.toMatch(/write access/)
    }
  })
  it("gives every break a stable anchor", () => {
    expect(breakAnchor(breaksOf(broken)[0])).toBe("break-missing-2311")
  })
})
