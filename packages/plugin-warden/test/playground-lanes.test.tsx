import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import {
  LaneRow,
  decidingLane,
  verdictSentence,
  type LaneState,
  type PlaygroundLane,
  type PlaygroundResult,
} from "../src/components/playground-lanes"

const RBAC_MATCH = [{ source: "rbac", ruleId: "role_01hq", detail: "role grants document:read" }]
const ABAC_ALLOW_MATCH = [
  { source: "abac", ruleId: "wpol_staff-read", detail: 'policy "staff-read" (allow)' },
]
const ABAC_DENY_MATCH = [
  { source: "abac", ruleId: "wpol_lockout", detail: 'policy "lockout" (deny)' },
]
const REBAC_MATCH = [{ source: "rebac", detail: "direct relation" }]

function lane(
  model: PlaygroundLane["model"],
  state: LaneState,
  over: Partial<PlaygroundLane> = {},
): PlaygroundLane {
  return { model, state, matchedBy: [], ...over }
}

/** A plain no-match lane the way each model reports one. */
const NO_RBAC = lane("rbac", "noMatch", { decision: "deny_no_roles", reason: "no roles" })
const NO_REBAC = lane("rebac", "noMatch", { decision: "deny_relation", reason: "no relation" })
const NO_ABAC = lane("abac", "noMatch")

const RBAC_ALLOW = lane("rbac", "allow", { decision: "allow", matchedBy: RBAC_MATCH })
const REBAC_ALLOW = lane("rebac", "allow", { decision: "allow", matchedBy: REBAC_MATCH })
const ABAC_ALLOW = lane("abac", "allow", { decision: "allow", matchedBy: ABAC_ALLOW_MATCH })
const ABAC_DENY = lane("abac", "deny", {
  decision: "deny_explicit",
  reason: 'denied by policy "lockout"',
  matchedBy: ABAC_DENY_MATCH,
})

function result(
  decision: string,
  lanes: PlaygroundLane[],
  over: Partial<PlaygroundResult> = {},
): PlaygroundResult {
  return {
    decision,
    allowed: decision === "allow",
    matchedBy: [],
    obligations: [],
    evalTimeNs: 400_000,
    lanes,
    ...over,
  }
}

describe("decidingLane", () => {
  it("gives abac for an explicit deny, whatever else allowed", () => {
    expect(decidingLane(result("deny_explicit", [RBAC_ALLOW, lane("rebac", "skipped"), ABAC_DENY]))).toBe(
      "abac",
    )
  })

  it("gives the first allowing lane in order rbac, rebac, abac", () => {
    expect(decidingLane(result("allow", [RBAC_ALLOW, REBAC_ALLOW, ABAC_ALLOW]))).toBe("rbac")
    expect(decidingLane(result("allow", [NO_RBAC, REBAC_ALLOW, ABAC_ALLOW]))).toBe("rebac")
    expect(decidingLane(result("allow", [NO_RBAC, NO_REBAC, ABAC_ALLOW]))).toBe("abac")
  })

  it("gives, for any other denial, the first lane in order whose reason is non-empty", () => {
    const noAbacReason = lane("abac", "noMatch")
    expect(decidingLane(result("deny_no_roles", [NO_RBAC, NO_REBAC, noAbacReason]))).toBe("rbac")
    // RBAC has nothing to say (disabled), so the first reason is ReBAC's.
    expect(
      decidingLane(result("deny_relation", [lane("rbac", "disabled"), NO_REBAC, NO_ABAC])),
    ).toBe("rebac")
    // Only ABAC gave a reason.
    expect(
      decidingLane(
        result("deny_condition", [
          lane("rbac", "disabled"),
          lane("rebac", "disabled"),
          lane("abac", "noMatch", { reason: "condition failed" }),
        ]),
      ),
    ).toBe("abac")
  })

  it("gives null for an error", () => {
    expect(
      decidingLane(
        result(
          "error",
          [lane("rbac", "error", { error: "store down" }), lane("rebac", "notEvaluated"), lane("abac", "notEvaluated")],
          { error: "warden rbac: store down" },
        ),
      ),
    ).toBeNull()
  })

  it("gives null for a denial no lane gave a reason for (deny_default)", () => {
    expect(
      decidingLane(
        result("deny_default", [
          lane("rbac", "disabled"),
          lane("rebac", "disabled"),
          lane("abac", "noMatch"),
        ]),
      ),
    ).toBeNull()
  })
})

describe("verdictSentence", () => {
  const failed = (which: 0 | 1 | 2) => {
    const models = ["rbac", "rebac", "abac"] as const
    return result(
      "error",
      models.map((m, i) =>
        i === which
          ? lane(m, "error", { error: "store down" })
          : i > which
            ? lane(m, "notEvaluated")
            : lane(m, "noMatch", { reason: "x" }),
      ),
      { error: "warden: store down" },
    )
  }

  it("names the model that failed, in its own casing", () => {
    expect(verdictSentence(failed(0))).toBe("The RBAC model failed, so no decision was returned.")
    expect(verdictSentence(failed(1))).toBe("The ReBAC model failed, so no decision was returned.")
    expect(verdictSentence(failed(2))).toBe("The ABAC model failed, so no decision was returned.")
  })

  it("says an explicit deny overrides the first allowing model", () => {
    expect(
      verdictSentence(result("deny_explicit", [RBAC_ALLOW, lane("rebac", "skipped"), ABAC_DENY])),
    ).toBe("An explicit deny overrides the RBAC allow.")
    expect(verdictSentence(result("deny_explicit", [NO_RBAC, REBAC_ALLOW, ABAC_DENY]))).toBe(
      "An explicit deny overrides the ReBAC allow.",
    )
    // Both allowed (evaluate all models): the first one is named.
    expect(verdictSentence(result("deny_explicit", [RBAC_ALLOW, REBAC_ALLOW, ABAC_DENY]))).toBe(
      "An explicit deny overrides the RBAC allow.",
    )
  })

  it("says a deny policy matched when nothing else allowed", () => {
    expect(verdictSentence(result("deny_explicit", [NO_RBAC, NO_REBAC, ABAC_DENY]))).toBe(
      "A deny policy matched.",
    )
  })

  it("says which model allowed, and that no deny policy matched, when policy evaluation is on", () => {
    expect(verdictSentence(result("allow", [RBAC_ALLOW, lane("rebac", "skipped"), NO_ABAC]))).toBe(
      "RBAC allowed this check, and no deny policy matched.",
    )
    expect(verdictSentence(result("allow", [NO_RBAC, REBAC_ALLOW, NO_ABAC]))).toBe(
      "ReBAC allowed this check, and no deny policy matched.",
    )
    expect(verdictSentence(result("allow", [NO_RBAC, NO_REBAC, ABAC_ALLOW]))).toBe(
      "ABAC allowed this check, and no deny policy matched.",
    )
  })

  it("says policy evaluation is off when the ABAC lane is disabled", () => {
    expect(
      verdictSentence(result("allow", [RBAC_ALLOW, lane("rebac", "skipped"), lane("abac", "disabled")])),
    ).toBe("RBAC allowed this check. Policy evaluation is off, so no deny policy could override it.")
  })

  it("says no model allowed for every other denial", () => {
    expect(verdictSentence(result("deny_no_roles", [NO_RBAC, NO_REBAC, NO_ABAC]))).toBe(
      "No model allowed this check.",
    )
    expect(
      verdictSentence(
        result("deny_default", [lane("rbac", "disabled"), lane("rebac", "disabled"), NO_ABAC]),
      ),
    ).toBe("No model allowed this check.")
  })

  it("appends the truncated walk note when the ReBAC lane stopped at its limit", () => {
    const note = "The relation walk stopped at its limit, so a relation may exist beyond it."
    const truncated = lane("rebac", "noMatch", { reason: "no relation", walkTruncated: true })
    expect(verdictSentence(result("deny_no_roles", [NO_RBAC, truncated, NO_ABAC]))).toBe(
      `No model allowed this check. ${note}`,
    )
    expect(verdictSentence(result("allow", [RBAC_ALLOW, truncated, NO_ABAC]))).toBe(
      `RBAC allowed this check, and no deny policy matched. ${note}`,
    )
  })

  it("appends the expression failure note when the ReBAC lane's expression failed", () => {
    const note = "The resource type's permission expression failed, so it was treated as no match."
    const broken = lane("rebac", "noMatch", { reason: "no relation", expressionError: "boom" })
    expect(verdictSentence(result("deny_no_roles", [NO_RBAC, broken, NO_ABAC]))).toBe(
      `No model allowed this check. ${note}`,
    )
  })

  it("says the relation walk decided when the ReBAC lane allowed despite a failed expression", () => {
    const allowed = lane("rebac", "allow", {
      decision: "allow",
      matchedBy: REBAC_MATCH,
      expressionError: "boom",
    })
    expect(verdictSentence(result("allow", [NO_RBAC, allowed, NO_ABAC]))).toBe(
      "ReBAC allowed this check, and no deny policy matched. The resource type's permission expression failed, so the relation walk decided instead.",
    )
  })

  it("keeps the treated-as-no-match wording when the ReBAC lane did not allow", () => {
    const broken = lane("rebac", "noMatch", { reason: "no relation", expressionError: "boom" })
    // An allow from another model, with ReBAC's expression failed and no match.
    expect(verdictSentence(result("allow", [RBAC_ALLOW, broken, NO_ABAC]))).toBe(
      "RBAC allowed this check, and no deny policy matched. The resource type's permission expression failed, so it was treated as no match.",
    )
  })

  it("appends both notes, the walk first", () => {
    const both = lane("rebac", "noMatch", {
      reason: "no relation",
      walkTruncated: true,
      expressionError: "boom",
    })
    expect(verdictSentence(result("deny_no_roles", [NO_RBAC, both, NO_ABAC]))).toBe(
      "No model allowed this check. The relation walk stopped at its limit, so a relation may exist beyond it. The resource type's permission expression failed, so it was treated as no match.",
    )
  })
})

describe("LaneRow", () => {
  function row(l: PlaygroundLane, deciding = false) {
    return render(<LaneRow lane={l} deciding={deciding} />)
  }

  it("names the model in its own casing", () => {
    row(NO_REBAC)
    expect(screen.getByText("ReBAC")).toBeTruthy()
  })

  it("shows an rbac allow with its match linked to the role", () => {
    row(RBAC_ALLOW)
    expect(screen.getByText("allow")).toBeTruthy()
    const link = screen.getByRole("link", { name: "role grants document:read" })
    expect(link.getAttribute("href")).toBe("/roles/role_01hq")
  })

  it("shows an abac allow with its match linked to the policy", () => {
    row(ABAC_ALLOW)
    const link = screen.getByRole("link", { name: 'policy "staff-read" (allow)' })
    expect(link.getAttribute("href")).toBe("/policies/wpol_staff-read")
  })

  it("shows a rebac allow's match as plain text, never a link", () => {
    row(REBAC_ALLOW)
    expect(screen.getByText("direct relation")).toBeTruthy()
    expect(screen.queryByRole("link")).toBeNull()
  })

  it("falls back to the rule id for a linked match with no detail", () => {
    row(lane("rbac", "allow", { matchedBy: [{ source: "rbac", ruleId: "role_01hq" }] }))
    expect(screen.getByRole("link", { name: "role_01hq" }).getAttribute("href")).toBe(
      "/roles/role_01hq",
    )
  })

  it("shows a deny in destructive text, with the policy link", () => {
    row(ABAC_DENY)
    expect(screen.getByText("deny").className).toContain("text-destructive")
    expect(
      screen.getByRole("link", { name: 'policy "lockout" (deny)' }).getAttribute("href"),
    ).toBe("/policies/wpol_lockout")
  })

  it("shows no match with the reason when there is one", () => {
    row(NO_RBAC)
    expect(screen.getByText("no match")).toBeTruthy()
    expect(screen.getByText("no roles")).toBeTruthy()
  })

  it("says No policy matched for an abac no match with no reason", () => {
    row(NO_ABAC)
    expect(screen.getByText("no match")).toBeTruthy()
    expect(screen.getByText("No policy matched.")).toBeTruthy()
  })

  it("does not say No policy matched for another model's no match", () => {
    row(lane("rebac", "noMatch"))
    expect(screen.queryByText("No policy matched.")).toBeNull()
  })

  it("says why a lane was skipped", () => {
    row(lane("rebac", "skipped"))
    expect(screen.getByText("skipped")).toBeTruthy()
    expect(screen.getByText("RBAC already allowed, so ReBAC did not run.")).toBeTruthy()
  })

  it("says a disabled lane is turned off in the config", () => {
    row(lane("abac", "disabled"))
    expect(screen.getByText("disabled")).toBeTruthy()
    expect(screen.getByText("Turned off in warden's config.")).toBeTruthy()
  })

  it("shows an error lane's error in destructive text", () => {
    row(lane("rbac", "error", { error: "store unavailable" }))
    expect(screen.getByText("error")).toBeTruthy()
    expect(screen.getByText("store unavailable").className).toContain("text-destructive")
  })

  it("says a lane behind a failed one did not run", () => {
    row(lane("abac", "notEvaluated"))
    expect(screen.getByText("not evaluated")).toBeTruthy()
    expect(screen.getByText("An earlier model failed, so this one did not run.")).toBeTruthy()
  })

  it("marks the deciding lane, and only that one", () => {
    const { unmount } = row(RBAC_ALLOW, true)
    expect(screen.getByText("decided it")).toBeTruthy()
    unmount()
    row(RBAC_ALLOW, false)
    expect(screen.queryByText("decided it")).toBeNull()
  })
})
