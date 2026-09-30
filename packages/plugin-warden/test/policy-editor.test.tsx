import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import {
  ContractError,
  NavigationProvider,
  PluginProvider,
} from "@forge-go/dashboard-plugin"
import type { ScopedClient } from "@forge-go/dashboard-plugin"
import {
  CHANGED_MID_CHECK,
  EMPTY_SUBJECT,
  PolicyEditor,
  boundTime,
  saveConfirmation,
  type PolicyDraft,
  type PolicyUpdatePayload,
  type PolicyValidateResponse,
} from "../src/components/policy-editor"
import { OPERATOR_WORDS, type PolicyDetail } from "../src/components/policy-rule"
// For its beforeEach, which clears the module-level query store.
import "./harness"

const NOW = new Date("2026-09-30T12:00:00Z")

const POLICY: PolicyDetail = {
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
    { id: "cond_a", field: "context.ip", operator: "not_in", value: ["10.0.0.0/8"] },
    { id: "cond_b", field: "subject.mfa", operator: "exists" },
  ],
  obligations: ["notify-security"],
  notBefore: "2026-06-01T00:00:00Z",
  notAfter: "2026-12-31T00:00:00Z",
  subjectsUnrestricted: false,
  actionsUnrestricted: false,
  resourcesUnrestricted: false,
  hasRoleMatcher: true,
  createdBy: "usr_admin",
  updatedBy: "usr_ops",
  createdAt: "2026-09-01T00:00:00Z",
}

/** The draft the editor sends to validate for POLICY as loaded. */
const LOADED_DRAFT: PolicyDraft = {
  name: "office-only",
  description: "Keeps deletes on the office network.",
  effect: "deny",
  priority: 10,
  notBefore: "2026-06-01T00:00:00Z",
  notAfter: "2026-12-31T00:00:00Z",
  subjects: [{ role: "contractor" }, { kind: "user", id: "usr_2f8a" }],
  actions: ["document:delete"],
  resources: ["document:*"],
  conditions: [
    { id: "cond_a", field: "context.ip", operator: "not_in", value: ["10.0.0.0/8"] },
    { id: "cond_b", field: "subject.mfa", operator: "exists" },
  ],
  obligations: ["notify-security"],
}

const VALID: PolicyValidateResponse = {
  valid: true,
  matchesEverything: false,
  fields: {},
  conditions: [],
}
const EVERYTHING: PolicyValidateResponse = { ...VALID, matchesEverything: true }

const DENY_NOW =
  "This deny will apply to every check in its namespace and below as soon as you save."
const ALLOW_NOW =
  "This allow will grant every check in its namespace and below that no deny policy refuses, as soon as you save."
const DENY_WHENEVER =
  "This deny will apply to every check in its namespace and below whenever its window is open."
const ALLOW_WHENEVER =
  "This allow will grant every check in its namespace and below that no deny policy refuses, whenever its window is open."
const ALLOW_FROM =
  "This allow will grant every check in its namespace and below that no deny policy refuses, from 15 Oct 2026, 09:00 UTC."

interface Options {
  validate?: (draft: PolicyDraft) => PolicyValidateResponse | Promise<PolicyValidateResponse>
  update?: unknown
}

/**
 * Answers policies.validate from `validate` and policies.update from
 * `update`: a value resolves, a ContractError rejects, "never" never settles.
 * Records every query and command, with what it sent.
 */
function editorClient(opts: Options = {}) {
  const queries: { intent: string; params?: unknown }[] = []
  const commands: { intent: string; payload?: unknown }[] = []
  const client = {
    extension: "warden",
    query: async (intent: string, params?: Record<string, unknown>) => {
      queries.push({ intent, params })
      if (intent === "policies.validate") {
        return (opts.validate ?? (() => VALID))(params as unknown as PolicyDraft)
      }
      throw new ContractError("NOT_FOUND", `no handler for intent "${intent}"`)
    },
    command: (intent: string, payload?: unknown) => {
      commands.push({ intent, payload })
      if (intent !== "policies.update") {
        return Promise.reject(new ContractError("NOT_FOUND", `no handler for "${intent}"`))
      }
      if (typeof opts.update === "function") return opts.update(payload)
      if (opts.update === "never") return new Promise<never>(() => {})
      if (opts.update instanceof ContractError) return Promise.reject(opts.update)
      return Promise.resolve(opts.update ?? {})
    },
  } as unknown as ScopedClient
  return { client, queries, commands }
}

function renderEditor(
  over: Partial<PolicyDetail> = {},
  opts: Options = {},
  evaluationOff = false
) {
  const { client, queries, commands } = editorClient(opts)
  const navigated: string[] = []
  const utils = render(
    <PluginProvider client={client}>
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
        <PolicyEditor policy={{ ...POLICY, ...over }} evaluationOff={evaluationOff} />
      </NavigationProvider>
    </PluginProvider>
  )
  const validates = () => queries.filter((q) => q.intent === "policies.validate")
  const updates = () =>
    commands.filter((c) => c.intent === "policies.update").map((c) => c.payload as PolicyUpdatePayload)
  return { ...utils, navigated, validates, updates, commands }
}

/** Lets the debounce fire and the validate answer land. */
async function settle() {
  await act(async () => {
    vi.advanceTimersByTime(400)
  })
  await act(async () => {})
}

async function save() {
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
  await act(async () => {})
}

const dialog = () => within(screen.getByRole("alertdialog"))
const input = (name: string) => screen.getByRole("textbox", { name }) as HTMLInputElement
const labelled = (name: string) => screen.getByLabelText(name) as HTMLInputElement
const change = (el: Element, value: string) => fireEvent.change(el, { target: { value } })
const row = (i: number) => document.querySelector(`[data-condition="${i}"]`) as HTMLElement
const issues = (part: string) =>
  Array.from(document.querySelectorAll(`[data-issue="${part}"]`)).map((e) => e.textContent)

function addEntry(noun: string, value: string) {
  change(input(`New ${noun}`), value)
  fireEvent.click(screen.getByRole("button", { name: `Add ${noun}` }))
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(NOW)
})
afterEach(() => {
  vi.useRealTimers()
})

describe("PolicyEditor", () => {
  describe("the update payload", () => {
    /**
     * Each part in the states it can be changed into. Every case sends the id
     * and exactly the one part it changed: every other part is untouched and
     * so absent, which `Object.keys` pins.
     */
    const cases: {
      name: string
      act: () => void
      want: Omit<PolicyUpdatePayload, "id">
    }[] = [
      { name: "name changed", act: () => change(labelled("Name"), "office-hours"), want: { name: "office-hours" } },
      { name: "description changed", act: () => change(labelled("Description"), "New words."), want: { description: "New words." } },
      { name: "description cleared", act: () => change(labelled("Description"), ""), want: { description: "" } },
      { name: "effect changed", act: () => fireEvent.click(screen.getByRole("button", { name: "Allow" })), want: { effect: "allow" } },
      { name: "priority changed", act: () => change(labelled("Priority"), "25"), want: { priority: 25 } },
      { name: "start changed", act: () => change(input("In effect from"), "2026-07-01T00:00:00Z"), want: { notBefore: "2026-07-01T00:00:00Z" } },
      { name: "start cleared", act: () => fireEvent.click(screen.getByRole("button", { name: "Clear start" })), want: { notBefore: "" } },
      { name: "end changed", act: () => change(input("In effect until"), "2027-01-31T00:00:00Z"), want: { notAfter: "2027-01-31T00:00:00Z" } },
      { name: "end cleared", act: () => fireEvent.click(screen.getByRole("button", { name: "Clear end" })), want: { notAfter: "" } },
      {
        name: "subjects changed",
        act: () => {
          change(screen.getByRole("combobox", { name: "New subject kind" }), "service")
          change(input("New subject id"), "svc_1")
          fireEvent.click(screen.getByRole("button", { name: "Add subject" }))
        },
        want: { subjects: [{ role: "contractor" }, { kind: "user", id: "usr_2f8a" }, { kind: "service", id: "svc_1" }] },
      },
      {
        name: "subjects cleared",
        act: () => {
          fireEvent.click(screen.getByRole("button", { name: "Remove subject role: contractor" }))
          fireEvent.click(screen.getByRole("button", { name: "Remove subject user: usr_2f8a" }))
        },
        want: { subjects: [] },
      },
      { name: "actions changed", act: () => addEntry("action", "document:read"), want: { actions: ["document:delete", "document:read"] } },
      { name: "actions cleared", act: () => fireEvent.click(screen.getByRole("button", { name: "Remove action document:delete" })), want: { actions: [] } },
      { name: "resources changed", act: () => addEntry("resource", "report:*"), want: { resources: ["document:*", "report:*"] } },
      { name: "resources cleared", act: () => fireEvent.click(screen.getByRole("button", { name: "Remove resource document:*" })), want: { resources: [] } },
      { name: "obligations changed", act: () => addEntry("obligation", "page-oncall"), want: { obligations: ["notify-security", "page-oncall"] } },
      { name: "obligations cleared", act: () => fireEvent.click(screen.getByRole("button", { name: "Remove obligation notify-security" })), want: { obligations: [] } },
      {
        name: "conditions changed",
        act: () => change(input("Condition 2 field"), "subject.otp"),
        want: {
          conditions: [
            { id: "cond_a", field: "context.ip", operator: "not_in", value: ["10.0.0.0/8"] },
            { id: "cond_b", field: "subject.otp", operator: "exists" },
          ],
        },
      },
      {
        name: "conditions cleared",
        act: () => {
          fireEvent.click(screen.getByRole("button", { name: "Remove condition 2" }))
          fireEvent.click(screen.getByRole("button", { name: "Remove condition 1" }))
        },
        want: { conditions: [] },
      },
    ]

    it.each(cases)("sends only the id and the part: $name", async ({ act: doIt, want }) => {
      const { updates } = renderEditor()
      doIt()
      await save()
      expect(updates()).toEqual([{ id: "pol_01", ...want }])
      expect(Object.keys(updates()[0])).toEqual(["id", ...Object.keys(want)])
    })

    it("sends every changed part together, and still leaves the untouched ones out", async () => {
      const { updates } = renderEditor()
      change(labelled("Name"), "office-hours")
      fireEvent.click(screen.getByRole("button", { name: "Remove action document:delete" }))
      fireEvent.click(screen.getByRole("button", { name: "Clear end" }))
      await save()
      expect(updates()).toEqual([
        { id: "pol_01", name: "office-hours", notAfter: "", actions: [] },
      ])
      expect(Object.keys(updates()[0]).sort()).toEqual(["actions", "id", "name", "notAfter"])
    })

    it("cannot save a policy nothing has changed on", async () => {
      renderEditor()
      const button = screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement
      expect(button.disabled).toBe(true)
      change(labelled("Name"), "office-hours")
      change(labelled("Name"), "office-only")
      expect(button.disabled).toBe(true)
    })

    it("refuses a priority that is not a whole number, and sends nothing", async () => {
      const { updates } = renderEditor()
      change(labelled("Priority"), "2.5")
      expect(issues("priority")).toEqual(["Priority must be a whole number."])
      const button = screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement
      expect(button.disabled).toBe(true)
      await save()
      expect(updates()).toEqual([])
    })
  })

  describe("condition values", () => {
    it("sends a number as a JSON number", async () => {
      const { updates } = renderEditor()
      change(screen.getByRole("combobox", { name: "Condition 1 operator" }), "gt")
      change(labelled("Condition 1 value"), "5")
      await save()
      const sent = updates()[0].conditions!
      expect(sent[0]).toEqual({ id: "cond_a", field: "context.ip", operator: "gt", value: 5 })
      expect(typeof sent[0].value).toBe("number")
    })

    it("sends a list as a JSON array", async () => {
      const { updates } = renderEditor()
      fireEvent.click(screen.getByRole("button", { name: "Add condition" }))
      change(input("Condition 3 field"), "subject.dept")
      change(screen.getByRole("combobox", { name: "Condition 3 operator" }), "in")
      addEntry("value for condition 3", "eng")
      addEntry("value for condition 3", "ops")
      await save()
      const sent = updates()[0].conditions!
      expect(sent[2]).toEqual({ field: "subject.dept", operator: "in", value: ["eng", "ops"] })
      expect(Array.isArray(sent[2].value)).toBe(true)
    })

    it("sends one or more networks as a JSON array", async () => {
      const { updates } = renderEditor()
      change(screen.getByRole("combobox", { name: "Condition 1 operator" }), "ip_in_cidr")
      addEntry("network for condition 1", "192.168.0.0/16")
      await save()
      expect(updates()[0].conditions![0]).toEqual({
        id: "cond_a",
        field: "context.ip",
        operator: "ip_in_cidr",
        value: ["10.0.0.0/8", "192.168.0.0/16"],
      })
    })

    it("sends exists and does not exist with no value key", async () => {
      const { updates } = renderEditor()
      fireEvent.click(screen.getByRole("button", { name: "Add condition" }))
      change(input("Condition 3 field"), "subject.otp")
      change(screen.getByRole("combobox", { name: "Condition 3 operator" }), "not_exists")
      await save()
      const sent = updates()[0].conditions!
      expect(Object.keys(sent[1])).toEqual(["id", "field", "operator"])
      expect(Object.keys(sent[2])).toEqual(["field", "operator"])
      expect(sent[2]).toEqual({ field: "subject.otp", operator: "not_exists" })
    })

    it("drops the value when an operator changes to exists", async () => {
      const { updates } = renderEditor()
      change(screen.getByRole("combobox", { name: "Condition 1 operator" }), "exists")
      await save()
      expect(updates()[0].conditions![0]).toEqual({
        id: "cond_a",
        field: "context.ip",
        operator: "exists",
      })
      expect(Object.keys(updates()[0].conditions![0])).toEqual(["id", "field", "operator"])
    })

    it("keeps each stored condition's id and sends none for a new row", async () => {
      const { updates } = renderEditor()
      change(input("Condition 1 field"), "context.client_ip")
      fireEvent.click(screen.getByRole("button", { name: "Add condition" }))
      change(input("Condition 3 field"), "resource.owner")
      change(input("Condition 3 value"), "usr_1")
      await save()
      expect(updates()[0].conditions).toEqual([
        { id: "cond_a", field: "context.client_ip", operator: "not_in", value: ["10.0.0.0/8"] },
        { id: "cond_b", field: "subject.mfa", operator: "exists" },
        { field: "resource.owner", operator: "eq", value: "usr_1" },
      ])
      expect(Object.keys(updates()[0].conditions![2])).toEqual(["field", "operator", "value"])
    })

    it("keeps a remaining row's id when an earlier row is removed", async () => {
      const { updates } = renderEditor()
      fireEvent.click(screen.getByRole("button", { name: "Remove condition 1" }))
      await save()
      expect(updates()[0].conditions).toEqual([
        { id: "cond_b", field: "subject.mfa", operator: "exists" },
      ])
    })

    it("sends an untouched row's stored value exactly, whatever its JSON type", async () => {
      const { updates } = renderEditor({
        conditions: [
          { id: "cond_a", field: "subject.level", operator: "gt", value: "7" },
          { id: "cond_b", field: "subject.mfa", operator: "exists" },
        ],
      })
      change(input("Condition 2 field"), "subject.otp")
      await save()
      expect(updates()[0].conditions).toEqual([
        { id: "cond_a", field: "subject.level", operator: "gt", value: "7" },
        { id: "cond_b", field: "subject.otp", operator: "exists" },
      ])
    })

    it("clears a list when the operator changes from in to greater than", async () => {
      const { updates } = renderEditor({
        conditions: [{ id: "cond_a", field: "subject.level", operator: "in", value: ["1", "2"] }],
      })
      expect(screen.getByRole("button", { name: "Remove value for condition 1 1" })).toBeTruthy()
      change(screen.getByRole("combobox", { name: "Condition 1 operator" }), "gt")
      expect(screen.queryByRole("button", { name: "Remove value for condition 1 1" })).toBeNull()
      const value = labelled("Condition 1 value")
      expect(value.type).toBe("number")
      expect(value.value).toBe("")
      change(value, "3")
      await save()
      expect(updates()[0].conditions).toEqual([
        { id: "cond_a", field: "subject.level", operator: "gt", value: 3 },
      ])
    })

    it("clears text when the operator changes from equals to at least", () => {
      renderEditor({
        conditions: [{ id: "cond_a", field: "subject.dept", operator: "eq", value: "eng" }],
      })
      expect(input("Condition 1 value").value).toBe("eng")
      change(screen.getByRole("combobox", { name: "Condition 1 operator" }), "gte")
      expect(labelled("Condition 1 value").value).toBe("")
    })

    it("keeps a list when the operator changes between two that read one", () => {
      renderEditor()
      change(screen.getByRole("combobox", { name: "Condition 1 operator" }), "in")
      expect(screen.getByRole("button", { name: "Remove value for condition 1 10.0.0.0/8" })).toBeTruthy()
    })

    it("offers exactly the 17 operators, by their words", () => {
      renderEditor()
      const options = Array.from(
        screen.getByRole("combobox", { name: "Condition 1 operator" }).querySelectorAll("option")
      )
      expect(options.map((o) => o.value)).toEqual(Object.keys(OPERATOR_WORDS))
      expect(options.map((o) => o.textContent)).toEqual([
        "equals",
        "does not equal",
        "in",
        "not in",
        "contains",
        "starts with",
        "ends with",
        "greater than",
        "less than",
        "at least",
        "at most",
        "exists",
        "does not exist",
        "in network",
        "after",
        "before",
        "matches",
      ])
    })

    const kinds: [string, string | null, string][] = [
      ["eq", "text", "text"],
      ["neq", "text", "text"],
      ["contains", "text", "text"],
      ["starts_with", "text", "text"],
      ["ends_with", "text", "text"],
      ["in", "list", "chips"],
      ["not_in", "list", "chips"],
      ["ip_in_cidr", "cidr", "chips"],
      ["time_after", "time", "text"],
      ["time_before", "time", "text"],
      ["gt", "number", "number"],
      ["lt", "number", "number"],
      ["gte", "number", "number"],
      ["lte", "number", "number"],
      ["regex", "pattern", "text"],
      ["exists", null, "none"],
      ["not_exists", null, "none"],
    ]
    it.each(kinds)("gives %s the value input for its type", (op, kind, shape) => {
      renderEditor({ conditions: [{ id: "cond_a", field: "subject.x", operator: op }] })
      const el = row(0).querySelector("[data-value-kind]") as HTMLElement | null
      if (kind === null) {
        expect(el).toBeNull()
        return
      }
      expect(el!.getAttribute("data-value-kind")).toBe(kind)
      if (shape === "number") expect((el as HTMLInputElement).type).toBe("number")
      if (shape === "text") expect((el as HTMLInputElement).type).toBe("text")
      if (shape === "chips") expect(el!.tagName).toBe("SPAN")
    })

    it("shows the RFC3339 shape for a time and a pattern for matches", () => {
      renderEditor({
        conditions: [
          { id: "cond_a", field: "context.time", operator: "time_after", value: "2026-06-01T09:00:00Z" },
          { id: "cond_b", field: "subject.dept", operator: "regex", value: "^eng-" },
        ],
      })
      expect(input("Condition 1 value").placeholder).toBe("RFC3339 time")
      expect(input("Condition 2 value").placeholder).toBe("pattern")
      expect(input("Condition 1 value").value).toBe("2026-06-01T09:00:00Z")
      expect(input("Condition 2 value").value).toBe("^eng-")
    })
  })

  describe("the matcher rows", () => {
    it("shows any action once every action chip is removed", () => {
      renderEditor()
      const actionRow = document.querySelector('[data-row="action"]') as HTMLElement
      expect(actionRow.textContent).not.toContain("any action")
      fireEvent.click(screen.getByRole("button", { name: "Remove action document:delete" }))
      expect(within(actionRow).getByText("any action")).toBeTruthy()
    })

    it("shows anyone and any resource once every chip is removed", () => {
      renderEditor()
      fireEvent.click(screen.getByRole("button", { name: "Remove subject role: contractor" }))
      fireEvent.click(screen.getByRole("button", { name: "Remove subject user: usr_2f8a" }))
      fireEvent.click(screen.getByRole("button", { name: "Remove resource document:*" }))
      const subjectRow = document.querySelector('[data-row="subject"]') as HTMLElement
      const resourceRow = document.querySelector('[data-row="resource"]') as HTMLElement
      expect(within(subjectRow).getByText("anyone")).toBeTruthy()
      expect(within(resourceRow).getByText("any resource")).toBeTruthy()
    })

    it("puts or between chips", () => {
      renderEditor()
      const subjectRow = document.querySelector('[data-row="subject"]') as HTMLElement
      expect(subjectRow.textContent).toContain("role: contractoror")
    })

    it("offers exactly warden's four subject kinds", () => {
      renderEditor()
      const options = Array.from(
        screen.getByRole("combobox", { name: "New subject kind" }).querySelectorAll("option")
      )
      expect(options.map((o) => o.value)).toEqual(["", "user", "api_key", "service", "service_acct"])
    })

    it("refuses an empty subject matcher with the server's sentence, and adds nothing", async () => {
      const { updates } = renderEditor()
      change(input("New subject id"), "   ")
      fireEvent.click(screen.getByRole("button", { name: "Add subject" }))
      expect(issues("new-subject")).toEqual([EMPTY_SUBJECT])
      expect(EMPTY_SUBJECT).toBe(
        "An empty subject matcher matches everyone. To mean everyone, remove every subject instead."
      )
      expect((screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(true)
      await save()
      expect(updates()).toEqual([])
    })

    it("adds a subject from its three parts, ANDed into one chip", () => {
      renderEditor()
      change(screen.getByRole("combobox", { name: "New subject kind" }), "user")
      change(input("New subject role"), "editor")
      fireEvent.click(screen.getByRole("button", { name: "Add subject" }))
      expect(screen.getByRole("button", { name: "Remove subject user with role editor" })).toBeTruthy()
    })

    it("colours only a chosen Deny", () => {
      renderEditor()
      const deny = screen.getByRole("button", { name: "Deny" })
      const allow = screen.getByRole("button", { name: "Allow" })
      expect(deny.getAttribute("aria-pressed")).toBe("true")
      expect(deny.className.split(/\s+/)).toContain("text-destructive")
      expect(allow.className.split(/\s+/)).not.toContain("text-destructive")
      fireEvent.click(allow)
      expect(allow.getAttribute("aria-pressed")).toBe("true")
      expect(deny.className.split(/\s+/)).not.toContain("text-destructive")
    })

    it("reads an effect that is not exactly allow as Deny", () => {
      renderEditor({ effect: "block" })
      expect(screen.getByRole("button", { name: "Deny" }).getAttribute("aria-pressed")).toBe("true")
    })
  })

  describe("live validation", () => {
    it("sends one validate request with the final draft after several quick edits", async () => {
      // Time moves only when the test moves it, so a slow run cannot let the
      // debounce fire between the edits.
      vi.useRealTimers()
      vi.useFakeTimers()
      vi.setSystemTime(NOW)
      const { validates } = renderEditor()
      change(labelled("Description"), "a")
      await act(async () => {
        vi.advanceTimersByTime(200)
      })
      change(labelled("Description"), "ab")
      await act(async () => {
        vi.advanceTimersByTime(200)
      })
      change(labelled("Description"), "abc")
      await act(async () => {
        vi.advanceTimersByTime(399)
      })
      expect(validates()).toEqual([])
      await act(async () => {
        vi.advanceTimersByTime(1)
      })
      expect(validates()).toEqual([
        { intent: "policies.validate", params: { ...LOADED_DRAFT, description: "abc" } },
      ])
    })

    it("marks the exact rows the response names, two at once, with its messages", async () => {
      renderEditor(
        {
          conditions: [
            { id: "c0", field: "action.verb", operator: "neq", value: "x" },
            { id: "c1", field: "subject.dept", operator: "eq", value: "eng" },
            { id: "c2", field: "context.ip", operator: "in", value: "10.0.0.0/8" },
          ],
        },
        {
          validate: () => ({
            valid: false,
            matchesEverything: false,
            fields: { actions: "An entry is empty.", window: "The end must be after the start." },
            conditions: [
              { index: 0, message: 'Warden never gives "action.verb" a value.' },
              { index: 2, message: "This operator needs a list of values." },
            ],
          }),
        }
      )
      await settle()
      expect(row(0).getAttribute("data-invalid")).toBe("true")
      expect(row(1).getAttribute("data-invalid")).toBeNull()
      expect(row(2).getAttribute("data-invalid")).toBe("true")
      expect(issues("condition-0")).toEqual(['Warden never gives "action.verb" a value.'])
      expect(issues("condition-1")).toEqual([])
      expect(issues("condition-2")).toEqual(["This operator needs a list of values."])
      expect(issues("actions")).toEqual(["An entry is empty."])
      expect(issues("window")).toEqual(["The end must be after the start."])
      expect(issues("name")).toEqual([])
    })

    it("drops the marks as soon as the draft changes", async () => {
      renderEditor(
        {},
        {
          validate: () => ({
            ...VALID,
            valid: false,
            fields: { name: "A policy needs a name." },
            conditions: [{ index: 1, message: "bad row" }],
          }),
        }
      )
      await settle()
      expect(issues("condition-1")).toEqual(["bad row"])
      change(labelled("Description"), "changed")
      expect(issues("condition-1")).toEqual([])
      expect(issues("name")).toEqual([])
    })
  })

  describe("a refused save", () => {
    const refusal = new ContractError(
      "BAD_REQUEST",
      "This policy cannot be saved: 1 condition(s) and 1 field(s) need fixing.",
      {
        fields: { window: "The end must be after the start." },
        conditions: [{ index: 1, message: "The value must be an RFC3339 time, like 2026-06-01T09:00:00Z." }],
      }
    )

    it("marks the rows from details, keeps the form open and every typed value", async () => {
      const { navigated, updates } = renderEditor({}, { update: refusal })
      change(labelled("Description"), "typed description")
      change(input("In effect until"), "2026-05-01T00:00:00Z")
      change(input("Condition 2 field"), "context.time")
      change(screen.getByRole("combobox", { name: "Condition 2 operator" }), "time_after")
      change(input("Condition 2 value"), "tomorrow")
      await save()
      expect(updates()).toHaveLength(1)
      expect(navigated).toEqual([])
      expect(screen.getByRole("region", { name: "Rule editor" })).toBeTruthy()
      expect(screen.getByRole("alert").textContent).toContain(
        "This policy cannot be saved: 1 condition(s) and 1 field(s) need fixing."
      )
      expect(row(1).getAttribute("data-invalid")).toBe("true")
      expect(row(0).getAttribute("data-invalid")).toBeNull()
      expect(issues("condition-1")).toEqual([
        "The value must be an RFC3339 time, like 2026-06-01T09:00:00Z.",
      ])
      expect(issues("window")).toEqual(["The end must be after the start."])
      expect(labelled("Description").value).toBe("typed description")
      expect(input("In effect until").value).toBe("2026-05-01T00:00:00Z")
      expect(input("Condition 2 field").value).toBe("context.time")
      expect(
        (screen.getByRole("combobox", { name: "Condition 2 operator" }) as HTMLSelectElement).value
      ).toBe("time_after")
      expect(input("Condition 2 value").value).toBe("tomorrow")
    })
  })

  describe("pending", () => {
    it("shows Save as pending while the update is in flight", async () => {
      renderEditor({}, { update: "never" })
      change(labelled("Description"), "x")
      await save()
      const saving = screen.getByRole("button", { name: "Saving…" }) as HTMLButtonElement
      expect(saving.disabled).toBe(true)
      expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true)
    })

    it("shows the confirm dialog as pending while the update is in flight", async () => {
      renderEditor({}, { validate: () => EVERYTHING, update: "never" })
      change(labelled("Description"), "x")
      await settle()
      await save()
      await screen.findByRole("alertdialog")
      fireEvent.click(dialog().getByRole("button", { name: "Save changes" }))
      const working = (await dialog().findByRole("button", { name: "Working…" })) as HTMLButtonElement
      expect(working.disabled).toBe(true)
      expect((dialog().getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true)
    })
  })

  describe("the save confirmation", () => {
    it("confirms an active deny the server says matches every check, and sends nothing until confirmed", async () => {
      const { updates, navigated } = renderEditor({}, { validate: () => EVERYTHING })
      fireEvent.click(screen.getByRole("button", { name: "Remove action document:delete" }))
      await settle()
      await save()
      await screen.findByRole("alertdialog")
      expect(dialog().getByText(DENY_NOW)).toBeTruthy()
      expect(updates()).toEqual([])
      fireEvent.click(dialog().getByRole("button", { name: "Save changes" }))
      await act(async () => {})
      expect(updates()).toEqual([{ id: "pol_01", actions: [] }])
      expect(navigated).toEqual(["/@warden/acme/policies/pol_01"])
    })

    it("says grant for an allow", async () => {
      renderEditor({}, { validate: () => EVERYTHING })
      fireEvent.click(screen.getByRole("button", { name: "Allow" }))
      await settle()
      await save()
      await screen.findByRole("alertdialog")
      expect(dialog().getByText(ALLOW_NOW)).toBeTruthy()
    })

    it("says deny for an effect that is not exactly allow", async () => {
      renderEditor({ effect: "block" }, { validate: () => EVERYTHING })
      change(labelled("Description"), "x")
      await settle()
      await save()
      await screen.findByRole("alertdialog")
      expect(dialog().getByText(DENY_NOW)).toBeTruthy()
    })

    it("names the start for a saved window that has not opened", async () => {
      renderEditor(
        { state: "scheduled", notBefore: "2026-10-15T09:00:00Z" },
        { validate: () => EVERYTHING }
      )
      change(labelled("Description"), "x")
      await settle()
      await save()
      await screen.findByRole("alertdialog")
      expect(
        dialog().getByText(
          "This deny will apply to every check in its namespace and below from 15 Oct 2026, 09:00 UTC."
        )
      ).toBeTruthy()
      expect(screen.getByRole("alertdialog").textContent).not.toContain("as soon as you save")
    })

    it("names the start for an allow whose saved window has not opened", async () => {
      renderEditor(
        { effect: "allow", state: "scheduled", notBefore: "2026-10-15T09:00:00Z" },
        { validate: () => EVERYTHING }
      )
      change(labelled("Description"), "x")
      await settle()
      await save()
      await screen.findByRole("alertdialog")
      expect(dialog().getByText(ALLOW_FROM)).toBeTruthy()
      expect(screen.getByRole("alertdialog").textContent).not.toContain("as soon as you save")
    })

    it("names the start when the edit moves it into the future", async () => {
      renderEditor({}, { validate: () => EVERYTHING })
      change(input("In effect from"), "2026-11-01T00:00:00Z")
      await settle()
      await save()
      await screen.findByRole("alertdialog")
      expect(
        dialog().getByText(
          "This deny will apply to every check in its namespace and below from 1 Nov 2026, 00:00 UTC."
        )
      ).toBeTruthy()
    })

    it("says as soon as you save when the edit clears a start that had not come", async () => {
      renderEditor(
        { state: "scheduled", notBefore: "2026-10-15T09:00:00Z" },
        { validate: () => EVERYTHING }
      )
      fireEvent.click(screen.getByRole("button", { name: "Clear start" }))
      await settle()
      await save()
      await screen.findByRole("alertdialog")
      expect(dialog().getByText(DENY_NOW)).toBeTruthy()
    })

    it("confirms a comma-decimal start the server accepts", async () => {
      const { updates } = renderEditor({}, { validate: () => EVERYTHING })
      change(input("In effect from"), "2026-09-30T11:00:00,5Z")
      await settle()
      await save()
      await screen.findByRole("alertdialog")
      expect(dialog().getByText(DENY_NOW)).toBeTruthy()
      expect(updates()).toEqual([])
    })

    it("does not confirm a patched window the server refuses", async () => {
      const { updates } = renderEditor(
        {},
        {
          validate: () => ({
            ...EVERYTHING,
            valid: false,
            fields: { window: "The start is not an RFC3339 time." },
          }),
        }
      )
      change(input("In effect from"), "2026-09-30 11:00:00Z")
      await settle()
      await save()
      expect(screen.queryByRole("alertdialog")).toBeNull()
      expect(updates()).toEqual([{ id: "pol_01", notBefore: "2026-09-30 11:00:00Z" }])
    })

    it("judges the window again on confirm, and asks again when the sentence changed", async () => {
      const { updates } = renderEditor(
        { state: "scheduled", notBefore: "2026-09-30T12:01:00Z" },
        { validate: () => EVERYTHING }
      )
      change(labelled("Description"), "x")
      await settle()
      await save()
      await screen.findByRole("alertdialog")
      expect(
        dialog().getByText(
          "This deny will apply to every check in its namespace and below from 30 Sept 2026, 12:01 UTC."
        )
      ).toBeTruthy()
      vi.setSystemTime(new Date("2026-09-30T12:02:00Z"))
      fireEvent.click(dialog().getByRole("button", { name: "Save changes" }))
      await act(async () => {})
      expect(updates()).toEqual([])
      expect(dialog().getByText(DENY_NOW)).toBeTruthy()
      fireEvent.click(dialog().getByRole("button", { name: "Save changes" }))
      await act(async () => {})
      expect(updates()).toEqual([{ id: "pol_01", description: "x" }])
    })

    it("saves without another question when the window ends while the dialog is open", async () => {
      const { updates } = renderEditor(
        { notAfter: "2026-09-30T12:01:00Z" },
        { validate: () => EVERYTHING }
      )
      change(labelled("Description"), "x")
      await settle()
      await save()
      await screen.findByRole("alertdialog")
      expect(dialog().getByText(DENY_NOW)).toBeTruthy()
      vi.setSystemTime(new Date("2026-09-30T12:02:00Z"))
      fireEvent.click(dialog().getByRole("button", { name: "Save changes" }))
      await act(async () => {})
      expect(updates()).toEqual([{ id: "pol_01", description: "x" }])
    })

    it("does not confirm an inactive policy saved into the same shape", async () => {
      const { updates } = renderEditor(
        { isActive: false, state: "inactive" },
        { validate: () => EVERYTHING }
      )
      fireEvent.click(screen.getByRole("button", { name: "Remove action document:delete" }))
      await settle()
      await save()
      expect(screen.queryByRole("alertdialog")).toBeNull()
      expect(updates()).toEqual([{ id: "pol_01", actions: [] }])
    })

    it("does not confirm when the saved window has ended", async () => {
      const { updates } = renderEditor(
        { state: "expired", notAfter: "2026-09-01T00:00:00Z" },
        { validate: () => EVERYTHING }
      )
      change(labelled("Description"), "x")
      await settle()
      await save()
      expect(screen.queryByRole("alertdialog")).toBeNull()
      expect(updates()).toEqual([{ id: "pol_01", description: "x" }])
    })

    it("does not confirm when the edit closes the window", async () => {
      const { updates } = renderEditor({}, { validate: () => EVERYTHING })
      change(input("In effect until"), "2026-09-01T00:00:00Z")
      await settle()
      await save()
      expect(screen.queryByRole("alertdialog")).toBeNull()
      expect(updates()).toEqual([{ id: "pol_01", notAfter: "2026-09-01T00:00:00Z" }])
    })

    it("does not confirm when the stored window ends before it starts", async () => {
      const { updates } = renderEditor(
        { state: "never", notBefore: "2026-12-01T00:00:00Z", notAfter: "2026-11-01T00:00:00Z" },
        { validate: () => EVERYTHING }
      )
      change(labelled("Description"), "x")
      await settle()
      await save()
      expect(screen.queryByRole("alertdialog")).toBeNull()
      expect(updates()).toHaveLength(1)
    })

    it("does not confirm while policy evaluation is off", async () => {
      const { updates } = renderEditor({}, { validate: () => EVERYTHING }, true)
      change(labelled("Description"), "x")
      await settle()
      await save()
      expect(screen.queryByRole("alertdialog")).toBeNull()
      expect(updates()).toHaveLength(1)
    })

    it("reads the server's flag, not its own count, when the draft still has matchers", async () => {
      // Every matcher is restricted on screen. Only the server's answer says
      // this draft matches everything, and the page must believe it.
      renderEditor({}, { validate: () => EVERYTHING })
      change(labelled("Description"), "x")
      await settle()
      await save()
      await screen.findByRole("alertdialog")
      expect(dialog().getByText(DENY_NOW)).toBeTruthy()
    })

    it("reads the server's flag, not its own count, when every matcher is empty", async () => {
      const { updates } = renderEditor({ conditions: [] }, { validate: () => VALID })
      fireEvent.click(screen.getByRole("button", { name: "Remove subject role: contractor" }))
      fireEvent.click(screen.getByRole("button", { name: "Remove subject user: usr_2f8a" }))
      fireEvent.click(screen.getByRole("button", { name: "Remove action document:delete" }))
      fireEvent.click(screen.getByRole("button", { name: "Remove resource document:*" }))
      await settle()
      await save()
      expect(screen.queryByRole("alertdialog")).toBeNull()
      expect(updates()).toEqual([{ id: "pol_01", subjects: [], actions: [], resources: [] }])
    })

    it("asks validate about the exact draft when Save beats the debounce", async () => {
      // Time moves only when the test moves it, so the debounce cannot catch
      // up on its own before Save is pressed.
      vi.useRealTimers()
      vi.useFakeTimers()
      vi.setSystemTime(NOW)
      const { validates, updates } = renderEditor(
        {},
        {
          validate: (d) => ({ ...VALID, matchesEverything: (d.actions ?? []).length === 0 }),
        }
      )
      await settle()
      expect(validates()).toHaveLength(1)
      fireEvent.click(screen.getByRole("button", { name: "Remove action document:delete" }))
      await save()
      await act(async () => {})
      expect(validates()).toHaveLength(2)
      expect(validates()[1].params).toEqual({ ...LOADED_DRAFT, actions: [] })
      expect(dialog().getByText(DENY_NOW)).toBeTruthy()
      expect(updates()).toEqual([])
    })

    it("sends nothing when the dialog is cancelled", async () => {
      const { updates } = renderEditor({}, { validate: () => EVERYTHING })
      change(labelled("Description"), "x")
      await settle()
      await save()
      await screen.findByRole("alertdialog")
      fireEvent.click(dialog().getByRole("button", { name: "Cancel" }))
      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
      expect(updates()).toEqual([])
    })

    it("closes the dialog on a refusal that names rows, and marks them on the form", async () => {
      const refusal = new ContractError("BAD_REQUEST", "This policy cannot be saved.", {
        fields: {},
        conditions: [{ index: 0, message: "This operator needs a list of values." }],
      })
      renderEditor({}, { validate: () => EVERYTHING, update: refusal })
      change(labelled("Description"), "x")
      await settle()
      await save()
      await screen.findByRole("alertdialog")
      fireEvent.click(dialog().getByRole("button", { name: "Save changes" }))
      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
      expect(issues("condition-0")).toEqual(["This operator needs a list of values."])
      expect(screen.getByRole("alert").textContent).toContain("This policy cannot be saved.")
    })

    it("keeps any other refusal inside the dialog", async () => {
      renderEditor(
        {},
        {
          validate: () => EVERYTHING,
          update: new ContractError("FORBIDDEN", "not allowed to change policies"),
        }
      )
      change(labelled("Description"), "x")
      await settle()
      await save()
      await screen.findByRole("alertdialog")
      fireEvent.click(dialog().getByRole("button", { name: "Save changes" }))
      const alert = await dialog().findByRole("alert")
      expect(alert.textContent).toContain("not allowed to change policies")
    })
  })

  describe("a confirmation belongs to one save", () => {
    const marked = (message: string) =>
      new ContractError("BAD_REQUEST", "This policy cannot be saved.", {
        fields: { name: message },
        conditions: [],
      })

    /** Answers each update in turn: a ContractError rejects, "never" never settles. */
    function inTurn(results: unknown[]) {
      let call = 0
      return () => {
        const r = results[call++]
        if (r === "never") return new Promise<never>(() => {})
        return r instanceof ContractError ? Promise.reject(r) : Promise.resolve(r ?? {})
      }
    }

    it("does not bring back a refused confirmation over a later save, nor send its patch", async () => {
      // The reviewer's probe: a confirmed save refused with marks, the fix,
      // then a save that needs no confirmation and is refused again.
      const { updates } = renderEditor(
        {},
        {
          validate: (d) => ({ ...VALID, matchesEverything: d.name === "bad" }),
          update: inTurn([marked("That name is taken."), marked("Still refused.")]),
        }
      )
      change(labelled("Name"), "bad")
      await settle()
      await save()
      await screen.findByRole("alertdialog")
      expect(dialog().getByText(DENY_NOW)).toBeTruthy()
      fireEvent.click(dialog().getByRole("button", { name: "Save changes" }))
      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
      expect(issues("name")).toEqual(["That name is taken."])

      change(labelled("Name"), "good")
      await settle()
      await save()
      await act(async () => {})
      expect(screen.queryByRole("alertdialog")).toBeNull()
      expect(issues("name")).toEqual(["Still refused."])
      expect(updates()).toEqual([
        { id: "pol_01", name: "bad" },
        { id: "pol_01", name: "good" },
      ])
    })

    it("does not bring back a refused confirmation over a later save of the same draft", async () => {
      // The window ends between the two saves, so the second needs no
      // confirmation, and the draft is the same one the first was for.
      const { updates } = renderEditor(
        { notAfter: "2026-09-30T12:01:00Z" },
        { validate: () => EVERYTHING, update: inTurn([marked("Refused once."), "never"]) }
      )
      change(labelled("Description"), "x")
      await settle()
      await save()
      await screen.findByRole("alertdialog")
      fireEvent.click(dialog().getByRole("button", { name: "Save changes" }))
      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())

      vi.setSystemTime(new Date("2026-09-30T12:02:00Z"))
      await save()
      await act(async () => {})
      expect(screen.queryByRole("alertdialog")).toBeNull()
      expect(screen.getByRole("button", { name: "Saving…" })).toBeTruthy()
      expect(updates()).toEqual([
        { id: "pol_01", description: "x" },
        { id: "pol_01", description: "x" },
      ])
    })

    it("takes the dialog down, and sends nothing, when the draft changes under it", async () => {
      const { updates } = renderEditor({}, { validate: () => EVERYTHING })
      change(labelled("Description"), "x")
      await settle()
      await save()
      await screen.findByRole("alertdialog")
      // The form is inert behind the dialog; this stands for any change
      // that still reaches the draft.
      change(labelled("Description"), "y")
      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
      expect(updates()).toEqual([])
      await settle()
      await save()
      await screen.findByRole("alertdialog")
      fireEvent.click(dialog().getByRole("button", { name: "Save changes" }))
      await act(async () => {})
      expect(updates()).toEqual([{ id: "pol_01", description: "y" }])
    })

    it("sends nothing when the draft changes while Save is checking it", async () => {
      vi.useRealTimers()
      vi.useFakeTimers()
      vi.setSystemTime(NOW)
      let resolve!: (v: PolicyValidateResponse) => void
      const pending = new Promise<PolicyValidateResponse>((r) => {
        resolve = r
      })
      const { updates } = renderEditor({}, { validate: () => pending })
      change(labelled("Description"), "x")
      await save()
      change(labelled("Description"), "y")
      await act(async () => {
        resolve(EVERYTHING)
      })
      await act(async () => {})
      expect(screen.queryByRole("alertdialog")).toBeNull()
      expect(updates()).toEqual([])
      expect(screen.getByRole("status").textContent).toBe(CHANGED_MID_CHECK)
      expect(CHANGED_MID_CHECK).toBe(
        "The draft changed while it was being checked, so nothing was saved. Save again to save it."
      )
    })
  })

  describe("saveConfirmation", () => {
    const base = {
      loaded: POLICY,
      effect: "deny",
      notBefore: POLICY.notBefore!,
      notAfter: POLICY.notAfter!,
      matchesEverything: true,
      windowRefused: false,
      evaluationOff: false,
      now: NOW.getTime(),
    }

    it("returns each sentence only when the saved policy takes effect", () => {
      expect(saveConfirmation(base)).toBe(DENY_NOW)
      expect(saveConfirmation({ ...base, effect: "allow" })).toBe(ALLOW_NOW)
      expect(
        saveConfirmation({ ...base, effect: "allow", notBefore: "2026-10-15T09:00:00Z" })
      ).toBe(ALLOW_FROM)
      expect(saveConfirmation({ ...base, matchesEverything: false })).toBeNull()
      expect(saveConfirmation({ ...base, evaluationOff: true })).toBeNull()
      expect(saveConfirmation({ ...base, loaded: { ...POLICY, isActive: false } })).toBeNull()
      expect(saveConfirmation({ ...base, notAfter: "2026-09-29T00:00:00Z" })).toBeNull()
    })

    it("returns nothing for a patched window the server's answer refuses", () => {
      expect(
        saveConfirmation({ ...base, notBefore: "2026-11-01T00:00:00Z", windowRefused: true })
      ).toBeNull()
    })

    it("still confirms when the server marks a window the edit did not touch", () => {
      // An untouched window is not part of the update, so it is never refused.
      expect(saveConfirmation({ ...base, windowRefused: true })).toBe(DENY_NOW)
    })

    it("confirms without naming a time when it cannot place a bound the server accepts", () => {
      expect(saveConfirmation({ ...base, notBefore: "not a time the page reads" })).toBe(
        DENY_WHENEVER
      )
      expect(
        saveConfirmation({ ...base, effect: "allow", notAfter: "not a time the page reads" })
      ).toBe(ALLOW_WHENEVER)
    })

    it("still returns nothing for a known end that has passed, whatever the start", () => {
      expect(
        saveConfirmation({ ...base, notBefore: "not a time", notAfter: "2026-09-29T00:00:00Z" })
      ).toBeNull()
    })

    it("places a comma-decimal time as Go does", () => {
      expect(boundTime("2026-09-30T11:00:00,5Z")).toBe(Date.parse("2026-09-30T11:00:00.5Z"))
      expect(saveConfirmation({ ...base, notBefore: "2026-09-30T11:00:00,5Z" })).toBe(DENY_NOW)
    })

    it("counts no bound as open", () => {
      expect(saveConfirmation({ ...base, notBefore: "", notAfter: "" })).toBe(DENY_NOW)
    })

    it("treats a start equal to now as open", () => {
      expect(
        saveConfirmation({ ...base, notBefore: "2026-09-30T12:00:00Z", notAfter: "" })
      ).toBe(DENY_NOW)
      expect(
        saveConfirmation({ ...base, notBefore: "2026-09-30T12:00:01Z", notAfter: "" })
      ).toBe(
        "This deny will apply to every check in its namespace and below from 30 Sept 2026, 12:00:01 UTC."
      )
    })

    it("treats an end equal to now as not yet ended", () => {
      expect(saveConfirmation({ ...base, notAfter: "2026-09-30T12:00:00Z" })).toBe(DENY_NOW)
      expect(saveConfirmation({ ...base, notAfter: "2026-09-30T11:59:59Z" })).toBeNull()
    })

    it("treats a stored start equal to its end as a window, not an inverted one", () => {
      const at = "2026-10-01T00:00:00Z"
      const loaded = { ...POLICY, notBefore: at, notAfter: at }
      expect(saveConfirmation({ ...base, loaded, notBefore: at, notAfter: at })).toBe(
        "This deny will apply to every check in its namespace and below from 1 Oct 2026, 00:00 UTC."
      )
    })
  })

  describe("a save the operator walks away from", () => {
    function deferred() {
      let resolve!: (v: PolicyValidateResponse) => void
      let reject!: (e: unknown) => void
      const promise = new Promise<PolicyValidateResponse>((res, rej) => {
        resolve = res
        reject = rej
      })
      return { promise, resolve, reject }
    }

    beforeEach(() => {
      // Time moves only when the test moves it, so the debounce never
      // answers first and Save always has to check.
      vi.useRealTimers()
      vi.useFakeTimers()
      vi.setSystemTime(NOW)
    })

    it("disables Cancel while the draft is being checked", async () => {
      const check = deferred()
      const { navigated } = renderEditor({}, { validate: () => check.promise })
      change(labelled("Description"), "x")
      await save()
      expect(screen.getByRole("button", { name: "Checking…" })).toBeTruthy()
      const cancel = screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement
      expect(cancel.disabled).toBe(true)
      fireEvent.click(cancel)
      expect(navigated).toEqual([])
    })

    it("sends nothing and navigates nowhere when the editor is left mid-check", async () => {
      const check = deferred()
      const { navigated, updates, unmount } = renderEditor({}, { validate: () => check.promise })
      change(labelled("Description"), "x")
      await save()
      unmount()
      await act(async () => {
        check.resolve(VALID)
      })
      await act(async () => {})
      expect(updates()).toEqual([])
      expect(navigated).toEqual([])
    })

    it("sends nothing when the check fails, and says so in the form", async () => {
      const { updates } = renderEditor(
        {},
        {
          validate: () => {
            throw new ContractError("TRANSPORT", "the network is down")
          },
        }
      )
      change(labelled("Description"), "x")
      await save()
      await act(async () => {})
      expect(updates()).toEqual([])
      const alert = screen.getByRole("alert")
      expect(alert.textContent).toContain("Could not check the draft")
      expect(alert.textContent).toContain("the network is down")
      expect(screen.queryByRole("alertdialog")).toBeNull()
    })
  })

  describe("leaving", () => {
    it("goes back to the read view after a save succeeds", async () => {
      const { navigated, updates } = renderEditor()
      change(labelled("Description"), "x")
      await save()
      expect(updates()).toEqual([{ id: "pol_01", description: "x" }])
      expect(navigated).toEqual(["/@warden/acme/policies/pol_01"])
    })

    it("goes back to the read view on Cancel and sends nothing", () => {
      const { navigated, commands } = renderEditor()
      change(labelled("Description"), "x")
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
      expect(navigated).toEqual(["/@warden/acme/policies/pol_01"])
      expect(commands).toEqual([])
    })
  })
})
