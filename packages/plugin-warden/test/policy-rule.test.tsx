import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import {
  PolicyRule,
  conditionNote,
  subjectText,
  type ConditionProblem,
  type ConditionReason,
  type PolicyConditionView,
  type PolicyDetail,
} from "../src/components/policy-rule"

const RULE: PolicyDetail = {
  id: "pol_01",
  namespacePath: "",
  name: "office-only",
  description: "",
  effect: "deny",
  priority: 10,
  isActive: true,
  state: "active",
  failsClosed: false,
  neverApplies: false,
  matchesEverything: false,
  version: 3,
  updatedAt: "2026-09-02T00:00:00Z",
  subjects: [{ role: "contractor" }, { kind: "user", id: "usr_2f8a" }],
  actions: ["document:delete"],
  resources: ["document:*"],
  conditions: [
    {
      id: "c1",
      field: "context.ip",
      operator: "not_in",
      value: ["10.0.0.0/8"],
    },
    { id: "c2", field: "subject.mfa", operator: "exists" },
  ],
  obligations: ["notify-security"],
  notBefore: "2026-06-01T00:00:00Z",
  notAfter: "2026-06-30T00:00:00Z",
  subjectsUnrestricted: false,
  actionsUnrestricted: false,
  resourcesUnrestricted: false,
  hasRoleMatcher: true,
  createdBy: "usr_admin",
  updatedBy: "usr_ops",
  createdAt: "2026-09-01T00:00:00Z",
}

function ruleOf(over: Partial<PolicyDetail>): PolicyDetail {
  return { ...RULE, ...over }
}

function show(over: Partial<PolicyDetail> = {}) {
  return render(<PolicyRule policy={ruleOf(over)} />)
}

const row = (container: HTMLElement, name: string) =>
  container.querySelector<HTMLElement>(`[data-row="${name}"]`)!
const conditionRow = (container: HTMLElement, i: number) =>
  container.querySelector<HTMLElement>(`[data-condition="${i}"]`)!
const chipsIn = (el: HTMLElement) =>
  Array.from(el.querySelectorAll('[data-slot="badge"]'))
/** The row's line: field, operator and value, as separate texts. */
const lineOf = (el: HTMLElement) =>
  Array.from(el.firstElementChild!.children).map((c) => c.textContent)
const noteOf = (el: HTMLElement) => el.querySelector("p")?.textContent ?? null

/** A class token that paints destructive colour unconditionally, not behind a variant like aria-invalid:. */
function destructiveElements(root: ParentNode): Element[] {
  return Array.from(root.querySelectorAll("[class]")).filter((el) =>
    (el.getAttribute("class") ?? "")
      .split(/\s+/)
      .some((t) => !t.includes(":") && t.includes("destructive"))
  )
}

describe("PolicyRule", () => {
  describe("the heading", () => {
    it("reads Deny in the destructive colour for a deny", () => {
      show({ effect: "deny" })
      const h = screen.getByRole("heading", { name: "Deny" })
      expect(h.className.split(" ")).toContain("text-destructive")
    })

    it("reads Allow in the foreground colour, with no destructive class", () => {
      const { container } = show({ effect: "allow" })
      const h = screen.getByRole("heading", { name: "Allow" })
      expect(h.className.split(" ")).toContain("text-foreground")
      expect(destructiveElements(container)).toEqual([])
    })

    it("colours only the Deny heading and nothing else in the block", () => {
      const { container } = show({
        effect: "deny",
        conditions: [
          {
            field: "context.ip",
            operator: "bogus",
            problem: "throws",
            reason: "unknownOperator",
          },
        ],
        failsClosed: true,
        decidingCondition: 0,
      })
      expect(destructiveElements(container)).toEqual([
        screen.getByRole("heading", { name: "Deny" }),
      ])
    })

    it("reads Deny for any effect but exactly allow, as the evaluator treats it", () => {
      show({ effect: "block" })
      expect(screen.getByRole("heading", { name: "Deny" })).toBeTruthy()
    })
  })

  describe("unrestricted matchers", () => {
    it("reads each empty list as its any-word, with no chip and no note", () => {
      const { container } = show({
        subjects: [],
        actions: [],
        resources: [],
        subjectsUnrestricted: true,
        actionsUnrestricted: true,
        resourcesUnrestricted: true,
      })
      for (const [name, word] of [
        ["subject", "anyone"],
        ["action", "any action"],
        ["resource", "any resource"],
      ]) {
        const el = row(container, name)
        expect(el.textContent).toBe(word)
        expect(chipsIn(el)).toEqual([])
        expect(el.querySelector("p")).toBeNull()
        // Muted plain text, never monospace, so it cannot pass for a value.
        const span = el.firstElementChild!
        expect(span.className).toContain("text-muted-foreground")
        expect(span.className).not.toContain("font-mono")
      }
    })

    it("reads a subject list holding an empty matcher as anyone, and says why", () => {
      const { container } = show({
        subjects: [{ role: "editor" }, {}],
        subjectsUnrestricted: true,
      })
      const el = row(container, "subject")
      expect(el.firstElementChild!.textContent).toBe("anyone")
      expect(chipsIn(el)).toEqual([])
      expect(noteOf(el)).toBe(
        "One of its subject matchers is empty, which matches every subject."
      )
    })

    it("reads a *:* action as any action, never a chip, and names the entry", () => {
      const { container } = show({
        actions: ["document:read", "*:*"],
        actionsUnrestricted: true,
      })
      const el = row(container, "action")
      expect(el.firstElementChild!.textContent).toBe("any action")
      expect(chipsIn(el)).toEqual([])
      expect(noteOf(el)).toBe("*:* matches every action.")
    })

    it("reads a * resource as any resource, and names the entry", () => {
      const { container } = show({
        resources: ["*"],
        resourcesUnrestricted: true,
      })
      const el = row(container, "resource")
      expect(el.firstElementChild!.textContent).toBe("any resource")
      expect(chipsIn(el)).toEqual([])
      expect(noteOf(el)).toBe("* matches every resource.")
    })

    it("takes unrestrictedness from the server's flag, not from the list", () => {
      // A pattern the page might think is a wildcard, with the flag false:
      // the chip shows and no any-word does.
      const { container } = show({
        actions: ["*.*"],
        actionsUnrestricted: false,
      })
      const el = row(container, "action")
      expect(chipsIn(el).map((c) => c.textContent)).toEqual(["*.*"])
      expect(el.textContent).not.toContain("any action")
    })
  })

  describe("chips", () => {
    it("puts a muted or between chips", () => {
      const { container } = show({ actions: ["a:read", "b:read", "c:read"] })
      const line = row(container, "action").firstElementChild!
      expect(Array.from(line.children).map((c) => c.textContent)).toEqual([
        "a:read",
        "or",
        "b:read",
        "or",
        "c:read",
      ])
      const or = line.children[1]
      expect(or.className).toContain("text-muted-foreground")
    })

    it("sets each chip in monospace", () => {
      const { container } = show()
      for (const chip of chipsIn(row(container, "subject"))) {
        expect(chip.className).toContain("font-mono")
        expect(chip.className).toContain("text-xs")
      }
    })

    it("reads each subject shape as its AND-ed parts", () => {
      expect(subjectText({ kind: "user", id: "u1" })).toBe("user: u1")
      expect(subjectText({ kind: "user" })).toBe("any user")
      expect(subjectText({ role: "editor" })).toBe("role: editor")
      expect(subjectText({ kind: "user", role: "editor" })).toBe(
        "user with role editor"
      )
      expect(subjectText({ id: "u1" })).toBe("id: u1")
      expect(subjectText({ kind: "user", id: "u1", role: "editor" })).toBe(
        "user: u1 with role editor"
      )
    })

    it("renders the subject chips it is sent, joined by or", () => {
      const { container } = show({
        subjects: [
          { kind: "user", id: "u1" },
          { kind: "user" },
          { role: "editor" },
          { kind: "user", role: "editor" },
        ],
      })
      const line = row(container, "subject").firstElementChild!
      expect(Array.from(line.children).map((c) => c.textContent)).toEqual([
        "user: u1",
        "or",
        "any user",
        "or",
        "role: editor",
        "or",
        "user with role editor",
      ])
    })
  })

  describe("conditions", () => {
    it("labels the first when and every one after it and, in that order", () => {
      const { container } = show({
        conditions: [
          { field: "a.x", operator: "eq", value: "1" },
          { field: "b.x", operator: "eq", value: "2" },
          { field: "c.x", operator: "eq", value: "3" },
        ],
      })
      expect(
        Array.from(container.querySelectorAll("dt")).map((d) => d.textContent)
      ).toEqual([
        "subject",
        "action",
        "resource",
        "when",
        "and",
        "and",
        "in effect",
        "emits",
      ])
    })

    const OPERATORS: [string, string, unknown, string | null][] = [
      ["eq", "equals", "eng", "eng"],
      ["neq", "does not equal", "eng", "eng"],
      ["in", "in", ["a", "b"], "[a, b]"],
      ["not_in", "not in", ["10.0.0.0/8"], "[10.0.0.0/8]"],
      ["contains", "contains", "ops", "ops"],
      ["starts_with", "starts with", "ops", "ops"],
      ["ends_with", "ends with", "ops", "ops"],
      ["gt", "greater than", 5, "5"],
      ["lt", "less than", 5, "5"],
      ["gte", "at least", 5, "5"],
      ["lte", "at most", 5, "5"],
      ["exists", "exists", undefined, null],
      ["not_exists", "does not exist", undefined, null],
      ["ip_in_cidr", "in network", "10.0.0.0/8", "10.0.0.0/8"],
      ["time_after", "after", "2026-06-01T00:00:00Z", "2026-06-01T00:00:00Z"],
      ["time_before", "before", "2026-06-01T00:00:00Z", "2026-06-01T00:00:00Z"],
      ["regex", "matches", "^a", "^a"],
    ]

    it("covers all seventeen operators", () => {
      expect(OPERATORS.length).toBe(17)
    })

    for (const [op, word, value, shown] of OPERATORS) {
      it(`reads ${op} as "${word}"${shown === null ? ", with no value" : ""}`, () => {
        const { container } = show({
          conditions: [{ field: "subject.dept", operator: op, value }],
        })
        const el = conditionRow(container, 0)
        expect(lineOf(el)).toEqual(
          shown === null
            ? ["subject.dept", word]
            : ["subject.dept", word, shown]
        )
      })
    }

    it("renders no value for exists even when one is stored", () => {
      const { container } = show({
        conditions: [
          { field: "subject.mfa", operator: "exists", value: "yes" },
        ],
      })
      expect(lineOf(conditionRow(container, 0))).toEqual([
        "subject.mfa",
        "exists",
      ])
    })

    it("sets field and value in monospace and the operator in words", () => {
      const { container } = show()
      const [field, op, value] = Array.from(
        conditionRow(container, 0).firstElementChild!.children
      )
      expect(field.className).toContain("font-mono")
      expect(value.className).toContain("font-mono")
      expect(op.className).not.toContain("font-mono")
    })

    it("keeps a list's brackets, so a list of one never reads as a single value", () => {
      const { container } = show({
        conditions: [
          { field: "context.ip", operator: "not_in", value: "10.0.0.0/8" },
          { field: "context.ip", operator: "not_in", value: ["10.0.0.0/8"] },
          { field: "context.ip", operator: "in", value: [] },
        ],
      })
      expect(lineOf(conditionRow(container, 0))[2]).toBe("10.0.0.0/8")
      expect(lineOf(conditionRow(container, 1))[2]).toBe("[10.0.0.0/8]")
      expect(lineOf(conditionRow(container, 2))[2]).toBe("[]")
    })

    it("shows an empty string value as a pair of quotes rather than nothing", () => {
      const { container } = show({
        conditions: [
          { field: "context.ip", operator: "starts_with", value: "" },
        ],
      })
      expect(lineOf(conditionRow(container, 0))[2]).toBe('""')
    })

    it("labels an absent value as none", () => {
      render(
        <PolicyRule
          policy={ruleOf({
            conditions: [{ field: "subject.dept", operator: "eq" }],
          })}
        />
      )
      expect(screen.getByLabelText("no value")).toBeTruthy()
    })
  })

  describe("condition notes", () => {
    const NOTES: [
      ConditionProblem,
      ConditionReason,
      string,
      unknown,
      string,
    ][] = [
      [
        "throws",
        "unknownOperator",
        "context.ip",
        "x",
        "This is not an operator warden knows, so it cannot be evaluated.",
      ],
      [
        "throws",
        "invalidRegex",
        "subject.email",
        "(",
        "This pattern does not compile, so it cannot be evaluated.",
      ],
      [
        "throws",
        "notAList",
        "context.ip",
        "10.0.0.0/8",
        "This needs a list of values, not one, so it cannot be evaluated.",
      ],
      // An older warden, which read a non-list as an empty list, sends these two.
      [
        "alwaysTrue",
        "matchesAnything",
        "context.ip",
        "",
        "This is always true, so it restricts nothing. This value matches every string.",
      ],
      [
        "alwaysTrue",
        "alwaysPresent",
        "subject.id",
        undefined,
        "This is always true, so it restricts nothing. Warden always gives subject.id a value, even an empty one.",
      ],
      [
        "alwaysFalse",
        "alwaysPresent",
        "subject.id",
        undefined,
        "This is always false. Warden always gives subject.id a value, even an empty one.",
      ],
      [
        "alwaysTrue",
        "unresolvableField",
        "action.verb",
        "delete",
        "This is always true, so it restricts nothing. Warden never gives action.verb a value.",
      ],
      [
        "alwaysFalse",
        "unresolvableField",
        "action.verb",
        "delete",
        "This is always false. Warden never gives action.verb a value.",
      ],
      [
        "alwaysTrue",
        "notAList",
        "context.ip",
        "10.0.0.0/8",
        "This is always true, so it restricts nothing. It needs a list of values, not one.",
      ],
      [
        "alwaysFalse",
        "notAList",
        "context.ip",
        "10.0.0.0/8",
        "This is always false. It needs a list of values, not one.",
      ],
      [
        "alwaysTrue",
        "emptyList",
        "context.ip",
        [],
        "This is always true, so it restricts nothing. The list is empty.",
      ],
      [
        "alwaysFalse",
        "emptyList",
        "context.ip",
        [],
        "This is always false. The list is empty.",
      ],
      [
        "alwaysFalse",
        "notANumber",
        "subject.level",
        "high",
        "This is always false. It compares numbers, and the value is not one.",
      ],
      [
        "alwaysFalse",
        "noValidCIDR",
        "context.ip",
        "10.0.0/33",
        "This is always false. None of these parse as a network.",
      ],
      [
        "alwaysFalse",
        "notATime",
        "context.at",
        "2026-06-01",
        "This is always false. The value is not an RFC3339 time.",
      ],
    ]

    for (const [problem, reason, field, value, text] of NOTES) {
      it(`${problem} / ${reason} reads its exact note under its row`, () => {
        const { container } = show({
          conditions: [{ field, operator: "eq", value, problem, reason }],
        })
        expect(noteOf(conditionRow(container, 0))).toBe(text)
        expect(conditionNote(problem, reason, field)).toBe(text)
      })
    }

    it("has no note for a condition that depends on the check", () => {
      const { container } = show()
      expect(noteOf(conditionRow(container, 0))).toBeNull()
      expect(conditionNote(undefined, undefined, "context.ip")).toBeNull()
    })

    it("puts each note under its own row and no other", () => {
      const conditions: PolicyConditionView[] = [
        { field: "subject.dept", operator: "eq", value: "eng" },
        {
          field: "context.ip",
          operator: "in",
          value: "10.0.0.0/8",
          problem: "throws",
          reason: "notAList",
        },
        { field: "subject.level", operator: "gt", value: 3 },
      ]
      const { container } = show({ conditions })
      const marked = conditionRow(container, 1)
      expect(lineOf(marked)[0]).toBe("context.ip")
      expect(noteOf(marked)).toBe(
        "This needs a list of values, not one, so it cannot be evaluated."
      )
      expect(noteOf(conditionRow(container, 0))).toBeNull()
      expect(noteOf(conditionRow(container, 2))).toBeNull()
    })

    it("keeps the reason for a list value, trusting the server's analysis", () => {
      // The mongo store hands the engine plain values now, so the server
      // never marks a real list notAList. The page does not second-guess it.
      const { container } = show({
        conditions: [
          {
            field: "context.ip",
            operator: "in",
            value: ["10.0.0.0/8"],
            problem: "alwaysFalse",
            reason: "notAList",
          },
        ],
      })
      expect(noteOf(conditionRow(container, 0))).toBe(
        "This is always false. It needs a list of values, not one."
      )
    })

    it("shows the empty field as quotes in a note", () => {
      expect(conditionNote("alwaysFalse", "unresolvableField", "")).toBe(
        'This is always false. Warden never gives "" a value.'
      )
    })
  })

  describe("the deciding condition", () => {
    it("marks the row the server names, and only that row", () => {
      const { container } = show({
        failsClosed: true,
        decidingCondition: 1,
        conditions: [
          { field: "subject.dept", operator: "eq", value: "eng" },
          {
            field: "context.ip",
            operator: "bogus",
            value: "x",
            problem: "throws",
            reason: "unknownOperator",
          },
        ],
      })
      expect(conditionRow(container, 1).getAttribute("data-deciding")).toBe(
        "true"
      )
      expect(conditionRow(container, 1).textContent).toContain("condition 2")
      expect(
        conditionRow(container, 0).getAttribute("data-deciding")
      ).toBeNull()
      expect(conditionRow(container, 0).textContent).not.toContain("condition")
    })
  })

  describe("the window and obligations", () => {
    it("reads a full window as from X until Y, in UTC", () => {
      const { container } = show()
      expect(row(container, "window").textContent).toBe(
        "from 1 Jun 2026, 00:00 UTC until 30 Jun 2026, 00:00 UTC"
      )
    })

    it("reads an open end as from X, and an open start as until Y", () => {
      const a = show({ notAfter: undefined })
      expect(row(a.container, "window").textContent).toBe(
        "from 1 Jun 2026, 00:00 UTC"
      )
      a.unmount()
      const b = show({ notBefore: undefined, notAfter: "2026-06-30T12:30:15Z" })
      expect(row(b.container, "window").textContent).toBe(
        "until 30 Jun 2026, 12:30:15 UTC"
      )
    })

    it("omits in effect when there is no window", () => {
      const { container } = show({ notBefore: undefined, notAfter: undefined })
      expect(row(container, "window")).toBeNull()
      expect(screen.queryByText("in effect")).toBeNull()
    })

    it("emits each obligation as a chip", () => {
      const { container } = show({ obligations: ["notify-security", "log"] })
      expect(
        chipsIn(row(container, "emits")).map((c) => c.textContent)
      ).toEqual(["notify-security", "log"])
    })

    it("omits emits when there are none", () => {
      const { container } = show({ obligations: [] })
      expect(row(container, "emits")).toBeNull()
      expect(screen.queryByText("emits")).toBeNull()
    })
  })

  describe("visual weight", () => {
    const block = (container: HTMLElement) =>
      container.querySelector("section")!

    for (const state of [
      "inactive",
      "scheduled",
      "expired",
      "never",
    ] as const) {
      it(`dims the block for ${state}`, () => {
        const { container } = show({ state, isActive: state !== "inactive" })
        expect(block(container).className).toContain("opacity-60")
      })
    }

    it("dims the block for a policy that never applies", () => {
      const { container } = show({ neverApplies: true, decidingCondition: 0 })
      expect(block(container).className).toContain("opacity-60")
    })

    it("does not dim an active policy that behaves as written", () => {
      const { container } = show()
      expect(block(container).className).not.toContain("opacity")
    })

    it("dims even an active fail-closed deny while policy evaluation is off", () => {
      const { container } = render(
        <PolicyRule
          policy={ruleOf({ failsClosed: true, decidingCondition: 0 })}
          evaluationOff
        />
      )
      expect(block(container).className).toContain("opacity-60")
    })

    it("never dims an active deny that fails closed", () => {
      const { container } = show({ failsClosed: true, decidingCondition: 0 })
      expect(block(container).className).not.toContain("opacity")
    })

    for (const state of [
      "inactive",
      "scheduled",
      "expired",
      "never",
    ] as const) {
      it(`dims a fail-closed deny that is ${state}, since it has no effect now`, () => {
        const { container } = show({
          failsClosed: true,
          decidingCondition: 0,
          state,
          isActive: state !== "inactive",
        })
        expect(block(container).className).toContain("opacity-60")
      })
    }
  })
})
