import { describe, expect, it } from "vitest"
import { verdictOf, verdictText } from "../../src/verification/verdict"
import { broken, mixed, plainNoCheckpoints, report, truncated } from "./fixtures"

const text = (r: Parameters<typeof verdictOf>[0]) => verdictText(verdictOf(r))
const STRONG = /\b(secure|protected|tamper-proof)\b/i

describe("verdictOf", () => {
  it("qualifies a pass on an unkeyed chain and makes its limits the loudest thing", () => {
    const v = verdictOf({ noChain: false, report: plainNoCheckpoints })
    expect(v.tone).toBe("pass")
    expect(verdictText(v)).toContain("No corruption detected in sequences 1 to 12,431.")
    expect(verdictText(v)).toContain(
      "This chain uses unkeyed digests: they detect accidental corruption, not deliberate alteration.",
    )
    expect(verdictText(v)).not.toMatch(/alteration detected|No alteration/)
    expect(verdictText(v)).not.toMatch(STRONG)
    expect(v.limitsLoud).toBe(true)
    expect(v.limits.join(" ")).toMatch(/events removed from the end of the chain cannot be detected/)
  })

  it("names the boundary on a mixed-level chain", () => {
    expect(text({ noChain: false, report: mixed })).toContain(
      "No alteration detected in sequences 1 to 61,004. Keyed from 48,201 onward, and everything below that predates the key and rests on an unkeyed digest.",
    )
  })

  it("says a bounded check does not speak for the rest of the chain", () => {
    const v = verdictOf({ noChain: false, report: report({ partial: true, firstEvent: 2431, lastEvent: 12431 }) })
    expect(v.qualifiers[0]).toBe("This check does not speak for the rest of the chain.")
    expect(verdictText(v)).toContain("sequences 2,431 to 12,431")
  })

  it("never calls a result with nothing verified a pass", () => {
    const v = verdictOf({
      noChain: false,
      report: report({ verified: 0, firstEvent: 0, lastEvent: 0, headSeq: 0, coverage: undefined, checkpointsChecked: false, checkpointHeadChecked: false, headChecked: false }),
    })
    expect(v.tone).toBe("nothing-checked")
    expect(verdictText(v)).toContain("No events verified.")
    expect(verdictText(v)).toMatch(/not a pass/)
    expect(verdictText(v)).toMatch(/Without signed checkpoints a chain wiped to its start looks exactly like this/)
  })

  it("says there is no chain rather than that the chain passed", () => {
    const v = verdictOf({ noChain: true })
    expect(v.tone).toBe("no-chain")
    expect(verdictText(v)).toMatch(/has not recorded any events/)
  })

  it("states breaks with their count and kinds, and the range examined", () => {
    const v = verdictOf({ noChain: false, report: broken })
    expect(v.tone).toBe("failed")
    expect(verdictText(v)).toContain("Breaks found in sequences 1 to 5,000: 2 missing, 1 altered, 1 relabelled.")
  })

  it("says a gap may be an unrecorded purge when policies can purge the chain", () => {
    expect(text({ noChain: false, report: broken })).toContain(
      "2 retention policies can purge this chain. A missing sequence may be a purge that was never recorded in the chain, which Chronicle cannot tell from a deletion.",
    )
  })

  it("says so when the policy count is unknown", () => {
    expect(text({ noChain: false, report: { ...broken, retentionPolicies: -1 } })).toContain(
      "Whether a retention policy removed any of these sequences is unknown: the policy count could not be read.",
    )
  })

  it("says nothing about retention policies when there are no gaps to explain", () => {
    expect(text({ noChain: false, report: { ...truncated, retentionPolicies: 3 } })).not.toMatch(/retention polic/)
  })

  it("describes a retained range as removed by retention, backed by a record, never as a break", () => {
    const t = text({ noChain: false, report: { ...broken } })
    expect(t).toContain(
      "Sequences 101 to 400 were removed by a retention policy, recorded in the chain at sequence 401. The chain links across them; what they said is gone.",
    )
  })

  it("names a truncated head and a contradicting checkpoint", () => {
    expect(text({ noChain: false, report: truncated })).toContain(
      "Breaks found in sequences 1 to 3,000: the head does not match the last event, and a signed checkpoint says the chain once reached further.",
    )
  })

  it("puts the sequence numbers in mono parts", () => {
    const v = verdictOf({ noChain: false, report: plainNoCheckpoints })
    expect(v.headline.filter((p) => p.mono).map((p) => p.text)).toEqual(["1", "12,431"])
  })

  it("notes tolerant sequences as a caveat, not a failure", () => {
    const v = verdictOf({ noChain: false, report: report({ tolerant: [5, 6] }) })
    expect(v.tone).toBe("pass")
    expect(verdictText(v)).toContain(
      "2 events recorded no digest scheme, so their scheme was inferred when they were checked.",
    )
  })
})
