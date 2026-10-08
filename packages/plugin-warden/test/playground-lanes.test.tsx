import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import {
  LaneRow,
  decidingLane,
  decidingLaneOnlyGaveReason,
  verdictSentence,
  type LaneState,
  type PlaygroundInput,
  type PlaygroundLane,
  type PlaygroundResult,
} from "../src/components/playground-lanes"

const RBAC_MATCH = [
  { source: "rbac", ruleId: "role_01hq", detail: "role grants document:read" },
]
const ABAC_ALLOW_MATCH = [
  {
    source: "abac",
    ruleId: "wpol_staff-read",
    detail: 'policy "staff-read" (allow)',
  },
]
const ABAC_DENY_MATCH = [
  { source: "abac", ruleId: "wpol_lockout", detail: 'policy "lockout" (deny)' },
]
const REBAC_MATCH = [{ source: "rebac", detail: "direct relation" }]

function lane(
  model: PlaygroundLane["model"],
  state: LaneState,
  over: Partial<PlaygroundLane> = {}
): PlaygroundLane {
  return { model, state, matchedBy: [], ...over }
}

/** A plain no-match lane the way each model reports one. */
const NO_RBAC = lane("rbac", "noMatch", {
  decision: "deny_no_roles",
  reason: "no roles",
})
const NO_REBAC = lane("rebac", "noMatch", {
  decision: "deny_relation",
  reason: "no relation",
})
const NO_ABAC = lane("abac", "noMatch")

const RBAC_ALLOW = lane("rbac", "allow", {
  decision: "allow",
  matchedBy: RBAC_MATCH,
})
const REBAC_ALLOW = lane("rebac", "allow", {
  decision: "allow",
  matchedBy: REBAC_MATCH,
})
const ABAC_ALLOW = lane("abac", "allow", {
  decision: "allow",
  matchedBy: ABAC_ALLOW_MATCH,
})
const ABAC_DENY = lane("abac", "deny", {
  decision: "deny_explicit",
  reason: 'denied by policy "lockout"',
  matchedBy: ABAC_DENY_MATCH,
})

function result(
  decision: string,
  lanes: PlaygroundLane[],
  over: Partial<PlaygroundResult> = {}
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
    expect(
      decidingLane(
        result("deny_explicit", [
          RBAC_ALLOW,
          lane("rebac", "skipped"),
          ABAC_DENY,
        ])
      )
    ).toBe("abac")
  })

  it("gives the first allowing lane in order rbac, rebac, abac", () => {
    expect(
      decidingLane(result("allow", [RBAC_ALLOW, REBAC_ALLOW, ABAC_ALLOW]))
    ).toBe("rbac")
    expect(
      decidingLane(result("allow", [NO_RBAC, REBAC_ALLOW, ABAC_ALLOW]))
    ).toBe("rebac")
    expect(decidingLane(result("allow", [NO_RBAC, NO_REBAC, ABAC_ALLOW]))).toBe(
      "abac"
    )
  })

  it("gives, for any other denial, the first lane in order whose reason is non-empty", () => {
    const noAbacReason = lane("abac", "noMatch")
    expect(
      decidingLane(result("deny_no_roles", [NO_RBAC, NO_REBAC, noAbacReason]))
    ).toBe("rbac")
    // RBAC has nothing to say (disabled), so the first reason is ReBAC's.
    expect(
      decidingLane(
        result("deny_relation", [lane("rbac", "disabled"), NO_REBAC, NO_ABAC])
      )
    ).toBe("rebac")
    // Only ABAC gave a reason.
    expect(
      decidingLane(
        result("deny_condition", [
          lane("rbac", "disabled"),
          lane("rebac", "disabled"),
          lane("abac", "noMatch", { reason: "condition failed" }),
        ])
      )
    ).toBe("abac")
  })

  it("gives null for an error", () => {
    expect(
      decidingLane(
        result(
          "error",
          [
            lane("rbac", "error", { error: "store down" }),
            lane("rebac", "notEvaluated"),
            lane("abac", "notEvaluated"),
          ],
          { error: "warden rbac: store down" }
        )
      )
    ).toBeNull()
  })

  it("gives null for a denial no lane gave a reason for (deny_default)", () => {
    expect(
      decidingLane(
        result("deny_default", [
          lane("rbac", "disabled"),
          lane("rebac", "disabled"),
          lane("abac", "noMatch"),
        ])
      )
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
            : lane(m, "noMatch", { reason: "x" })
      ),
      { error: "warden: store down" }
    )
  }

  it("names the model that failed, in its own casing", () => {
    expect(verdictSentence(failed(0))).toBe(
      "The RBAC model failed, so no decision was returned."
    )
    expect(verdictSentence(failed(1))).toBe(
      "The ReBAC model failed, so no decision was returned."
    )
    expect(verdictSentence(failed(2))).toBe(
      "The ABAC model failed, so no decision was returned."
    )
  })

  it("says an explicit deny overrides the first allowing model", () => {
    expect(
      verdictSentence(
        result("deny_explicit", [
          RBAC_ALLOW,
          lane("rebac", "skipped"),
          ABAC_DENY,
        ])
      )
    ).toBe("An explicit deny overrides the RBAC allow.")
    expect(
      verdictSentence(
        result("deny_explicit", [NO_RBAC, REBAC_ALLOW, ABAC_DENY])
      )
    ).toBe("An explicit deny overrides the ReBAC allow.")
    // Both allowed (evaluate all models): the first one is named.
    expect(
      verdictSentence(
        result("deny_explicit", [RBAC_ALLOW, REBAC_ALLOW, ABAC_DENY])
      )
    ).toBe("An explicit deny overrides the RBAC allow.")
  })

  it("says a deny policy matched when nothing else allowed", () => {
    expect(
      verdictSentence(result("deny_explicit", [NO_RBAC, NO_REBAC, ABAC_DENY]))
    ).toBe("A deny policy matched.")
  })

  it("says which model allowed, and that no deny policy matched, when policy evaluation is on", () => {
    expect(
      verdictSentence(
        result("allow", [RBAC_ALLOW, lane("rebac", "skipped"), NO_ABAC])
      )
    ).toBe("RBAC allowed this check, and no deny policy matched.")
    expect(
      verdictSentence(result("allow", [NO_RBAC, REBAC_ALLOW, NO_ABAC]))
    ).toBe("ReBAC allowed this check, and no deny policy matched.")
    expect(
      verdictSentence(result("allow", [NO_RBAC, NO_REBAC, ABAC_ALLOW]))
    ).toBe("ABAC allowed this check, and no deny policy matched.")
  })

  it("says policy evaluation is off when the ABAC lane is disabled", () => {
    expect(
      verdictSentence(
        result("allow", [
          RBAC_ALLOW,
          lane("rebac", "skipped"),
          lane("abac", "disabled"),
        ])
      )
    ).toBe(
      "RBAC allowed this check. Policy evaluation is off, so no deny policy could override it."
    )
  })

  it("says no model allowed for every other denial", () => {
    expect(
      verdictSentence(result("deny_no_roles", [NO_RBAC, NO_REBAC, NO_ABAC]))
    ).toBe("No model allowed this check.")
    expect(
      verdictSentence(
        result("deny_default", [
          lane("rbac", "disabled"),
          lane("rebac", "disabled"),
          NO_ABAC,
        ])
      )
    ).toBe("No model allowed this check.")
  })

  it("appends the truncated walk note when the ReBAC lane stopped at its limit", () => {
    const note =
      "The relation walk stopped at its limit, so a relation may exist beyond it."
    const truncated = lane("rebac", "noMatch", {
      reason: "no relation",
      walkTruncated: true,
    })
    expect(
      verdictSentence(result("deny_no_roles", [NO_RBAC, truncated, NO_ABAC]))
    ).toBe(`No model allowed this check. ${note}`)
    expect(
      verdictSentence(result("allow", [RBAC_ALLOW, truncated, NO_ABAC]))
    ).toBe(`RBAC allowed this check, and no deny policy matched. ${note}`)
  })

  it("appends the expression failure note when the ReBAC lane's expression failed", () => {
    const note =
      "The resource type's permission expression failed, so it was treated as no match."
    const broken = lane("rebac", "noMatch", {
      reason: "no relation",
      expressionError: "boom",
    })
    expect(
      verdictSentence(result("deny_no_roles", [NO_RBAC, broken, NO_ABAC]))
    ).toBe(`No model allowed this check. ${note}`)
  })

  it("says the relation walk decided when the ReBAC lane allowed despite a failed expression", () => {
    const allowed = lane("rebac", "allow", {
      decision: "allow",
      matchedBy: REBAC_MATCH,
      expressionError: "boom",
    })
    expect(verdictSentence(result("allow", [NO_RBAC, allowed, NO_ABAC]))).toBe(
      "ReBAC allowed this check, and no deny policy matched. The resource type's permission expression failed, so ReBAC's allow came from the relation walk."
    )
  })

  it("keeps the treated-as-no-match wording when the ReBAC lane did not allow", () => {
    const broken = lane("rebac", "noMatch", {
      reason: "no relation",
      expressionError: "boom",
    })
    // An allow from another model, with ReBAC's expression failed and no match.
    expect(
      verdictSentence(result("allow", [RBAC_ALLOW, broken, NO_ABAC]))
    ).toBe(
      "RBAC allowed this check, and no deny policy matched. The resource type's permission expression failed, so it was treated as no match."
    )
  })

  it("appends both notes, the walk first", () => {
    const both = lane("rebac", "noMatch", {
      reason: "no relation",
      walkTruncated: true,
      expressionError: "boom",
    })
    expect(
      verdictSentence(result("deny_no_roles", [NO_RBAC, both, NO_ABAC]))
    ).toBe(
      "No model allowed this check. The relation walk stopped at its limit, so a relation may exist beyond it. The resource type's permission expression failed, so it was treated as no match."
    )
  })
})

describe("decidingLaneOnlyGaveReason", () => {
  it("is false for an allow and an explicit deny, true for any other denial", () => {
    expect(
      decidingLaneOnlyGaveReason(
        result("allow", [RBAC_ALLOW, NO_REBAC, NO_ABAC])
      )
    ).toBe(false)
    expect(
      decidingLaneOnlyGaveReason(
        result("deny_explicit", [RBAC_ALLOW, NO_REBAC, ABAC_DENY])
      )
    ).toBe(false)
    for (const d of [
      "deny_no_roles",
      "deny_no_perms",
      "deny_relation",
      "deny_default",
      "deny",
    ]) {
      expect(
        decidingLaneOnlyGaveReason(result(d, [NO_RBAC, NO_REBAC, NO_ABAC]))
      ).toBe(true)
    }
  })
})

describe("LaneRow", () => {
  function row(l: PlaygroundLane, deciding = false, reasonOnly = false) {
    return render(
      <LaneRow lane={l} deciding={deciding} reasonOnly={reasonOnly} />
    )
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
    const link = screen.getByRole("link", {
      name: 'policy "staff-read" (allow)',
    })
    expect(link.getAttribute("href")).toBe("/policies/wpol_staff-read")
  })

  it("shows a rebac allow's match as plain text, never a link", () => {
    row(REBAC_ALLOW)
    expect(screen.getByText("direct relation")).toBeTruthy()
    expect(screen.queryByRole("link")).toBeNull()
  })

  it("falls back to the rule id for a linked match with no detail", () => {
    row(
      lane("rbac", "allow", {
        matchedBy: [{ source: "rbac", ruleId: "role_01hq" }],
      })
    )
    expect(
      screen.getByRole("link", { name: "role_01hq" }).getAttribute("href")
    ).toBe("/roles/role_01hq")
  })

  it("shows a deny in destructive text, with the policy link", () => {
    row(ABAC_DENY)
    expect(screen.getByText("deny").className).toContain("text-destructive")
    expect(
      screen
        .getByRole("link", { name: 'policy "lockout" (deny)' })
        .getAttribute("href")
    ).toBe("/policies/wpol_lockout")
  })

  it("shows no match with the reason when there is one", () => {
    row(NO_RBAC)
    expect(screen.getByText("no match")).toBeTruthy()
    expect(screen.getByText("no roles")).toBeTruthy()
  })

  it("says No policy applied for an abac no match with no reason", () => {
    row(NO_ABAC)
    expect(screen.getByText("no match")).toBeTruthy()
    expect(screen.getByText("No policy applied.")).toBeTruthy()
    // An allow policy whose condition threw is skipped too, so "matched" would be wrong.
    expect(screen.queryByText("No policy matched.")).toBeNull()
  })

  it("does not say No policy applied for another model's no match", () => {
    row(lane("rebac", "noMatch"))
    expect(screen.queryByText("No policy applied.")).toBeNull()
  })

  it("says why a lane was skipped", () => {
    row(lane("rebac", "skipped"))
    expect(screen.getByText("skipped")).toBeTruthy()
    expect(
      screen.getByText("RBAC already allowed, so ReBAC did not run.")
    ).toBeTruthy()
  })

  it("says a disabled lane is turned off in the config", () => {
    row(lane("abac", "disabled"))
    expect(screen.getByText("disabled")).toBeTruthy()
    expect(screen.getByText("Turned off in warden's config.")).toBeTruthy()
  })

  it("shows an error lane's error in destructive text", () => {
    row(lane("rbac", "error", { error: "store unavailable" }))
    expect(screen.getByText("error")).toBeTruthy()
    expect(screen.getByText("store unavailable").className).toContain(
      "text-destructive"
    )
  })

  it("says a lane behind a failed one did not run", () => {
    row(lane("abac", "notEvaluated"))
    expect(screen.getByText("not evaluated")).toBeTruthy()
    expect(
      screen.getByText("An earlier model failed, so this one did not run.")
    ).toBeTruthy()
  })

  it("marks the deciding lane, and only that one", () => {
    const { unmount } = row(RBAC_ALLOW, true)
    expect(screen.getByText("decided it")).toBeTruthy()
    unmount()
    row(RBAC_ALLOW, false)
    expect(screen.queryByText("decided it")).toBeNull()
  })

  it("gives the deciding lane a left rule in the foreground colour, and no other lane", () => {
    const { container, unmount } = row(RBAC_ALLOW, true)
    const li = container.querySelector("li")!
    expect(li.getAttribute("data-deciding")).toBe("true")
    expect(li.className).toContain("border-l-2")
    expect(li.className).toContain("border-l-foreground")
    unmount()
    const other = row(RBAC_ALLOW, false).container.querySelector("li")!
    expect(other.getAttribute("data-deciding")).toBeNull()
    expect(other.className).not.toContain("border-l-foreground")
  })

  it("says the deciding lane gave the reason when the denial was not its decision", () => {
    row(NO_RBAC, true, true)
    expect(screen.getByText("gave the reason")).toBeTruthy()
    expect(screen.queryByText("decided it")).toBeNull()
  })
})

describe("the walk link on a ReBAC lane", () => {
  const LINK = "Show this walk in the graph"
  const CHECK: PlaygroundInput = {
    subjectKind: "user",
    subjectId: "erin",
    action: "editor",
    resourceType: "document",
    resourceId: "readme",
    namespacePath: "",
  }
  const transitive = lane("rebac", "allow", {
    decision: "allow",
    matchedBy: [
      {
        source: "rebac",
        detail:
          "transitive: document:readme#editor -> group:eng#member -> user:erin",
      },
    ],
  })

  // null is "no check", since passing undefined would take the default.
  function row(l: PlaygroundLane, input: PlaygroundInput | null = CHECK) {
    return render(
      <LaneRow lane={l} deciding={false} input={input ?? undefined} />
    )
  }

  it("links a transitive allow to the path route for this check", () => {
    row(transitive)
    expect(screen.getByRole("link", { name: LINK }).getAttribute("href")).toBe(
      "/relations/graph/document/readme/editor/to/user/erin"
    )
  })

  it("carries the check's namespace when it is not the root", () => {
    row(transitive, { ...CHECK, namespacePath: "eng/platform" })
    expect(screen.getByRole("link", { name: LINK }).getAttribute("href")).toBe(
      "/relations/graph/document/readme/editor/to/user/erin/in/eng%2Fplatform"
    )
  })

  it("is absent for a direct relation", () => {
    row(lane("rebac", "allow", { decision: "allow", matchedBy: REBAC_MATCH }))
    expect(screen.queryByRole("link", { name: LINK })).toBeNull()
  })

  it("is absent for an allow through the resource type's expression", () => {
    row(
      lane("rebac", "allow", {
        decision: "allow",
        matchedBy: [{ source: "rebac", detail: "expression: read" }],
      })
    )
    expect(screen.queryByRole("link", { name: LINK })).toBeNull()
  })

  it("is absent on a lane that is not ReBAC, whatever its detail says", () => {
    row(
      lane("rbac", "allow", {
        decision: "allow",
        matchedBy: [{ source: "rbac", detail: "transitive: a -> b" }],
      })
    )
    expect(screen.queryByRole("link", { name: LINK })).toBeNull()
  })

  it("is absent unless the ReBAC lane allowed", () => {
    row(
      lane("rebac", "deny", {
        decision: "deny_relation",
        matchedBy: transitive.matchedBy,
      })
    )
    expect(screen.queryByRole("link", { name: LINK })).toBeNull()
    row(
      lane("rebac", "noMatch", {
        reason: "no relation",
        matchedBy: transitive.matchedBy,
      })
    )
    expect(screen.queryByRole("link", { name: LINK })).toBeNull()
  })

  it("is absent without a resource id, which the path route has no segment for", () => {
    row(transitive, { ...CHECK, resourceId: "" })
    expect(screen.queryByRole("link", { name: LINK })).toBeNull()
    row(transitive, { ...CHECK, resourceId: undefined })
    expect(screen.queryByRole("link", { name: LINK })).toBeNull()
  })

  it("is absent when the row is not told which check it belongs to", () => {
    row(transitive, null)
    expect(screen.queryByRole("link", { name: LINK })).toBeNull()
  })
})
