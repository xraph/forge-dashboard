import { describe, expect, it, vi } from "vitest"
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import {
  ContractError,
  NavigationProvider,
  PluginProvider,
  queryStore,
} from "@forge-go/dashboard-plugin"
import type { ScopedClient } from "@forge-go/dashboard-plugin"
import { FlagDetailPage } from "../src/pages/flag-detail"
import { stubClient } from "./harness"

if (typeof window.PointerEvent === "undefined") {
  class PointerEventShim extends MouseEvent {}
  Object.defineProperty(window, "PointerEvent", { value: PointerEventShim })
}

const KEY = "checkout/new-flow"

function flag(over: Record<string, unknown> = {}) {
  return {
    id: "flg_01",
    key: KEY,
    type: "bool",
    defaultValue: false,
    defaultMatchesType: true,
    description: "The new checkout flow",
    tags: [] as string[],
    enabled: true,
    createdAt: "2026-09-20T10:00:00Z",
    updatedAt: "2026-09-23T10:00:00Z",
    ...over,
  }
}

function rule(over: Record<string, unknown> = {}) {
  return {
    id: "rul_1",
    priority: 0,
    type: "when_tenant",
    implemented: true,
    tenantIds: [] as string[],
    userIds: [] as string[],
    percentage: 0,
    returnValue: true,
    returnMatchesType: true,
    ...over,
  }
}

// In the order the engine walks them, which is not the order of `priority`
// alone in general: the page never sorts them.
const RULES = [
  rule({ id: "rul_1", priority: 0, type: "when_tenant", tenantIds: ["t-beta"] }),
  rule({ id: "rul_2", priority: 1, type: "when_user", userIds: ["u-1"] }),
  rule({ id: "rul_3", priority: 2, type: "rollout", percentage: 25 }),
  rule({ id: "rul_4", priority: 3, type: "schedule", startAt: "2026-03-01T09:00:00Z" }),
]

const OVERRIDES = [
  { tenantId: "t-acme", value: true, valueMatchesType: true, updatedAt: "2026-09-22T10:00:00Z" },
  { tenantId: "t-globex", value: false, valueMatchesType: true, updatedAt: "2026-09-22T11:00:00Z" },
]

function detail(over: Record<string, unknown> = {}) {
  return {
    flag: flag(),
    variants: [] as unknown[],
    metadata: {} as Record<string, string>,
    rules: RULES,
    overrides: OVERRIDES,
    recentAudit: [] as unknown[],
    cacheTtlSeconds: 30,
    ...over,
  }
}

interface Step {
  matched: boolean
  reached: boolean
  note: string
}

/** A trace over RULES, one step per rule, the way the engine writes it. */
function trace(steps: Step[], rules: { priority: number; type: string }[] = RULES) {
  return steps.map((s, i) => ({
    priority: rules[i]!.priority,
    type: rules[i]!.type,
    ...s,
  }))
}

/** The same trace, each step naming its rule the way a current server does. */
function traceWithIds(steps: Step[], rules: { id: string; priority: number; type: string }[] = RULES) {
  return trace(steps, rules).map((s, i) => ({ ruleId: rules[i]!.id, ...s }))
}

const miss = (note: string): Step => ({ matched: false, reached: true, note })
const hit = (note: string): Step => ({ matched: true, reached: true, note })
const skipped: Step = { matched: false, reached: false, note: "" }

function evaluation(over: Record<string, unknown> = {}) {
  return {
    value: true,
    valueMatchesType: true,
    reason: "default",
    trace: [] as unknown[],
    evaluatedAt: "2026-09-29T10:00:00Z",
    ...over,
  }
}

type Answer = (params: Record<string, unknown>) => unknown

function setup(evaluate: Answer, page: unknown = detail()) {
  const queries: { intent: string; params?: Record<string, unknown> }[] = []
  const inner = stubClient({ "flags.detail": page }, {})
  const client = {
    extension: inner.extension,
    query: async (intent: string, params?: Record<string, unknown>) => {
      queries.push({ intent, params })
      if (intent === "flags.evaluate") {
        const out = evaluate(params ?? {})
        if (out instanceof ContractError) throw out
        return out
      }
      return inner.query(intent, params)
    },
    command: inner.command,
  } as ScopedClient
  const evaluates = () => queries.filter((q) => q.intent === "flags.evaluate")
  render(
    <PluginProvider client={client}>
      <NavigationProvider
        value={{
          Link: ({ to, children, className }) => (
            <a href={to} className={className}>
              {children}
            </a>
          ),
          navigate: vi.fn(),
        }}
      >
        <FlagDetailPage params={{ key: KEY }} />
      </NavigationProvider>
    </PluginProvider>,
  )
  return { queries, evaluates }
}

const rung = (id: string) => document.querySelector(`[data-rung="${id}"]`) as HTMLElement
const rows = (id: string) =>
  Array.from(rung(id).querySelectorAll("ul[role='list'] > li")) as HTMLElement[]
const ready = () => screen.findByRole("heading", { name: KEY })
const tenantInput = () => screen.getByLabelText("Tenant id") as HTMLInputElement
const userInput = () => screen.getByLabelText("User id") as HTMLInputElement

/** The badges a rung itself carries, not the ones on its rows. */
function rungMarks(id: string): string[] {
  const header = rung(id).querySelector('[data-slot="rung-body"] > div') as HTMLElement
  return ["Decided here", "Not reached"].filter((t) => within(header).queryByText(t))
}

function rowMarks(row: HTMLElement): string[] {
  return ["Decided here", "Not reached"].filter((t) => within(row).queryByText(t))
}

async function evaluate(tenant = "", user = "") {
  await ready()
  fireEvent.change(tenantInput(), { target: { value: tenant } })
  fireEvent.change(userInput(), { target: { value: user } })
  fireEvent.click(screen.getByRole("button", { name: "Evaluate" }))
  await waitFor(() => expect(result()).toBeTruthy())
}

const result = () =>
  document.querySelector('[data-slot="evaluation-result"]') as HTMLElement

describe("evaluation bar", () => {
  it("marks nothing and sends no evaluate query until Evaluate is pressed", async () => {
    const { evaluates } = setup(() => evaluation())
    await ready()
    await new Promise((r) => setTimeout(r, 20))
    expect(evaluates()).toHaveLength(0)
    expect(document.querySelector("[data-decided]")).toBeNull()
    expect(screen.queryByText("Decided here")).toBeNull()
    expect(screen.queryByText("Not reached")).toBeNull()
    expect(result()).toBeNull()
  })

  it("sits above rung 1 with both inputs and both buttons", async () => {
    setup(() => evaluation())
    await ready()
    const bar = screen.getByRole("form", { name: "Evaluate as" })
    expect(within(bar).getByLabelText("Tenant id")).toBeTruthy()
    expect(within(bar).getByLabelText("User id")).toBeTruthy()
    expect(within(bar).getByRole("button", { name: "Evaluate" })).toBeTruthy()
    expect(
      bar.compareDocumentPosition(rung("enabled")) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it("sends only the ids that were typed, trimmed", async () => {
    const { evaluates } = setup(() => evaluation())
    await evaluate("  t-acme ", "")
    await waitFor(() => expect(evaluates()).toHaveLength(1))
    expect(evaluates()[0]?.params).toEqual({ key: KEY, tenantId: "t-acme" })
    expect("userId" in (evaluates()[0]?.params ?? {})).toBe(false)
  })

  it("sends only the user when only the user was typed", async () => {
    const { evaluates } = setup(() => evaluation())
    await evaluate("", "u-1")
    expect(evaluates()[0]?.params).toEqual({ key: KEY, userId: "u-1" })
  })

  it("sends both ids when both were typed", async () => {
    const { evaluates } = setup(() => evaluation())
    await evaluate("t-acme", "u-1")
    expect(evaluates()[0]?.params).toEqual({ key: KEY, tenantId: "t-acme", userId: "u-1" })
  })

  it("sends just the key when both inputs are empty", async () => {
    const { evaluates } = setup(() => evaluation())
    await evaluate("", "")
    expect(evaluates()[0]?.params).toEqual({ key: KEY })
  })

  it("evaluates on Enter in an input", async () => {
    const { evaluates } = setup(() => evaluation())
    await ready()
    fireEvent.change(tenantInput(), { target: { value: "t-acme" } })
    fireEvent.submit(screen.getByRole("form", { name: "Evaluate as" }))
    await waitFor(() => expect(result()).toBeTruthy())
    expect(evaluates()).toHaveLength(1)
  })

  it("asks the engine again when Evaluate is pressed again for the same pair", async () => {
    const { evaluates } = setup(() => evaluation())
    await evaluate("t-acme", "")
    fireEvent.click(screen.getByRole("button", { name: "Evaluate" }))
    await waitFor(() => expect(evaluates()).toHaveLength(2))
  })

  it("does not query again, or clear the result, while the inputs are edited", async () => {
    const { evaluates } = setup(() =>
      evaluation({ reason: "tenantOverride", value: true }),
    )
    await evaluate("t-acme", "u-1")
    fireEvent.change(tenantInput(), { target: { value: "t-other" } })
    await new Promise((r) => setTimeout(r, 20))
    expect(evaluates()).toHaveLength(1)
    expect(result().textContent).toContain("for tenant t-acme, user u-1.")
    expect(result().textContent).toContain("Tenant t-acme has an override.")
    expect(rows("overrides")[0]?.getAttribute("data-decided")).toBe("true")
  })

  it("clears every mark, the result and the inputs", async () => {
    setup(() => evaluation({ reason: "disabled" }))
    await evaluate("t-acme", "u-1")
    expect(screen.getAllByText("Not reached").length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole("button", { name: "Clear" }))
    await waitFor(() => expect(result()).toBeNull())
    expect(screen.queryByText("Decided here")).toBeNull()
    expect(screen.queryByText("Not reached")).toBeNull()
    expect(document.querySelector("[data-decided]")).toBeNull()
    expect(tenantInput().value).toBe("")
    expect(userInput().value).toBe("")
  })

  it("shows a failed evaluation, and marks nothing", async () => {
    setup(() => new ContractError("INTERNAL", "engine unavailable"))
    await ready()
    fireEvent.click(screen.getByRole("button", { name: "Evaluate" }))
    expect((await screen.findByRole("alert")).textContent).toContain("engine unavailable")
    expect(document.querySelector("[data-decided]")).toBeNull()
  })

  it("follows the data when flags.evaluate is invalidated", async () => {
    let reason = "default"
    const { evaluates } = setup(() =>
      reason === "default"
        ? evaluation({ reason: "default", trace: trace([miss("a"), miss("b"), miss("c"), miss("d")]) })
        : evaluation({ reason: "disabled" }),
    )
    await evaluate("t-x", "")
    expect(rung("default").getAttribute("data-decided")).toBe("true")
    reason = "disabled"
    act(() => queryStore.invalidate("vault", ["flags.evaluate"]))
    await waitFor(() => expect(rung("enabled").getAttribute("data-decided")).toBe("true"))
    expect(rung("default").getAttribute("data-decided")).toBeNull()
    expect(evaluates()).toHaveLength(2)
  })
})

describe("evaluation result line", () => {
  it("says what it returns, for whom, and why, for disabled", async () => {
    setup(() => evaluation({ reason: "disabled", value: false }))
    await evaluate("", "")
    const text = result().textContent ?? ""
    expect(text).toContain("Returns")
    expect(text).toContain("false")
    expect(text).toContain("for no tenant and no user.")
    expect(text).toContain("The flag is off, so the default is returned.")
  })

  it("names the tenant for a tenant override", async () => {
    setup(() => evaluation({ reason: "tenantOverride" }))
    await evaluate("t-acme", "")
    expect(result().textContent).toContain("for tenant t-acme.")
    expect(result().textContent).toContain("Tenant t-acme has an override.")
  })

  it("gives the one-based number of the rule that decided it", async () => {
    setup(() =>
      evaluation({
        reason: "rule",
        matchedRulePriority: 1,
        trace: trace([miss("no user in context"), hit("user u-1"), skipped, skipped]),
      }),
    )
    await evaluate("", "u-1")
    expect(result().textContent).toContain("for user u-1.")
    expect(result().textContent).toContain("Rule 2 decided it.")
  })

  it("says no rule matched for the default", async () => {
    setup(() =>
      evaluation({ reason: "default", trace: trace([miss("a"), miss("b"), miss("c"), miss("d")]) }),
    )
    await evaluate("t-x", "u-x")
    expect(result().textContent).toContain("No rule matched, so the default is returned.")
    expect(result().textContent).toContain("for tenant t-x, user u-x.")
  })

  it("flags an answer that is not a value of the flag's type", async () => {
    setup(() => evaluation({ reason: "disabled", value: "yes", valueMatchesType: false }))
    await evaluate()
    expect(within(result()).getByText("Wrong type")).toBeTruthy()
  })

  it("carries cacheTtlSeconds in the cache sentence", async () => {
    setup(() => evaluation({ reason: "disabled" }), detail({ cacheTtlSeconds: 45 }))
    await evaluate()
    expect(result().textContent).toContain("This is what this server answers now.")
    expect(result().textContent).toContain(
      "Other servers may serve the previous answer for up to 45 seconds after a change.",
    )
  })

  it("leaves out the other-servers sentence when nothing is cached", async () => {
    setup(() => evaluation({ reason: "disabled" }), detail({ cacheTtlSeconds: 0 }))
    await evaluate()
    expect(result().textContent).toContain("This is what this server answers now.")
    expect(result().textContent).not.toContain("Other servers")
  })
})

describe("evaluation marks on the ladder", () => {
  it("disabled: rung 1 decided, rungs 2 to 4 not reached, nothing else", async () => {
    setup(() => evaluation({ reason: "disabled" }))
    await evaluate("t-acme", "")
    expect(rungMarks("enabled")).toEqual(["Decided here"])
    expect(rung("enabled").getAttribute("data-decided")).toBe("true")
    for (const id of ["overrides", "rules", "default"]) {
      expect(rungMarks(id)).toEqual(["Not reached"])
      expect(rung(id).getAttribute("data-decided")).toBeNull()
    }
    // The rung says it once. Its rows are not marked as well.
    for (const row of [...rows("overrides"), ...rows("rules")]) {
      expect(rowMarks(row)).toEqual([])
      expect(row.getAttribute("data-decided")).toBeNull()
    }
    expect(screen.getAllByText("Decided here")).toHaveLength(1)
    expect(screen.getAllByText("Not reached")).toHaveLength(3)
  })

  it("tenantOverride: that tenant's row decided, rungs 3 and 4 not reached", async () => {
    setup(() => evaluation({ reason: "tenantOverride" }))
    await evaluate("t-globex", "")
    const [acme, globex] = rows("overrides")
    expect(rowMarks(globex!)).toEqual(["Decided here"])
    expect(globex!.getAttribute("data-decided")).toBe("true")
    expect(rowMarks(acme!)).toEqual([])
    expect(acme!.getAttribute("data-decided")).toBeNull()
    expect(rungMarks("enabled")).toEqual([])
    expect(rungMarks("overrides")).toEqual([])
    expect(rungMarks("rules")).toEqual(["Not reached"])
    expect(rungMarks("default")).toEqual(["Not reached"])
    expect(screen.getAllByText("Decided here")).toHaveLength(1)
    expect(screen.getAllByText("Not reached")).toHaveLength(2)
  })

  it("rule: the matching rule decided, earlier ones show their notes, later ones and rung 4 not reached", async () => {
    setup(() =>
      evaluation({
        reason: "rule",
        matchedRulePriority: 1,
        trace: trace([miss("no tenant in context"), hit("user u-1"), skipped, skipped]),
      }),
    )
    await evaluate("", "u-1")
    const r = rows("rules")
    expect(rowMarks(r[0]!)).toEqual([])
    expect(r[0]!.textContent).toContain("No match: no tenant in context")
    expect(rowMarks(r[1]!)).toEqual(["Decided here"])
    // The rule that decided it is not "No match".
    expect(r[1]!.textContent).not.toContain("No match")
    expect(r[1]!.getAttribute("data-decided")).toBe("true")
    expect(r[1]!.textContent).toContain("user u-1")
    expect(rowMarks(r[2]!)).toEqual(["Not reached"])
    expect(rowMarks(r[3]!)).toEqual(["Not reached"])
    expect(r[3]!.getAttribute("data-decided")).toBeNull()
    // Rung 3 holds the answer, so its rail turns and its title stays clean.
    expect(rung("rules").getAttribute("data-decided")).toBe("true")
    expect(rungMarks("rules")).toEqual([])
    expect(rungMarks("enabled")).toEqual([])
    expect(rungMarks("overrides")).toEqual([])
    expect(rungMarks("default")).toEqual(["Not reached"])
    expect(screen.getAllByText("Decided here")).toHaveLength(1)
    expect(screen.getAllByText("Not reached")).toHaveLength(3)
    // The note is muted text.
    const note = within(r[0]!).getByText("No match: no tenant in context")
    expect(note.className).toContain("text-muted-foreground")
  })

  it("rule: says a tenant with no override had none, when it was looked for", async () => {
    setup(() =>
      evaluation({
        reason: "rule",
        matchedRulePriority: 0,
        trace: trace([hit("tenant t-beta"), skipped, skipped, skipped]),
      }),
    )
    await evaluate("t-beta", "")
    expect(rung("overrides").textContent).toContain("Tenant t-beta has no override.")
  })

  it("default: every rule shows its note and rung 4 decided", async () => {
    setup(() =>
      evaluation({
        reason: "default",
        trace: trace([miss("tenant t-x"), miss("user u-x"), miss("no tenant in context, a rollout cannot match"), miss("the window has not started")]),
      }),
    )
    await evaluate("t-x", "u-x")
    const r = rows("rules")
    expect(r[0]!.textContent).toContain("No match: tenant t-x")
    expect(r[1]!.textContent).toContain("No match: user u-x")
    expect(r[2]!.textContent).toContain("a rollout cannot match")
    expect(r[3]!.textContent).toContain("the window has not started")
    for (const row of r) {
      expect(rowMarks(row)).toEqual([])
      expect(row.getAttribute("data-decided")).toBeNull()
    }
    expect(rungMarks("default")).toEqual(["Decided here"])
    expect(rung("default").getAttribute("data-decided")).toBe("true")
    expect(rungMarks("enabled")).toEqual([])
    expect(rungMarks("overrides")).toEqual([])
    expect(rungMarks("rules")).toEqual([])
    expect(screen.getAllByText("Decided here")).toHaveLength(1)
    expect(screen.queryByText("Not reached")).toBeNull()
  })

  it("says which bucket a tenant landed in, under the rollout's percentage", async () => {
    setup(() =>
      evaluation({
        reason: "rule",
        matchedRulePriority: 2,
        bucket: 12,
        trace: trace([miss("tenant t-x"), miss("no user in context"), hit("bucket 12 of 100, threshold 25"), skipped]),
      }),
    )
    await evaluate("t-x", "")
    const rollout = rows("rules")[2]!
    expect(rollout.textContent).toContain("Tenant t-x lands in bucket 12, under 25.")
    expect(rowMarks(rollout)).toEqual(["Decided here"])
  })

  it("says so when the bucket is not under the percentage", async () => {
    setup(() =>
      evaluation({
        reason: "default",
        bucket: 64,
        trace: trace([miss("tenant t-x"), miss("no user in context"), miss("bucket 64 of 100, threshold 25"), miss("the window has not started")]),
      }),
    )
    await evaluate("t-x", "")
    const rollout = rows("rules")[2]!
    expect(rollout.textContent).toContain("Tenant t-x lands in bucket 64, not under 25.")
    expect(rollout.textContent).not.toContain("threshold")
  })

  it("keeps the engine's own words for a rollout when no tenant was given", async () => {
    setup(() =>
      evaluation({
        reason: "default",
        trace: trace([miss("no tenant in context"), miss("user u-9"), miss("no tenant in context, a rollout cannot match"), miss("the window has not started")]),
      }),
    )
    await evaluate("", "u-9")
    expect(rows("rules")[2]!.textContent).toContain("no tenant in context, a rollout cannot match")
    expect(rows("rules")[2]!.textContent).not.toContain("lands in bucket")
  })

  it("matches steps to rules by position, not by priority order", async () => {
    // Priorities out of order: the engine walks them as given.
    const odd = [
      rule({ id: "a", priority: 5, type: "when_tenant", tenantIds: ["t-1"] }),
      rule({ id: "b", priority: 2, type: "when_user", userIds: ["u-1"] }),
    ]
    setup(
      () =>
        evaluation({
          reason: "rule",
          matchedRulePriority: 2,
          trace: trace([miss("tenant t-9"), hit("user u-1")], odd),
        }),
      detail({ rules: odd }),
    )
    await evaluate("t-9", "u-1")
    const r = rows("rules")
    expect(rowMarks(r[0]!)).toEqual([])
    expect(rowMarks(r[1]!)).toEqual(["Decided here"])
    expect(result().textContent).toContain("Rule 2 decided it.")
  })

  it("leaves rows unmarked and says so when the rules are not the ones the engine walked", async () => {
    setup(() =>
      evaluation({
        reason: "rule",
        matchedRulePriority: 1,
        // One step short: a rule was added after this trace was made.
        trace: trace([miss("no tenant in context"), hit("user u-1")]),
      }),
    )
    await evaluate("", "u-1")
    expect(result().textContent).toContain("Press Evaluate again.")
  })

  it("matches steps to rules by id: a reordered ladder marks the rule that matched", async () => {
    // The page holds [when_tenant acme r1, rollout r2]. By the time Evaluate
    // ran, the engine walked [rollout r2, when_tenant r1].
    const page = [
      rule({ id: "r1", priority: 0, type: "when_tenant", tenantIds: ["acme"] }),
      rule({ id: "r2", priority: 1, type: "rollout", percentage: 50 }),
    ]
    setup(
      () =>
        evaluation({
          reason: "rule",
          matchedRuleId: "r2",
          matchedRulePriority: 0,
          trace: [
            { ruleId: "r2", priority: 0, type: "rollout", matched: true, reached: true, note: "bucket 3 of 100, threshold 50" },
            { ruleId: "r1", priority: 1, type: "when_tenant", matched: false, reached: false, note: "" },
          ],
        }),
      detail({ rules: page }),
    )
    await evaluate("wayne", "")
    const r = rows("rules")
    expect(rowMarks(r[0]!)).toEqual(["Not reached"])
    expect(rowMarks(r[1]!)).toEqual(["Decided here"])
    expect(result().textContent).toContain("Rule 2 decided it.")
  })

  it("marks nothing when a step names a rule the page does not hold", async () => {
    setup(() =>
      evaluation({
        reason: "rule",
        matchedRuleId: "rul_gone",
        matchedRulePriority: 1,
        trace: traceWithIds([miss("a"), hit("b"), skipped, skipped]).map((s, i) =>
          i === 1 ? { ...s, ruleId: "rul_gone" } : s,
        ),
      }),
    )
    await evaluate("", "u-1")
    expect(screen.queryByText("Decided here")).toBeNull()
    expect(result().textContent).toContain("Press Evaluate again.")
  })

  it("refetches the flag's rules whenever Evaluate is pressed", async () => {
    const { queries } = setup(() => evaluation())
    await evaluate("t-acme", "")
    const detailReads = () => queries.filter((q) => q.intent === "flags.detail").length
    await waitFor(() => expect(detailReads()).toBe(2))
    fireEvent.click(screen.getByRole("button", { name: "Evaluate" }))
    await waitFor(() => expect(detailReads()).toBe(3))
  })

  it("clears a mismatch by refetching the rules when Evaluate is pressed again", async () => {
    // The first detail read is stale: it lacks the rule the engine walks.
    const stale = detail({ rules: RULES.slice(0, 3) })
    const fresh = detail()
    let reads = 0
    const queries: string[] = []
    const client = {
      extension: "vault",
      query: async (intent: string) => {
        queries.push(intent)
        if (intent === "flags.detail") return reads++ === 0 ? stale : fresh
        return evaluation({
          reason: "default",
          trace: traceWithIds([miss("a"), miss("b"), miss("c"), miss("d")]),
        })
      },
      command: async () => undefined,
    } as unknown as ScopedClient
    render(
      <PluginProvider client={client}>
        <NavigationProvider value={{ Link: ({ children }) => <a>{children}</a>, navigate: vi.fn() }}>
          <FlagDetailPage params={{ key: KEY }} />
        </NavigationProvider>
      </PluginProvider>,
    )
    await ready()
    fireEvent.click(screen.getByRole("button", { name: "Evaluate" }))
    await waitFor(() => expect(rows("rules")).toHaveLength(4))
    await waitFor(() => expect(result().textContent).not.toContain("Press Evaluate again."))
    expect(rung("default").getAttribute("data-decided")).toBe("true")
  })

  it("does not mark a rule whose priority disagrees with its step", async () => {
    setup(() =>
      evaluation({
        reason: "rule",
        matchedRulePriority: 9,
        trace: [
          { priority: 0, type: "when_tenant", matched: false, reached: true, note: "n0" },
          { priority: 9, type: "when_user", matched: true, reached: true, note: "n1" },
          { priority: 2, type: "rollout", matched: false, reached: false, note: "" },
          { priority: 3, type: "schedule", matched: false, reached: false, note: "" },
        ],
      }),
    )
    await evaluate("", "u-1")
    expect(rowMarks(rows("rules")[1]!)).toEqual([])
    expect(rows("rules")[1]!.textContent).not.toContain("n1")
    expect(result().textContent).toContain("A rule decided it.")
    expect(result().textContent).toContain("Press Evaluate again.")
  })

  it("does not mark or annotate one rung twice when the flag is also off in the page", async () => {
    setup(
      () => evaluation({ reason: "disabled" }),
      detail({ flag: flag({ enabled: false }) }),
    )
    await evaluate()
    expect(rungBodyOpacityCount("rules")).toBe(1)
  })
})

function rungBodyOpacityCount(id: string): number {
  const all = rung(id).querySelectorAll(".opacity-60")
  return all.length
}

describe("remove override dialog title", () => {
  it("keeps its tenant while the dialog is closing", async () => {
    // jsdom has no animations, so the dialog would unmount at once and the
    // closing frame would never exist. A 60ms exit animation gives it one.
    const proto = Element.prototype as unknown as { getAnimations?: () => unknown[] }
    const had = Object.getOwnPropertyDescriptor(proto, "getAnimations")
    proto.getAnimations = function () {
      return [{ finished: new Promise((r) => setTimeout(r, 60)) }]
    }
    try {
      const inner = stubClient(
        { "flags.detail": detail() },
        { "flags.deleteTenantOverride": { ok: true, key: KEY, tenantId: "t-acme" } },
      )
      render(
        <PluginProvider client={inner}>
          <NavigationProvider
            value={{
              Link: ({ to, children }) => <a href={to}>{children}</a>,
              navigate: vi.fn(),
            }}
          >
            <FlagDetailPage params={{ key: KEY }} />
          </NavigationProvider>
        </PluginProvider>,
      )
      await ready()
      fireEvent.click(screen.getByRole("button", { name: "Remove override for t-acme" }))
      const dialog = await screen.findByRole("alertdialog")
      expect(dialog.textContent).toContain("Remove the override for t-acme?")
      fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }))
      // The command has settled and the dialog is on its way out.
      await waitFor(() => expect(within(dialog).queryByText(/Working/)).toBeNull())
      const closing = document.querySelector('[role="alertdialog"]')
      expect(closing).toBeTruthy()
      expect(closing?.textContent).toContain("Remove the override for t-acme?")
      expect(closing?.textContent).not.toContain("override for ?")
      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    } finally {
      if (had) Object.defineProperty(proto, "getAnimations", had)
      else delete proto.getAnimations
    }
  })
})
