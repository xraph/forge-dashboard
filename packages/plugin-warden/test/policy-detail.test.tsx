import { describe, expect, it } from "vitest"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import {
  ContractError,
  NavigationProvider,
  PluginProvider,
} from "@forge-go/dashboard-plugin"
import type { PluginPageProps, ScopedClient } from "@forge-go/dashboard-plugin"
import type { ComponentType } from "react"
import { wardenPlugin } from "../src/index"
import type { PolicyDetail } from "../src/components/policy-rule"
import { WardenPolicyDetailPage } from "../src/pages/policy-detail"
import {
  failingClient,
  pendingClient,
  recordingCommandClient,
  recordingQueryClient,
  renderPage,
  stubClient,
} from "./harness"

const DETAIL: PolicyDetail = {
  id: "pol_01",
  namespacePath: "",
  name: "office-only",
  description: "Keeps deletes on the office network.",
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
    { id: "c1", field: "context.ip", operator: "not_in", value: ["10.0.0.0/8"] },
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

const CONFIG_ON = { abacEnabled: true, rbacEnabled: true }

const THROWS = {
  field: "context.ip",
  operator: "bogus",
  value: "x",
  problem: "throws" as const,
  reason: "unknownOperator" as const,
}
const DEPENDS = { field: "subject.dept", operator: "eq", value: "eng" }

/** A deny whose first condition throws: it applies to every check it selects. */
const FAILS_AT_0: Partial<PolicyDetail> = {
  failsClosed: true,
  decidingCondition: 0,
  conditions: [THROWS, DEPENDS],
}
/** A deny whose third condition throws, after two that depend on the check. */
const FAILS_AT_2: Partial<PolicyDetail> = {
  failsClosed: true,
  decidingCondition: 2,
  conditions: [DEPENDS, { ...DEPENDS, field: "subject.team" }, THROWS],
}
/** An allow whose second condition throws: it is skipped on every check. */
const ALLOW_THROWS: Partial<PolicyDetail> = {
  effect: "allow",
  neverApplies: true,
  decidingCondition: 1,
  conditions: [DEPENDS, THROWS],
}
/** A policy whose first condition can never hold. */
const ALWAYS_FALSE: Partial<PolicyDetail> = {
  neverApplies: true,
  decidingCondition: 0,
  conditions: [
    { field: "context.ip", operator: "in", value: "10.0.0.0/8", problem: "alwaysFalse", reason: "notAList" },
  ],
}
/** No matcher narrows it, and no condition does either. */
const EVERYTHING: Partial<PolicyDetail> = {
  matchesEverything: true,
  subjects: [],
  actions: [],
  resources: [],
  subjectsUnrestricted: true,
  actionsUnrestricted: true,
  resourcesUnrestricted: true,
  conditions: [],
}

const THROWS_1 =
  "Condition 1 cannot be evaluated, so warden treats it, and every condition after it, as met."
const THROWS_3 =
  "Condition 3 cannot be evaluated, so warden treats it, and every condition after it, as met."
const SCOPE_0 =
  "to every check in its namespace and below that its subjects, actions and resources select."
const SCOPE_LATER =
  "to the checks it selects in its namespace and below whenever the conditions before it hold."
const FAILS_0 = `This deny applies ${SCOPE_0}`
const FAILS_0_ONCE = `Once it is in effect, this deny applies ${SCOPE_0}`
const FAILS_0_WOULD = `If it were in effect, this deny would apply ${SCOPE_0}`
const FAILS_LATER = `This deny applies ${SCOPE_LATER}`
const FAILS_LATER_ONCE = `Once it is in effect, this deny applies ${SCOPE_LATER}`
const FAILS_LATER_WOULD = `If it were in effect, this deny would apply ${SCOPE_LATER}`
const NEVER_GRANTS = "Condition 2 cannot be evaluated, so this allow never grants anything."
const NEVER_APPLIES = "Condition 1 is always false, so this policy never applies."
const MATCHES_EVERY = "It matches every check in its namespace and below."
const MATCHES_EVERY_ONCE = "Once it is in effect, it matches every check in its namespace and below."
const MATCHES_EVERY_WOULD = "If it were in effect, it would match every check in its namespace and below."
const WINDOW_ENDED = "Its window has ended, so activating it will not put it into effect."
const WINDOW_INVERTED =
  "Its window ends before it starts, so activating it will not put it into effect."

/** Windows relative to the real clock: one open now, one long ended, one backwards. */
const OPEN = { notBefore: "2020-01-01T00:00:00Z", notAfter: "2099-12-31T00:00:00Z" }
const ENDED = { notBefore: "2020-01-01T00:00:00Z", notAfter: "2020-06-30T00:00:00Z" }
const INVERTED = { notBefore: "2099-07-01T00:00:00Z", notAfter: "2099-06-01T00:00:00Z" }
const INACTIVE = { state: "inactive" as const, isActive: false }

/**
 * A deny with nothing narrowing it whose second condition throws. The server
 * sets failsClosed AND matchesEverything: the first condition always holds,
 * so the deny applies to every check in its namespace and below.
 */
const FAILS_EVERYTHING: Partial<PolicyDetail> = {
  failsClosed: true,
  matchesEverything: true,
  decidingCondition: 1,
  subjects: [],
  actions: [],
  resources: [],
  subjectsUnrestricted: true,
  actionsUnrestricted: true,
  resourcesUnrestricted: true,
  conditions: [
    { field: "subject.kind", operator: "exists", problem: "alwaysTrue", reason: "alwaysPresent" },
    { field: "x.y", operator: "bogus", value: "z", problem: "throws", reason: "unknownOperator" },
  ],
}
const FAILS_EVERYTHING_TEXT =
  "Condition 2 cannot be evaluated, so warden treats it, and every condition after it, as met. It matches every check in its namespace and below."
const ABAC_OFF =
  "Policy evaluation is turned off in this deployment, so this policy takes no effect."

function detailOf(over: Partial<PolicyDetail>): PolicyDetail {
  return { ...DETAIL, ...over }
}

function answers(detail: PolicyDetail, config: unknown = CONFIG_ON) {
  return { "policies.detail": detail, "config.detail": config }
}

function show(over: Partial<PolicyDetail> = {}, config: unknown = CONFIG_ON) {
  return renderPage(WardenPolicyDetailPage, stubClient(answers(detailOf(over), config)), {
    id: "pol_01",
  })
}

/** Renders inside a host with a recorded navigate. */
function showInHost(c: ScopedClient) {
  const navigated: string[] = []
  const utils = render(
    <PluginProvider client={c}>
      <NavigationProvider
        value={{
          Link: ({ to, children, className }) => (
            <a href={to} className={className}>
              {children}
            </a>
          ),
          navigate: (to) => navigated.push(to),
          resolve: (to) => `/@warden/acme${to}`,
        }}
      >
        <WardenPolicyDetailPage params={{ id: "pol_01" }} />
      </NavigationProvider>
    </PluginProvider>
  )
  return { ...utils, navigated }
}

function recording(over: Partial<PolicyDetail> = {}) {
  return recordingCommandClient(answers(detailOf(over)), {
    "policies.setActive": {},
    "policies.delete": {},
  })
}

/** Reads succeed and every command is refused with `error`. */
function refusing(error: ContractError, over: Partial<PolicyDetail> = {}): ScopedClient {
  return {
    ...stubClient(answers(detailOf(over))),
    command: () => Promise.reject(error),
  } as ScopedClient
}

/** Reads succeed and commands never settle. */
function neverSettles(over: Partial<PolicyDetail> = {}): ScopedClient {
  return {
    ...stubClient(answers(detailOf(over))),
    command: () => new Promise<never>(() => {}),
  } as ScopedClient
}

const heading = () => screen.findByRole("heading", { name: "office-only" })
const dialog = () => within(screen.getByRole("alertdialog"))
const callout = () => screen.queryByTestId("policy-callout")
const stateLine = () => screen.queryByTestId("policy-state")
const rule = () => screen.getByRole("region", { name: "Rule" })

/** A class token that paints destructive colour unconditionally, not behind a variant like aria-invalid:. */
function destructiveElements(root: ParentNode): Element[] {
  return Array.from(root.querySelectorAll("[class]")).filter((el) =>
    (el.getAttribute("class") ?? "")
      .split(/\s+/)
      .some((t) => !t.includes(":") && t.includes("destructive"))
  )
}

async function openDialog(button: string) {
  await heading()
  fireEvent.click(screen.getByRole("button", { name: button }))
  await screen.findByRole("alertdialog")
}

describe("WardenPolicyDetailPage", () => {
  describe("routes", () => {
    const route = (path: string) => wardenPlugin.routes.find((r) => r.path === path)

    it("registers the detail and the edit route, with no nav entry for either", () => {
      expect(route("/policies/:id")).toBeTruthy()
      expect(route("/policies/:id/edit")).toBeTruthy()
      const nav = (wardenPlugin.nav ?? []).map((n) => n.to)
      expect(nav).not.toContain("/policies/:id")
      expect(nav).not.toContain("/policies/:id/edit")
    })

    it("asks policies.detail for exactly the id in the route", async () => {
      const { client: c, sent } = recordingQueryClient(answers(DETAIL))
      renderPage(route("/policies/:id")!.element, c, { id: "pol_09z" })
      await heading()
      expect(sent.filter((s) => s.intent === "policies.detail")).toEqual([
        { intent: "policies.detail", params: { id: "pol_09z" } },
      ])
    })

    it("opens the editor on the edit route, from the id in the route", async () => {
      // Where the create flow lands and where Edit goes. It must show the
      // policy being edited, never a missing route, and never the read view.
      const { client: c, sent } = recordingQueryClient(answers(DETAIL))
      const Edit = route("/policies/:id/edit")!.element as ComponentType<PluginPageProps>
      renderPage(Edit, c, { id: "pol_01" })
      await heading()
      expect(screen.getByRole("region", { name: "Rule editor" })).toBeTruthy()
      expect(screen.queryByRole("region", { name: "Rule" })).toBeNull()
      expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("office-only")
      expect(sent.filter((s) => s.intent === "policies.detail")).toEqual([
        { intent: "policies.detail", params: { id: "pol_01" } },
      ])
    })

    it("renders the read view, not the editor, on the detail route", async () => {
      show()
      await heading()
      expect(rule()).toBeTruthy()
      expect(screen.queryByRole("region", { name: "Rule editor" })).toBeNull()
    })

    it("goes to the edit route from the Edit button", async () => {
      const { navigated } = showInHost(stubClient(answers(DETAIL)))
      await heading()
      fireEvent.click(screen.getByRole("button", { name: "Edit" }))
      expect(navigated).toEqual(["/@warden/acme/policies/pol_01/edit"])
    })
  })

  describe("colour", () => {
    it("gives only the Deny heading a destructive class, anywhere on the page", async () => {
      show(FAILS_AT_0)
      await heading()
      expect(destructiveElements(document.body)).toEqual([
        screen.getByRole("heading", { name: "Deny" }),
      ])
    })

    it("gives nothing a destructive class on an allow", async () => {
      show({ effect: "allow" })
      await heading()
      expect(screen.getByRole("heading", { name: "Allow" })).toBeTruthy()
      expect(destructiveElements(document.body)).toEqual([])
    })

    it("keeps the deactivate dialog out of the destructive colour", async () => {
      show()
      await openDialog("Deactivate")
      expect(destructiveElements(document.body)).toEqual([
        screen.getByRole("heading", { name: "Deny", hidden: true }),
      ])
    })

    it("keeps the activate dialog out of the destructive colour", async () => {
      show({ ...INACTIVE, ...OPEN })
      await openDialog("Activate")
      expect(destructiveElements(document.body)).toEqual([
        screen.getByRole("heading", { name: "Deny", hidden: true }),
      ])
    })

    it("keeps the delete dialog out of the destructive colour too", async () => {
      show()
      await openDialog("Delete")
      expect(destructiveElements(document.body)).toEqual([
        screen.getByRole("heading", { name: "Deny", hidden: true }),
      ])
    })
  })

  describe("the state line", () => {
    it("says an inactive policy takes no effect, and offers Activate", async () => {
      show({ ...INACTIVE, ...OPEN })
      await heading()
      expect(stateLine()!.querySelector("p")!.textContent).toBe(
        "Inactive. It takes no effect until you activate it."
      )
      expect(within(stateLine()!).getByRole("button", { name: "Activate" })).toBeTruthy()
      expect(screen.queryByRole("button", { name: "Deactivate" })).toBeNull()
    })

    it("says the same of an inactive policy with no window", async () => {
      show({ ...INACTIVE, notBefore: undefined, notAfter: undefined })
      await heading()
      expect(stateLine()!.querySelector("p")!.textContent).toBe(
        "Inactive. It takes no effect until you activate it."
      )
    })

    it("does not promise an effect on activation when the window has ended", async () => {
      show({ ...INACTIVE, ...ENDED })
      await heading()
      expect(stateLine()!.querySelector("p")!.textContent).toBe(
        "Inactive, and its window has ended."
      )
    })

    it("does not promise an effect on activation when the window ends before it starts", async () => {
      show({ ...INACTIVE, ...INVERTED })
      await heading()
      expect(stateLine()!.querySelector("p")!.textContent).toBe(
        "Inactive, and its window ends before it starts."
      )
    })

    it("says an inactive policy whose window has not opened takes effect on its date once activated", async () => {
      show({ ...INACTIVE, notBefore: "2099-01-01T00:00:00Z", notAfter: undefined })
      await heading()
      expect(stateLine()!.querySelector("p")!.textContent).toBe(
        "Inactive. If you activate it, it takes effect on 1 Jan 2099, 00:00 UTC."
      )
    })

    it("does not promise an effect on activation for a policy that never applies", async () => {
      show({ ...ALWAYS_FALSE, ...INACTIVE, ...OPEN })
      await heading()
      expect(stateLine()!.querySelector("p")!.textContent).toBe("Inactive.")
    })

    it("says when a scheduled policy starts", async () => {
      show({ state: "scheduled" })
      await heading()
      expect(stateLine()!.textContent).toBe(
        "Not yet in effect. It starts on 1 Jun 2026, 00:00 UTC."
      )
    })

    it("says when an expired policy ended", async () => {
      show({ state: "expired" })
      await heading()
      expect(stateLine()!.textContent).toBe(
        "No longer in effect. It ended on 30 Jun 2026, 00:00 UTC."
      )
    })

    it("says a backwards window is never in effect", async () => {
      show({ state: "never", notBefore: "2026-07-01T00:00:00Z" })
      await heading()
      expect(stateLine()!.textContent).toBe("Never in effect. Its end is before its start.")
    })

    it("shows no state line for an active policy, and offers Deactivate", async () => {
      show()
      await heading()
      expect(stateLine()).toBeNull()
      expect(screen.getByRole("button", { name: "Deactivate" })).toBeTruthy()
      expect(screen.queryByRole("button", { name: "Activate" })).toBeNull()
    })
  })

  describe("callouts", () => {
    const text = () => callout()!.textContent

    describe("fail closed at the first condition", () => {
      it("says an active deny applies to every check in its namespace and below that it selects", async () => {
        show(FAILS_AT_0)
        await heading()
        expect(text()).toBe(`${THROWS_1} ${FAILS_0}`)
      })

      it("says an inactive deny with an open window will apply once it is in effect", async () => {
        show({ ...FAILS_AT_0, ...INACTIVE, ...OPEN })
        await heading()
        expect(text()).toBe(`${THROWS_1} ${FAILS_0_ONCE}`)
        // Both lines: the state, and what taking effect will do.
        expect(stateLine()!.querySelector("p")!.textContent).toBe(
          "Inactive. It takes no effect until you activate it."
        )
      })

      it("says a scheduled deny will apply once it is in effect", async () => {
        show({ ...FAILS_AT_0, state: "scheduled" })
        await heading()
        expect(text()).toBe(`${THROWS_1} ${FAILS_0_ONCE}`)
      })

      for (const [state, label] of [
        ["expired", "an expired"],
        ["never", "a never-in-effect"],
      ] as const) {
        it(`says ${label} deny only would apply, since it will not take effect`, async () => {
          show({ ...FAILS_AT_0, state })
          await heading()
          expect(text()).toBe(`${THROWS_1} ${FAILS_0_WOULD}`)
          expect(text()).not.toContain("Once it is in effect")
        })
      }

      it("says an inactive deny whose window has ended only would apply", async () => {
        show({ ...FAILS_AT_0, ...INACTIVE, ...ENDED })
        await heading()
        expect(text()).toBe(`${THROWS_1} ${FAILS_0_WOULD}`)
      })

      it("says an inactive deny whose window is backwards only would apply", async () => {
        show({ ...FAILS_AT_0, ...INACTIVE, ...INVERTED })
        await heading()
        expect(text()).toBe(`${THROWS_1} ${FAILS_0_WOULD}`)
      })
    })

    describe("fail closed at a later condition", () => {
      it("says an active deny applies to the checks it selects when the earlier conditions hold", async () => {
        show(FAILS_AT_2)
        await heading()
        expect(text()).toBe(`${THROWS_3} ${FAILS_LATER}`)
      })

      it("says a scheduled deny will, once it is in effect", async () => {
        show({ ...FAILS_AT_2, state: "scheduled" })
        await heading()
        expect(text()).toBe(`${THROWS_3} ${FAILS_LATER_ONCE}`)
      })

      it("says an expired deny only would", async () => {
        show({ ...FAILS_AT_2, state: "expired" })
        await heading()
        expect(text()).toBe(`${THROWS_3} ${FAILS_LATER_WOULD}`)
      })
    })

    describe("fail closed with nothing narrowing it", () => {
      it("names the deciding condition and says it matches every check", async () => {
        // The most dangerous shape. The weaker "whenever the conditions
        // before it hold" would hide that it denies everything.
        show(FAILS_EVERYTHING)
        await heading()
        expect(text()).toBe(FAILS_EVERYTHING_TEXT)
      })

      it("words the combination for a policy that will take effect", async () => {
        show({ ...FAILS_EVERYTHING, ...INACTIVE, ...OPEN })
        await heading()
        expect(text()).toBe(
          `Condition 2 cannot be evaluated, so warden treats it, and every condition after it, as met. ${MATCHES_EVERY_ONCE}`
        )
      })

      it("words the combination for a policy that will not", async () => {
        show({ ...FAILS_EVERYTHING, state: "expired" })
        await heading()
        expect(text()).toBe(
          `Condition 2 cannot be evaluated, so warden treats it, and every condition after it, as met. ${MATCHES_EVERY_WOULD}`
        )
      })
    })

    describe("fail closed, following the server's matchesEverything", () => {
      it("says it matches every check when the server says so and an action list holds only *", async () => {
        // Non-empty but unrestricted: a reading of the lists would say no.
        show({ ...FAILS_EVERYTHING, actions: ["*"] })
        await heading()
        expect(text()).toBe(FAILS_EVERYTHING_TEXT)
      })

      it("keeps the narrower sentence when the server says no, however open the matchers", async () => {
        // Every matcher unrestricted, but the first condition depends on the
        // check, so the server's flag is clear.
        show({
          ...FAILS_EVERYTHING,
          matchesEverything: false,
          conditions: [DEPENDS, THROWS],
        })
        await heading()
        expect(text()).toBe(
          `Condition 2 cannot be evaluated, so warden treats it, and every condition after it, as met. ${FAILS_LATER}`
        )
        expect(text()).not.toContain("matches every check")
      })
    })

    describe("never applies", () => {
      it("says an allow whose condition throws never grants anything", async () => {
        show(ALLOW_THROWS)
        await heading()
        expect(text()).toBe(NEVER_GRANTS)
      })

      it("says the same of an inactive one, since it is true in any state", async () => {
        show({ ...ALLOW_THROWS, ...INACTIVE, ...OPEN })
        await heading()
        expect(text()).toBe(NEVER_GRANTS)
      })

      it("says a policy with an always-false condition never applies", async () => {
        show(ALWAYS_FALSE)
        await heading()
        expect(text()).toBe(NEVER_APPLIES)
      })
    })

    describe("matches every check", () => {
      it("says an active policy the server flags matches every check", async () => {
        show(EVERYTHING)
        await heading()
        expect(text()).toBe(MATCHES_EVERY)
      })

      it("says an inactive one with an open window will, once it is in effect", async () => {
        show({ ...EVERYTHING, ...INACTIVE, ...OPEN })
        await heading()
        expect(text()).toBe(MATCHES_EVERY_ONCE)
      })

      it("says an expired one only would", async () => {
        show({ ...EVERYTHING, state: "expired" })
        await heading()
        expect(text()).toBe(MATCHES_EVERY_WOULD)
      })

      it("says a never-in-effect one only would", async () => {
        show({ ...EVERYTHING, state: "never" })
        await heading()
        expect(text()).toBe(MATCHES_EVERY_WOULD)
      })

      it("follows the server's flag when a local reading of the matchers would say no", async () => {
        // Restricted matchers and a condition that depends on the check. No
        // rule the page could apply would set the flag. The server did.
        show({ matchesEverything: true, conditions: [DEPENDS] })
        await heading()
        expect(text()).toBe(MATCHES_EVERY)
      })

      it("follows the server's clear flag when a local reading would say yes", async () => {
        // Every matcher unrestricted and no condition at all, and the
        // server still says no.
        show({ ...EVERYTHING, matchesEverything: false })
        await heading()
        expect(callout()).toBeNull()
        expect(screen.queryByText(/matches every check/)).toBeNull()
      })
    })

    it("shows no callout for a policy that behaves as written", async () => {
      show()
      await heading()
      expect(callout()).toBeNull()
    })

    it("marks a deciding row at index 0", async () => {
      const { container } = show(FAILS_AT_0)
      await heading()
      const marked = container.querySelectorAll('[data-deciding="true"]')
      expect(marked.length).toBe(1)
      expect(marked[0].getAttribute("data-condition")).toBe("0")
      expect(marked[0].textContent).toContain("condition 1")
    })

    it("marks the deciding row in the block", async () => {
      const { container } = show(FAILS_AT_2)
      await heading()
      const marked = container.querySelectorAll('[data-deciding="true"]')
      expect(marked.length).toBe(1)
      expect(marked[0].getAttribute("data-condition")).toBe("2")
      expect(marked[0].textContent).toContain("condition 3")
    })
  })

  describe("visual weight", () => {
    const dimmed = () => rule().className.includes("opacity-60")

    for (const state of ["inactive", "scheduled", "expired", "never"] as const) {
      it(`dims the rule for ${state}`, async () => {
        show({ state, isActive: state !== "inactive" })
        await heading()
        expect(dimmed()).toBe(true)
      })
    }

    it("dims the rule for a policy that never applies", async () => {
      show(ALWAYS_FALSE)
      await heading()
      expect(dimmed()).toBe(true)
    })

    it("never dims an active fail-closed deny", async () => {
      show(FAILS_AT_0)
      await heading()
      expect(dimmed()).toBe(false)
    })

    it("dims an inactive fail-closed deny, which has no effect now", async () => {
      show({ ...FAILS_AT_0, state: "inactive", isActive: false })
      await heading()
      expect(dimmed()).toBe(true)
    })

    it("does not dim an active policy that behaves as written", async () => {
      show()
      await heading()
      expect(dimmed()).toBe(false)
    })

    it("dims every policy while policy evaluation is off, an active fail-closed deny included", async () => {
      show(FAILS_AT_0, { abacEnabled: false, rbacEnabled: true })
      await screen.findByText(ABAC_OFF)
      expect(dimmed()).toBe(true)
    })

    it("does not assume evaluation is off when the config cannot be read", async () => {
      renderPage(WardenPolicyDetailPage, stubClient({ "policies.detail": DETAIL }), {
        id: "pol_01",
      })
      await heading()
      expect(dimmed()).toBe(false)
    })
  })

  describe("deployment alerts", () => {
    it("says the policy takes no effect when policy evaluation is off", async () => {
      show({}, { abacEnabled: false, rbacEnabled: true })
      await screen.findByText(ABAC_OFF)
    })

    it("says nothing about evaluation when it is on", async () => {
      show()
      await heading()
      expect(screen.queryByText(ABAC_OFF)).toBeNull()
    })

    it("says nothing about evaluation when the config could not be read", async () => {
      renderPage(
        WardenPolicyDetailPage,
        stubClient({ "policies.detail": DETAIL }),
        { id: "pol_01" }
      )
      await heading()
      expect(screen.queryByText(ABAC_OFF)).toBeNull()
    })

    it("does not say a fail-closed deny applies while evaluation is off", async () => {
      show(FAILS_AT_0, { abacEnabled: false, rbacEnabled: true })
      await screen.findByText(ABAC_OFF)
      expect(callout()).toBeNull()
    })

    it("does not say a policy matches every check while evaluation is off", async () => {
      show(EVERYTHING, { abacEnabled: false, rbacEnabled: true })
      await screen.findByText(ABAC_OFF)
      expect(callout()).toBeNull()
      expect(screen.queryByText(/matches every check/)).toBeNull()
    })

    it("hides the never-applies callout while evaluation is off, as the alert covers it", async () => {
      show(ALWAYS_FALSE, { abacEnabled: false, rbacEnabled: true })
      await screen.findByText(ABAC_OFF)
      expect(callout()).toBeNull()
    })

    it("does not promise an inactive policy takes effect on activation while evaluation is off", async () => {
      show(INACTIVE, { abacEnabled: false, rbacEnabled: true })
      await screen.findByText(ABAC_OFF)
      expect(stateLine()!.querySelector("p")!.textContent).toBe("Inactive.")
      expect(screen.queryByText(/until you activate it/)).toBeNull()
    })

    it("does not promise a scheduled policy starts while evaluation is off", async () => {
      show({ state: "scheduled" }, { abacEnabled: false, rbacEnabled: true })
      await screen.findByText(ABAC_OFF)
      expect(stateLine()!.textContent).toBe("Its window opens on 1 Jun 2026, 00:00 UTC.")
    })

    it("does not say an expired policy was in effect while evaluation is off", async () => {
      show({ state: "expired" }, { abacEnabled: false, rbacEnabled: true })
      await screen.findByText(ABAC_OFF)
      expect(stateLine()!.textContent).toBe("Its window ended on 30 Jun 2026, 00:00 UTC.")
    })

    it("says nothing about role subjects when RBAC is off, because warden still resolves roles for policies", async () => {
      // engine.go evaluateABAC resolves the subject's roles itself when RBAC
      // is disabled, so role subjects still match.
      show({ subjects: [{ role: "contractor" }], hasRoleMatcher: true }, { abacEnabled: true, rbacEnabled: false })
      await heading()
      expect(screen.queryByText(/Role-based access/)).toBeNull()
      expect(screen.queryByText(/never applies/)).toBeNull()
    })
  })

  describe("the aside", () => {
    const aside = () => within(screen.getByRole("complementary"))

    it("says what priority decides and what it does not", async () => {
      show()
      await heading()
      expect(
        aside().getByText("Decides which policy is cited when several match, not which one wins.")
      ).toBeTruthy()
      expect(aside().getByText("10")).toBeTruthy()
    })

    it("renders the tenant root as a slash", async () => {
      show()
      await heading()
      expect(aside().getByText("/")).toBeTruthy()
      expect(aside().queryByText("root")).toBeNull()
    })

    it("sets the authors as identifiers", async () => {
      show()
      await heading()
      for (const who of ["usr_admin", "usr_ops"]) {
        const el = aside().getByText(who)
        expect(el.className).toContain("font-mono")
        expect(el.className).toContain("text-xs")
      }
    })

    it("labels absent authors as none", async () => {
      show({ createdBy: undefined, updatedBy: undefined })
      await heading()
      expect(aside().getByLabelText("no creator")).toBeTruthy()
      expect(aside().getByLabelText("no updater")).toBeTruthy()
    })
  })

  describe("activating and deactivating", () => {
    it("activates with exactly this id and active true", async () => {
      const { client: c, sent } = recording({ state: "inactive", isActive: false })
      renderPage(WardenPolicyDetailPage, c, { id: "pol_01" })
      await openDialog("Activate")
      expect(sent).toEqual([])
      fireEvent.click(dialog().getByRole("button", { name: "Activate" }))
      await waitFor(() => expect(sent.length).toBe(1))
      expect(sent[0]).toEqual({
        intent: "policies.setActive",
        payload: { id: "pol_01", active: true },
      })
      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    })

    it("deactivates with exactly this id and active false", async () => {
      const { client: c, sent } = recording()
      renderPage(WardenPolicyDetailPage, c, { id: "pol_01" })
      await openDialog("Deactivate")
      expect(dialog().getByText("It stops taking effect.")).toBeTruthy()
      fireEvent.click(dialog().getByRole("button", { name: "Deactivate" }))
      await waitFor(() => expect(sent.length).toBe(1))
      expect(sent[0]).toEqual({
        intent: "policies.setActive",
        payload: { id: "pol_01", active: false },
      })
    })

    it("says in the activate dialog that a fail-closed deny will apply once in effect", async () => {
      show({ ...FAILS_AT_0, ...INACTIVE, notBefore: undefined, notAfter: undefined })
      await openDialog("Activate")
      expect(dialog().getByText(THROWS_1)).toBeTruthy()
      expect(dialog().getByText(FAILS_0_ONCE)).toBeTruthy()
    })

    it("says in the activate dialog that a policy with nothing narrowing it will match every check", async () => {
      show({ ...EVERYTHING, ...INACTIVE, notBefore: undefined, notAfter: undefined })
      await openDialog("Activate")
      expect(dialog().getByText(MATCHES_EVERY_ONCE)).toBeTruthy()
    })

    it("says both halves in the activate dialog for a fail-closed deny with nothing narrowing it", async () => {
      show({ ...FAILS_EVERYTHING, ...INACTIVE, notBefore: undefined, notAfter: undefined })
      await openDialog("Activate")
      expect(
        dialog().getByText(
          "Condition 2 cannot be evaluated, so warden treats it, and every condition after it, as met."
        )
      ).toBeTruthy()
      expect(dialog().getByText(MATCHES_EVERY_ONCE)).toBeTruthy()
    })

    it("names an open window in the activate dialog, since it only applies inside it", async () => {
      show({ ...FAILS_AT_0, ...INACTIVE, ...OPEN })
      await openDialog("Activate")
      expect(
        dialog().getByText("In effect from 1 Jan 2020, 00:00 UTC until 31 Dec 2099, 00:00 UTC.")
      ).toBeTruthy()
    })

    it("says activating will not put a policy whose window has ended into effect", async () => {
      show({ ...FAILS_AT_0, ...INACTIVE, ...ENDED })
      await openDialog("Activate")
      expect(dialog().getByText(WINDOW_ENDED)).toBeTruthy()
      expect(screen.getByRole("alertdialog").textContent).not.toContain("Once it is in effect")
      expect(screen.getByRole("alertdialog").textContent).not.toContain("In effect from")
    })

    it("says activating will not put a policy with a backwards window into effect", async () => {
      show({ ...EVERYTHING, ...INACTIVE, ...INVERTED })
      await openDialog("Activate")
      expect(dialog().getByText(WINDOW_INVERTED)).toBeTruthy()
      expect(screen.getByRole("alertdialog").textContent).not.toContain("Once it is in effect")
    })

    describe("the deactivate dialog says what deactivating changes, by state", () => {
      const CASES: [string, Partial<PolicyDetail>, string][] = [
        ["an active policy in effect", {}, "It stops taking effect."],
        ["a scheduled policy", { state: "scheduled" }, "It will not take effect on 1 Jun 2026, 00:00 UTC."],
        ["an expired policy", { state: "expired" }, "It already takes no effect, because its window has ended."],
        [
          "a never-in-effect policy",
          { state: "never" },
          "It already takes no effect, because its window ends before it starts.",
        ],
        [
          "a policy that never applies",
          ALWAYS_FALSE,
          "It already takes no effect, because it never applies.",
        ],
      ]
      for (const [label, over, text] of CASES) {
        it(`for ${label}`, async () => {
          show(over)
          await openDialog("Deactivate")
          expect(dialog().getByText(text)).toBeTruthy()
          expect(dialog().queryByText(/until you activate it/)).toBeNull()
        })
      }
    })

    it("says a restricted policy with no window takes effect as soon as it is activated", async () => {
      show({ ...INACTIVE, notBefore: undefined, notAfter: undefined })
      await openDialog("Activate")
      expect(dialog().getByText("It takes effect as soon as you activate it.")).toBeTruthy()
    })

    it("does not say it takes effect at once when there is a window", async () => {
      show({ ...INACTIVE, ...OPEN })
      await openDialog("Activate")
      expect(dialog().queryByText("It takes effect as soon as you activate it.")).toBeNull()
      expect(
        dialog().getByText("In effect from 1 Jan 2020, 00:00 UTC until 31 Dec 2099, 00:00 UTC.")
      ).toBeTruthy()
    })

    it("says in the activate dialog that nothing will happen while evaluation is off", async () => {
      show({ ...FAILS_AT_0, ...INACTIVE, ...OPEN }, { abacEnabled: false })
      await screen.findByText(ABAC_OFF)
      fireEvent.click(screen.getByRole("button", { name: "Activate" }))
      await screen.findByRole("alertdialog")
      expect(dialog().getByText(ABAC_OFF)).toBeTruthy()
      expect(screen.getByRole("alertdialog").textContent).not.toMatch(/deny applies|Once it is in effect/)
    })

    it("does not say deactivating stops an effect the policy never had while evaluation is off", async () => {
      show({}, { abacEnabled: false, rbacEnabled: true })
      await screen.findByText(ABAC_OFF)
      fireEvent.click(screen.getByRole("button", { name: "Deactivate" }))
      await screen.findByRole("alertdialog")
      expect(dialog().getByText(ABAC_OFF)).toBeTruthy()
      expect(dialog().queryByText(/until you activate it/)).toBeNull()
    })

    it("shows the activate dialog as pending while the command is in flight", async () => {
      renderPage(
        WardenPolicyDetailPage,
        neverSettles({ state: "inactive", isActive: false }),
        { id: "pol_01" }
      )
      await openDialog("Activate")
      fireEvent.click(dialog().getByRole("button", { name: "Activate" }))
      const working = (await dialog().findByRole("button", { name: "Working…" })) as HTMLButtonElement
      expect(working.disabled).toBe(true)
      expect((dialog().getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true)
    })

    it("shows the deactivate dialog as pending while the command is in flight", async () => {
      renderPage(WardenPolicyDetailPage, neverSettles(), { id: "pol_01" })
      await openDialog("Deactivate")
      fireEvent.click(dialog().getByRole("button", { name: "Deactivate" }))
      const working = (await dialog().findByRole("button", { name: "Working…" })) as HTMLButtonElement
      expect(working.disabled).toBe(true)
      expect((dialog().getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true)
    })

    it("shows a refusal inside the dialog and stays open", async () => {
      renderPage(
        WardenPolicyDetailPage,
        refusing(new ContractError("FORBIDDEN", "not allowed to change policies")),
        { id: "pol_01" }
      )
      await openDialog("Deactivate")
      fireEvent.click(dialog().getByRole("button", { name: "Deactivate" }))
      const alert = await dialog().findByRole("alert")
      expect(alert.textContent).toContain("not allowed to change policies")
      expect(screen.getByRole("alertdialog")).toBeTruthy()
    })

    it("clears an earlier refusal when the dialog opens again", async () => {
      renderPage(
        WardenPolicyDetailPage,
        refusing(new ContractError("FORBIDDEN", "not allowed to change policies")),
        { id: "pol_01" }
      )
      await openDialog("Deactivate")
      fireEvent.click(dialog().getByRole("button", { name: "Deactivate" }))
      await dialog().findByRole("alert")
      fireEvent.click(dialog().getByRole("button", { name: "Cancel" }))
      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
      fireEvent.click(screen.getByRole("button", { name: "Deactivate" }))
      await screen.findByRole("alertdialog")
      expect(dialog().queryByRole("alert")).toBeNull()
    })
  })

  describe("deleting", () => {
    it("deletes exactly this id, then leaves for the policies list", async () => {
      const { client: c, sent } = recording()
      const { navigated } = showInHost(c)
      await openDialog("Delete")
      expect(sent).toEqual([])
      fireEvent.click(dialog().getByRole("button", { name: "Delete" }))
      expect(await screen.findByText("This policy has been deleted.")).toBeTruthy()
      expect(sent).toEqual([{ intent: "policies.delete", payload: { id: "pol_01" } }])
      expect(navigated).toEqual(["/@warden/acme/policies"])
      expect(screen.queryByRole("region", { name: "Rule" })).toBeNull()
    })

    it("shows the delete dialog as pending while the command is in flight", async () => {
      renderPage(WardenPolicyDetailPage, neverSettles(), { id: "pol_01" })
      await openDialog("Delete")
      fireEvent.click(dialog().getByRole("button", { name: "Delete" }))
      const working = (await dialog().findByRole("button", { name: "Working…" })) as HTMLButtonElement
      expect(working.disabled).toBe(true)
      expect((dialog().getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true)
    })

    it("shows a refusal inside the dialog, stays open, and does not leave", async () => {
      const { navigated } = showInHost(
        refusing(new ContractError("NOT_FOUND", "no such policy"))
      )
      await openDialog("Delete")
      fireEvent.click(dialog().getByRole("button", { name: "Delete" }))
      const alert = await dialog().findByRole("alert")
      expect(alert.textContent).toContain("no such policy")
      expect(navigated).toEqual([])
      expect(screen.queryByText("This policy has been deleted.")).toBeNull()
    })
  })

  describe("failing and loading", () => {
    it("surfaces a read failure rather than a blank page", async () => {
      renderPage(
        WardenPolicyDetailPage,
        failingClient(new ContractError("NOT_FOUND", "no such policy")),
        { id: "pol_01" }
      )
      const alert = await screen.findByRole("alert")
      expect(alert.textContent).toContain("NOT_FOUND")
      expect(screen.queryByRole("region", { name: "Rule" })).toBeNull()
    })

    it("shows a loading state while the read is in flight", async () => {
      renderPage(WardenPolicyDetailPage, pendingClient(), { id: "pol_01" })
      expect(await screen.findByRole("status", { name: /loading policy/i })).toBeTruthy()
    })
  })
})
