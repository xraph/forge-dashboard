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
const FAILS_CLOSED_AT_0 = `${THROWS_1} This deny applies to every check its subjects, actions and resources select.`
const FAILS_CLOSED_AT_0_ONCE = `${THROWS_1} Once it is in effect, this deny applies to every check its subjects, actions and resources select.`
const FAILS_CLOSED_LATER = `${THROWS_3} This deny applies whenever the conditions before it hold.`
const FAILS_CLOSED_LATER_ONCE = `${THROWS_3} Once it is in effect, this deny applies whenever the conditions before it hold.`
const NEVER_GRANTS = "Condition 2 cannot be evaluated, so this allow never grants anything."
const NEVER_APPLIES = "Condition 1 is always false, so this policy never applies."
const MATCHES_EVERY = "It matches every check in its namespace and below."
const MATCHES_EVERY_ONCE = "Once it is in effect, it matches every check in its namespace and below."
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

    it("renders the read view on the edit route, from the id in the route", async () => {
      // Where the create flow lands. Until the editor exists it must show the
      // policy, never a missing route.
      const { client: c, sent } = recordingQueryClient(answers(DETAIL))
      const Edit = route("/policies/:id/edit")!.element as ComponentType<PluginPageProps>
      renderPage(Edit, c, { id: "pol_01" })
      await heading()
      expect(rule()).toBeTruthy()
      expect(sent.filter((s) => s.intent === "policies.detail")).toEqual([
        { intent: "policies.detail", params: { id: "pol_01" } },
      ])
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
      show({ state: "inactive", isActive: false })
      await heading()
      expect(stateLine()!.querySelector("p")!.textContent).toBe(
        "Inactive. It takes no effect until you activate it."
      )
      expect(within(stateLine()!).getByRole("button", { name: "Activate" })).toBeTruthy()
      expect(screen.queryByRole("button", { name: "Deactivate" })).toBeNull()
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
    const inactive = { state: "inactive" as const, isActive: false }

    it("says an active deny failing at its first condition applies to every check it selects", async () => {
      show(FAILS_AT_0)
      await heading()
      expect(callout()!.textContent).toBe(FAILS_CLOSED_AT_0)
    })

    it("says an inactive deny failing at its first condition will apply once it is in effect", async () => {
      show({ ...FAILS_AT_0, ...inactive })
      await heading()
      expect(callout()!.textContent).toBe(FAILS_CLOSED_AT_0_ONCE)
      // Both lines: the state, and what taking effect will do.
      expect(stateLine()!.querySelector("p")!.textContent).toBe(
        "Inactive. It takes no effect until you activate it."
      )
    })

    it("says an active deny failing at a later condition applies whenever the ones before it hold", async () => {
      show(FAILS_AT_2)
      await heading()
      expect(callout()!.textContent).toBe(FAILS_CLOSED_LATER)
    })

    it("words a later fail-closed condition conditionally while the policy is not yet in effect", async () => {
      show({ ...FAILS_AT_2, state: "scheduled" })
      await heading()
      expect(callout()!.textContent).toBe(FAILS_CLOSED_LATER_ONCE)
    })

    for (const state of ["scheduled", "expired", "never"] as const) {
      it(`never uses the present tense for a fail-closed deny that is ${state}`, async () => {
        show({ ...FAILS_AT_0, state })
        await heading()
        expect(callout()!.textContent).toBe(FAILS_CLOSED_AT_0_ONCE)
        expect(screen.queryByText(/This deny applies/)).toBeNull()
      })
    }

    it("says an allow whose condition throws never grants anything", async () => {
      show(ALLOW_THROWS)
      await heading()
      expect(callout()!.textContent).toBe(NEVER_GRANTS)
    })

    it("says an inactive allow whose condition throws never grants anything, true in any state", async () => {
      show({ ...ALLOW_THROWS, ...inactive })
      await heading()
      expect(callout()!.textContent).toBe(NEVER_GRANTS)
    })

    it("says a policy with an always-false condition never applies", async () => {
      show(ALWAYS_FALSE)
      await heading()
      expect(callout()!.textContent).toBe(NEVER_APPLIES)
    })

    it("says an active policy the server flags matches every check", async () => {
      show(EVERYTHING)
      await heading()
      expect(callout()!.textContent).toBe(MATCHES_EVERY)
    })

    it("says an inactive policy the server flags will match every check once it is in effect", async () => {
      show({ ...EVERYTHING, ...inactive })
      await heading()
      expect(callout()!.textContent).toBe(MATCHES_EVERY_ONCE)
      expect(screen.queryByText(MATCHES_EVERY)).toBeNull()
    })

    it("words matches-every-check conditionally for an expired policy too", async () => {
      show({ ...EVERYTHING, state: "expired" })
      await heading()
      expect(callout()!.textContent).toBe(MATCHES_EVERY_ONCE)
    })

    it("reads matches-every-check from the server's flag, conditions and all", async () => {
      // The server walks the conditions; the page does not.
      show({
        ...EVERYTHING,
        conditions: [
          { field: "context.ip", operator: "starts_with", value: "", problem: "alwaysTrue", reason: "matchesAnything" },
        ],
      })
      await heading()
      expect(callout()!.textContent).toBe(MATCHES_EVERY)
    })

    it("does not claim every check when the server's flag is clear, whatever the matchers", async () => {
      show({ ...EVERYTHING, matchesEverything: false, conditions: [DEPENDS] })
      await heading()
      expect(callout()).toBeNull()
      expect(screen.queryByText(/matches every check/)).toBeNull()
    })

    it("shows no callout for a policy that behaves as written", async () => {
      show()
      await heading()
      expect(callout()).toBeNull()
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
      expect(dialog().getByText("It takes no effect until you activate it again.")).toBeTruthy()
      fireEvent.click(dialog().getByRole("button", { name: "Deactivate" }))
      await waitFor(() => expect(sent.length).toBe(1))
      expect(sent[0]).toEqual({
        intent: "policies.setActive",
        payload: { id: "pol_01", active: false },
      })
    })

    it("says in the activate dialog that a fail-closed deny will apply to every check it selects once in effect", async () => {
      show({ ...FAILS_AT_0, state: "inactive", isActive: false, notBefore: undefined, notAfter: undefined })
      await openDialog("Activate")
      expect(screen.getByRole("alertdialog").textContent).toContain(
        "Condition 1 cannot be evaluated, so warden treats it, and every condition after it, as met."
      )
      expect(
        dialog().getByText(
          "Once it is in effect, this deny applies to every check its subjects, actions and resources select."
        )
      ).toBeTruthy()
    })

    it("says in the activate dialog that a policy with nothing narrowing it matches every check", async () => {
      show({ ...EVERYTHING, state: "inactive", isActive: false, notBefore: undefined, notAfter: undefined })
      await openDialog("Activate")
      expect(dialog().getByText(MATCHES_EVERY_ONCE)).toBeTruthy()
    })

    it("names the window in the activate dialog, since it only applies inside it", async () => {
      show({ ...FAILS_AT_0, state: "inactive", isActive: false })
      await openDialog("Activate")
      expect(
        dialog().getByText("In effect from 1 Jun 2026, 00:00 UTC until 30 Jun 2026, 00:00 UTC.")
      ).toBeTruthy()
    })

    it("says in the activate dialog that nothing will happen while evaluation is off", async () => {
      show({ ...FAILS_AT_0, state: "inactive", isActive: false }, { abacEnabled: false })
      await screen.findByText(ABAC_OFF)
      fireEvent.click(screen.getByRole("button", { name: "Activate" }))
      await screen.findByRole("alertdialog")
      expect(dialog().getByText(ABAC_OFF)).toBeTruthy()
      expect(dialog().queryByText(/This deny applies/)).toBeNull()
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
