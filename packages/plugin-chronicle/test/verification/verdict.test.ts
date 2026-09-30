import { describe, expect, it } from "vitest"
import { verdictOf, verdictText } from "../../src/verification/verdict"
import { broken, mixed, plainNoCheckpoints, report, truncated } from "./fixtures"

const text = (r: Parameters<typeof verdictOf>[0], ctx?: Parameters<typeof verdictOf>[1]) => verdictText(verdictOf(r, ctx))
const NO_STORE_CTX = { checkpointingConfigured: false }
const STRONG = /\b(secure|protected|tamper-proof)\b/i

describe("verdictOf", () => {
  it("qualifies a pass on an unkeyed chain and makes its limits the loudest thing", () => {
    const v = verdictOf({ noChain: false, report: plainNoCheckpoints }, NO_STORE_CTX)
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

  it("claims alteration was ruled out only over the detecting ranges of a mixed chain", () => {
    const v = verdictOf({ noChain: false, report: mixed })
    expect(v.tone).toBe("pass")
    expect(v.headline.map((p) => p.text).join("")).toBe("No alteration detected in sequences 48,201 to 61,004.")
    expect(v.headline.filter((p) => p.mono).map((p) => p.text)).toEqual(["48,201", "61,004"])
    expect(v.qualifiers).toContain(
      "Sequences 1 to 48,200 predate the key and rest on an unkeyed digest: no corruption was detected there, and a deliberate rewrite of them would not show.",
    )
    expect(v.limitsLoud).toBe(true)
    expect(verdictText(v)).not.toContain("Keyed from")
  })

  it("does not say an unkeyed tail predates the key when a signed range comes first", () => {
    const v = verdictOf({
      noChain: false,
      report: report({
        verified: 3000,
        lastEvent: 3000,
        headSeq: 3000,
        coverage: [
          { fromSeq: 1, toSeq: 1500, level: "signed" },
          { fromSeq: 1501, toSeq: 3000, level: "unkeyed" },
        ],
      }),
    })
    expect(v.headline.map((p) => p.text).join("")).toBe("No alteration detected in sequences 1 to 1,500.")
    expect(v.qualifiers).toContain(
      "Sequences 1,501 to 3,000 rest on an unkeyed digest: no corruption was detected there, and a deliberate rewrite of them would not show.",
    )
    expect(verdictText(v)).not.toMatch(/predate the key|Keyed from/)
    expect(v.limitsLoud).toBe(true)
  })

  it("handles unkeyed ranges on both sides of a signed one, one sentence and one limit each", () => {
    const v = verdictOf({
      noChain: false,
      report: report({
        verified: 3000,
        lastEvent: 3000,
        headSeq: 3000,
        coverage: [
          { fromSeq: 1, toSeq: 100, level: "unkeyed" },
          { fromSeq: 101, toSeq: 1500, level: "signed" },
          { fromSeq: 1501, toSeq: 3000, level: "unkeyed" },
        ],
      }),
    })
    expect(v.headline.map((p) => p.text).join("")).toBe("No alteration detected in sequences 101 to 1,500.")
    const unkeyed = v.qualifiers.filter((q) => /unkeyed digest:/.test(q))
    expect(unkeyed).toEqual([
      "Sequences 1 to 100 rest on an unkeyed digest: no corruption was detected there, and a deliberate rewrite of them would not show.",
      "Sequences 1,501 to 3,000 rest on an unkeyed digest: no corruption was detected there, and a deliberate rewrite of them would not show.",
    ])
    const limits = v.limits.filter((l) => /rest on unkeyed digests/.test(l))
    expect(limits).toHaveLength(2)
    expect(limits[0]).toContain("Sequences 1 to 100 ")
    expect(limits[1]).toContain("Sequences 1,501 to 3,000 ")
    expect(v.limits.join(" ")).not.toMatch(/Sequences 1 to 3,000/)
    expect(verdictText(v)).not.toMatch(/predate the key|Keyed from/)
  })

  it("lists several detecting ranges joined with commas and a final and", () => {
    const v = verdictOf({
      noChain: false,
      report: report({
        verified: 3000,
        lastEvent: 3000,
        headSeq: 3000,
        coverage: [
          { fromSeq: 1, toSeq: 100, level: "keyed" },
          { fromSeq: 101, toSeq: 200, level: "unkeyed" },
          { fromSeq: 201, toSeq: 300, level: "signed" },
          { fromSeq: 301, toSeq: 400, level: "unkeyed" },
          { fromSeq: 401, toSeq: 3000, level: "keyed" },
        ],
      }),
    })
    expect(v.headline.map((p) => p.text).join("")).toBe(
      "No alteration detected in sequences 1 to 100, 201 to 300 and 401 to 3,000.",
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
    }, NO_STORE_CTX)
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

  it("never says the deployment stores no checkpoints unless it is told so", () => {
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
    for (const ctx of [{ checkpointingConfigured: true }, undefined]) {
      expect(text({ noChain: false, report: wiped }, ctx)).not.toMatch(/stores no checkpoints/)
    }
    expect(text({ noChain: false, report: plainNoCheckpoints })).not.toMatch(/stores no checkpoints/)
    expect(text({ noChain: false, report: plainNoCheckpoints }, NO_STORE_CTX)).toContain("This deployment stores no checkpoints")
  })

  it("names no range when nothing was examined and a checkpoint contradicts the head", () => {
    const wiped = report({
      valid: false,
      verified: 0,
      firstEvent: 0,
      lastEvent: 0,
      headSeq: 0,
      partial: true,
      coverage: undefined,
      checkpointsChecked: false,
      checkpointHeadChecked: true,
      checkpointHeadOk: false,
    })
    const v = verdictOf({ noChain: false, report: wiped }, { checkpointingConfigured: true })
    expect(v.tone).toBe("failed")
    expect(v.headline.map((p) => p.text).join("")).toBe(
      "Breaks found: a signed checkpoint says the chain once reached further.",
    )
    expect(v.qualifiers).toContain("No events were examined in the requested range.")
    const t = verdictText(v)
    expect(t).not.toMatch(/1 to 0|0 to 0|were examined\. The chain's head/)
  })

  it("keeps a retained range in the nothing-checked verdict and blames retention, not a wipe", () => {
    const v = verdictOf(
      {
        noChain: false,
        report: report({
          verified: 0,
          firstEvent: 0,
          lastEvent: 0,
          headSeq: 0,
          coverage: undefined,
          checkpointsChecked: false,
          checkpointHeadChecked: false,
          retained: [{ fromSeq: 1, toSeq: 50, recordSeq: 51 }],
        }),
      },
      NO_STORE_CTX,
    )
    expect(v.tone).toBe("nothing-checked")
    const t = verdictText(v)
    expect(t).toContain("Retention records account for this range: its events were removed by a retention policy.")
    expect(t).toContain(
      "Sequences 1 to 50 were removed by a retention policy, recorded in the chain at sequence 51.",
    )
    expect(t).not.toMatch(/wiped to its start/)
  })

  it("says the range held no events when nothing is retained and checkpointing is not known to be absent", () => {
    const empty = report({ verified: 0, firstEvent: 0, lastEvent: 0, headSeq: 0, coverage: undefined, checkpointsChecked: false })
    expect(text({ noChain: false, report: empty }, { checkpointingConfigured: true })).toContain(
      "The requested range holds no events.",
    )
    expect(text({ noChain: false, report: empty })).not.toMatch(/wiped to its start/)
  })
})
