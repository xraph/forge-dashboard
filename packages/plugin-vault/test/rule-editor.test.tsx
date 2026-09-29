import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import {
  ContractError,
  NavigationProvider,
  PluginProvider,
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

const RULES = [
  rule({ id: "rul_1", priority: 0, type: "when_tenant", tenantIds: ["t-beta"] }),
  rule({ id: "rul_2", priority: 1, type: "when_user", userIds: ["u-1"], returnValue: false }),
  rule({ id: "rul_3", priority: 2, type: "rollout", percentage: 25 }),
]

function detail(over: Record<string, unknown> = {}) {
  return {
    flag: flag(),
    variants: [] as unknown[],
    metadata: {} as Record<string, string>,
    rules: RULES as unknown[],
    overrides: [] as unknown[],
    recentAudit: [] as unknown[],
    cacheTtlSeconds: 30,
    ...over,
  }
}

interface Sent {
  intent: string
  payload?: unknown
}

interface Setup {
  sent: Sent[]
  queries: { intent: string; params?: unknown }[]
  /** Commands that were sent to flags.setRules. */
  saves: () => { key: string; rules: Record<string, unknown>[] }[]
}

/** How the page's commands answer. */
type Commands = (intent: string, payload: unknown) => unknown | Promise<unknown>

function setup(
  page: unknown = detail(),
  commands: Commands = () => ({ rules: [] }),
  extra: Record<string, unknown> = {},
): Setup {
  const sent: Sent[] = []
  const queries: Setup["queries"] = []
  const inner = stubClient({ "flags.detail": page, ...extra }, {})
  const client = {
    extension: inner.extension,
    query: (intent: string, params?: Record<string, unknown>) => {
      queries.push({ intent, params })
      return inner.query(intent, params)
    },
    command: async (intent: string, payload?: unknown) => {
      sent.push({ intent, payload })
      return commands(intent, payload)
    },
  } as ScopedClient
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
        <a href="/@vault/flags">Elsewhere</a>
        <FlagDetailPage params={{ key: KEY }} />
      </NavigationProvider>
    </PluginProvider>,
  )
  return {
    sent,
    queries,
    saves: () =>
      sent
        .filter((s) => s.intent === "flags.setRules")
        .map((s) => s.payload as { key: string; rules: Record<string, unknown>[] }),
  }
}

const rung = () => document.querySelector('[data-rung="rules"]') as HTMLElement
const ready = () => screen.findByRole("heading", { name: KEY })
const rows = () => Array.from(rung().querySelectorAll("[data-rule-row]")) as HTMLElement[]
const rowText = (row: HTMLElement) => row.querySelector('[data-slot="row-lead"]')?.textContent

async function edit() {
  await ready()
  fireEvent.click(within(rung()).getByRole("button", { name: "Edit rules" }))
  await waitFor(() => expect(rows().length).toBeGreaterThanOrEqual(0))
}

const save = () => screen.getByRole("button", { name: "Save rules" }) as HTMLButtonElement
const openRow = (n: number) => fireEvent.click(screen.getByRole("button", { name: `Edit rule ${n}` }))

beforeEach(() => {
  vi.spyOn(window, "confirm").mockReturnValue(true)
})
afterEach(() => {
  vi.restoreAllMocks()
})

/**
 * jsdom lays nothing out: every rect is zero, so the keyboard sensor has no
 * geometry to move by. Stack the rows 100px apart, in DOM order.
 */
function stackRows() {
  const original = Element.prototype.getBoundingClientRect
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const row = this.closest("[data-rule-row]")
    if (row === null || row !== this) return original.call(this)
    const list = Array.from(document.querySelectorAll("[data-rule-row]"))
    const top = list.indexOf(row) * 100
    return {
      x: 0,
      y: top,
      top,
      left: 0,
      width: 400,
      height: 50,
      right: 400,
      bottom: top + 50,
      toJSON: () => ({}),
    } as DOMRect
  })
}

/**
 * Lifts rule `n` with Space, moves it with `keys`, drops it with Space. The
 * sensor listens on the document, and only after a tick, so each step waits.
 */
async function drag(n: number, keys: string[], beforeDrop?: () => void) {
  const tick = () =>
    act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
  const handle = screen.getByRole("button", { name: `Drag to reorder rule ${n}` })
  handle.focus()
  fireEvent.keyDown(handle, { code: "Space", key: " " })
  await tick()
  for (const key of keys) {
    fireEvent.keyDown(document, { code: key, key })
    await tick()
  }
  beforeDrop?.()
  fireEvent.keyDown(document, { code: "Space", key: " " })
  await tick()
}


const words = (row: HTMLElement) => row.textContent ?? ""

describe("rule editor: drag reorder", () => {
  it("sends the rules in the order they were dragged into", async () => {
    stackRows()
    const { saves } = setup()
    await edit()
    await drag(1, ["ArrowDown"])
    expect(words(rows()[0]!)).toContain("User is one of")
    expect(words(rows()[1]!)).toContain("Tenant is one of")
    fireEvent.click(save())
    await waitFor(() => expect(saves()).toHaveLength(1))
    expect(saves()[0]!.rules.map((r) => r.type)).toEqual(["when_user", "when_tenant", "rollout"])
  })

  it("moves a rule to the end and sends that order", async () => {
    stackRows()
    const { saves } = setup()
    await edit()
    await drag(1, ["ArrowDown", "ArrowDown"])
    fireEvent.click(save())
    await waitFor(() => expect(saves()).toHaveLength(1))
    expect(saves()[0]!.rules.map((r) => r.type)).toEqual(["when_user", "rollout", "when_tenant"])
  })

  it("moves a rule up", async () => {
    stackRows()
    const { saves } = setup()
    await edit()
    await drag(3, ["ArrowUp", "ArrowUp"])
    fireEvent.click(save())
    await waitFor(() => expect(saves()).toHaveLength(1))
    expect(saves()[0]!.rules.map((r) => r.type)).toEqual(["rollout", "when_tenant", "when_user"])
  })

  it("renumbers the rows while the drag is still going", async () => {
    stackRows()
    setup()
    await edit()
    let during: string[] = []
    await drag(1, ["ArrowDown"], () => {
      during = rows().map((r) => rowText(r) ?? "")
    })
    // The DOM has not reordered yet, but the lifted rule is already number 2
    // and the one it passed is already number 1.
    expect(during).toEqual(["2", "1", "3"])
    expect(rows().map((r) => rowText(r))).toEqual(["1", "2", "3"])
    expect(words(rows()[0]!)).toContain("User is one of")
  })

  it("does not reorder when the drag is cancelled", async () => {
    stackRows()
    const { saves } = setup()
    await edit()
    const handle = screen.getByRole("button", { name: "Drag to reorder rule 1" })
    handle.focus()
    fireEvent.keyDown(handle, { code: "Space", key: " " })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
    fireEvent.keyDown(document, { code: "ArrowDown", key: "ArrowDown" })
    fireEvent.keyDown(document, { code: "Escape", key: "Escape" })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
    expect(rows().map((r) => rowText(r))).toEqual(["1", "2", "3"])
    fireEvent.click(save())
    await waitFor(() => expect(saves()).toHaveLength(1))
    expect(saves()[0]!.rules.map((r) => r.type)).toEqual(["when_tenant", "when_user", "rollout"])
  })

  it("keeps what was typed in a row when the row moves", async () => {
    stackRows()
    const { saves } = setup()
    await edit()
    openRow(3)
    fireEvent.change(screen.getByRole("textbox", { name: "Percentage of tenants" }), { target: { value: "60" } })
    await drag(3, ["ArrowUp", "ArrowUp"])
    fireEvent.click(save())
    await waitFor(() => expect(saves()).toHaveLength(1))
    expect(saves()[0]!.rules[0]).toMatchObject({ type: "rollout", percentage: 60 })
  })
})

const CUSTOM = rule({
  id: "rul_c",
  priority: 3,
  type: "custom",
  implemented: false,
  evaluator: "beta-users",
  params: { n: 1, nested: { list: ["a", 2] } },
  returnValue: true,
})
const TAG = rule({
  id: "rul_t",
  priority: 4,
  type: "when_tenant_tag",
  implemented: false,
  tagKey: "tier",
  tagValue: "gold",
  returnValue: false,
})

describe("rule editor: opening and saving", () => {
  it("offers Edit rules in rung 3's actions, and no editor until it is pressed", async () => {
    setup()
    await ready()
    const header = rung().querySelector('[data-slot="rung-body"] > div') as HTMLElement
    const actions = header.lastElementChild as HTMLElement
    expect(within(actions).getByRole("button", { name: "Edit rules" })).toBeTruthy()
    // Nothing else on the page is called that, and no draft is open.
    expect(screen.queryByRole("button", { name: "Save rules" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Add rule" })).toBeNull()
    expect(screen.getAllByRole("button", { name: "Edit rules" })).toHaveLength(1)
  })

  it("swaps the rules for a draft, with Save, Discard and Add", async () => {
    setup()
    await edit()
    expect(rows()).toHaveLength(3)
    expect(screen.getByRole("button", { name: "Save rules" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Discard" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Add rule" })).toBeTruthy()
    expect(within(rung()).queryByRole("button", { name: "Edit rules" })).toBeNull()
  })

  it("sends the whole list, in order, each rule with only its own fields", async () => {
    const { saves } = setup()
    await edit()
    fireEvent.click(save())
    await waitFor(() => expect(saves()).toHaveLength(1))
    expect(saves()[0]).toEqual({
      key: KEY,
      rules: [
        { type: "when_tenant", tenantIds: ["t-beta"], returnValue: true },
        { type: "when_user", userIds: ["u-1"], returnValue: false },
        { type: "rollout", percentage: 25, returnValue: true },
      ],
    })
  })

  it("sends the rules field, as [], when every rule was removed", async () => {
    const { saves } = setup()
    await edit()
    for (let n = 3; n >= 1; n--) {
      fireEvent.click(screen.getByRole("button", { name: `Remove rule ${n}` }))
    }
    expect(rows()).toHaveLength(0)
    expect(within(rung()).getByText(/No rules\./)).toBeTruthy()
    fireEvent.click(save())
    await waitFor(() => expect(saves()).toHaveLength(1))
    expect(saves()[0]).toEqual({ key: KEY, rules: [] })
  })

  it("sends a custom rule and a tag rule back with their config as they were read", async () => {
    const { saves } = setup(detail({ rules: [...RULES, CUSTOM, TAG] }))
    await edit()
    fireEvent.click(save())
    await waitFor(() => expect(saves()).toHaveLength(1))
    const sent = saves()[0]!.rules
    expect(sent[3]).toEqual({
      type: "custom",
      evaluator: "beta-users",
      params: { n: 1, nested: { list: ["a", 2] } },
      returnValue: true,
    })
    expect(sent[4]).toEqual({
      type: "when_tenant_tag",
      tagKey: "tier",
      tagValue: "gold",
      returnValue: false,
    })
  })

  it("shows a custom or tag rule as a read-only summary with Never matches, and Remove", async () => {
    setup(detail({ rules: [CUSTOM, TAG] }))
    await edit()
    const [custom, tag] = rows()
    expect(within(custom!).getByText("Never matches")).toBeTruthy()
    expect(within(custom!).getByText(/Custom evaluator/)).toBeTruthy()
    expect(within(tag!).getByText("Never matches")).toBeTruthy()
    expect(within(tag!).getByText(/Tenant tag/)).toBeTruthy()
    // Their form has a return value and nothing else to edit.
    expect(within(custom!).queryByRole("textbox")).toBeNull()
    expect(within(custom!).getByRole("button", { name: "Remove rule 1" })).toBeTruthy()
    fireEvent.click(within(custom!).getByRole("button", { name: "Remove rule 1" }))
    expect(rows()).toHaveLength(1)
  })

  it("can remove a dead rule and saves the rest", async () => {
    const { saves } = setup(detail({ rules: [CUSTOM, RULES[0]] }))
    await edit()
    fireEvent.click(screen.getByRole("button", { name: "Remove rule 1" }))
    fireEvent.click(save())
    await waitFor(() => expect(saves()).toHaveLength(1))
    expect(saves()[0]!.rules).toEqual([
      { type: "when_tenant", tenantIds: ["t-beta"], returnValue: true },
    ])
  })

  it("closes the editor on a successful save", async () => {
    setup()
    await edit()
    fireEvent.click(save())
    await waitFor(() => expect(screen.queryByRole("button", { name: "Save rules" })).toBeNull())
    expect(within(rung()).getByRole("button", { name: "Edit rules" })).toBeTruthy()
  })

  it("keeps the draft and shows the error above the list when the save fails", async () => {
    const { saves } = setup(detail(), () => {
      throw new ContractError("BAD_REQUEST", "flag: rules[1].config.userIds: must list at least one id")
    })
    await edit()
    fireEvent.click(screen.getByRole("button", { name: "Remove rule 1" }))
    fireEvent.click(save())
    await waitFor(() => expect(saves()).toHaveLength(1))
    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toContain("Could not save the rules")
    expect(alert.textContent).toContain("rules[1].config.userIds")
    // Above the list, and the draft as it was: rule 1 is still gone.
    const list = rung().querySelector("ul[role='list'][aria-label='Rules']") as HTMLElement
    expect(alert.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(rows()).toHaveLength(2)
    expect((save() as HTMLButtonElement).disabled).toBe(false)
    // And a retry sends the same draft again.
    fireEvent.click(save())
    await waitFor(() => expect(saves()).toHaveLength(2))
    expect(saves()[1]).toEqual(saves()[0])
  })

  it("disables the controls while the save is in flight, and sends it once", async () => {
    const { saves } = setup(detail(), () => new Promise(() => {}))
    await edit()
    fireEvent.click(save())
    await waitFor(() => expect(saves()).toHaveLength(1))
    expect(screen.getByRole("button", { name: "Saving…" })).toHaveProperty("disabled", true)
    expect(screen.getByRole("button", { name: "Discard" })).toHaveProperty("disabled", true)
    expect(screen.getByRole("button", { name: "Add rule" })).toHaveProperty("disabled", true)
    // The row controls sit in a disabled fieldset: a button's own `disabled`
    // stays false there, `:disabled` is what a user experiences.
    expect(screen.getByRole("button", { name: "Drag to reorder rule 1" }).matches(":disabled")).toBe(true)
    expect(screen.getByRole("button", { name: "Remove rule 1" }).matches(":disabled")).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "Saving…" }))
    expect(saves()).toHaveLength(1)
  })
})

describe("rule editor: return value", () => {
  it("sends a bool flag's return value as a boolean", async () => {
    const { saves } = setup(detail({ rules: [rule({ type: "when_user", userIds: ["u-1"], returnValue: true })] }))
    await edit()
    openRow(1)
    fireEvent.click(within(rows()[0]!).getByRole("button", { name: "false" }))
    fireEvent.click(save())
    await waitFor(() => expect(saves()).toHaveLength(1))
    expect(saves()[0]!.rules[0]!.returnValue).toBe(false)
  })

  it("sends an int flag's return value as a number", async () => {
    const { saves } = setup(
      detail({
        flag: flag({ type: "int", defaultValue: 1 }),
        rules: [rule({ type: "when_user", userIds: ["u-1"], returnValue: 3 })],
      }),
    )
    await edit()
    openRow(1)
    fireEvent.change(within(rows()[0]!).getByLabelText("Return value"), { target: { value: "42" } })
    fireEvent.click(save())
    await waitFor(() => expect(saves()).toHaveLength(1))
    expect(saves()[0]!.rules[0]!.returnValue).toBe(42)
  })

  it("holds Save while a return value is not valid, and says which rule", async () => {
    setup(
      detail({
        flag: flag({ type: "json", defaultValue: {} }),
        rules: [rule({ type: "when_user", userIds: ["u-1"], returnValue: { a: 1 } })],
      }),
    )
    await edit()
    openRow(1)
    fireEvent.change(within(rows()[0]!).getByLabelText("Return value"), { target: { value: "{" } })
    expect(save().disabled).toBe(true)
    expect(screen.getByText("Rule 1: It needs a return value.")).toBeTruthy()
  })

  it("makes an operator choose a value for a rule whose saved one is the wrong type", async () => {
    setup(
      detail({
        rules: [rule({ type: "when_user", userIds: ["u-1"], returnValue: "yes", returnMatchesType: false })],
      }),
    )
    await edit()
    expect(save().disabled).toBe(true)
    expect(screen.getByText("Rule 1: It needs a return value.")).toBeTruthy()
    openRow(1)
    fireEvent.click(within(rows()[0]!).getByRole("button", { name: "true" }))
    expect(save().disabled).toBe(false)
  })
})

describe("rule editor: add menu", () => {
  it("offers exactly the four types the engine can match", async () => {
    setup()
    await edit()
    fireEvent.click(screen.getByRole("button", { name: "Add rule" }))
    const items = await screen.findAllByRole("menuitem")
    expect(items.map((i) => i.textContent)).toEqual([
      "Tenant is one of",
      "User is one of",
      "Rollout",
      "Schedule",
    ])
  })

  it.each([
    ["Tenant is one of", "Tenant ids"],
    ["User is one of", "User ids"],
    ["Rollout", "Percentage of tenants"],
    ["Schedule", "Start (UTC)"],
  ])("adds a %s rule at the end, open on its own field", async (item, field) => {
    setup()
    await edit()
    fireEvent.click(screen.getByRole("button", { name: "Add rule" }))
    fireEvent.click(await screen.findByRole("menuitem", { name: item }))
    expect(rows()).toHaveLength(4)
    expect(within(rows()[3]!).getByText(field)).toBeTruthy()
    expect(within(rows()[3]!).getByRole("button", { name: "Close rule 4" })).toBeTruthy()
  })

  it("holds Save until a new rule is filled in, then sends it", async () => {
    const { saves } = setup(detail({ rules: [] }))
    await edit()
    fireEvent.click(screen.getByRole("button", { name: "Add rule" }))
    fireEvent.click(await screen.findByRole("menuitem", { name: "Tenant is one of" }))
    expect(save().disabled).toBe(true)
    expect(screen.getByText("Rule 1: Add at least one tenant id.")).toBeTruthy()
    const row = rows()[0]!
    const ids = within(row).getByLabelText("Tenant ids")
    fireEvent.change(ids, { target: { value: "t-acme" } })
    fireEvent.keyDown(ids, { key: "Enter" })
    expect(save().disabled).toBe(true)
    expect(screen.getByText("Rule 1: It needs a return value.")).toBeTruthy()
    fireEvent.click(within(row).getByRole("button", { name: "true" }))
    expect(save().disabled).toBe(false)
    fireEvent.click(save())
    await waitFor(() => expect(saves()).toHaveLength(1))
    expect(saves()[0]).toEqual({
      key: KEY,
      rules: [{ type: "when_tenant", tenantIds: ["t-acme"], returnValue: true }],
    })
  })

  it("names the FIRST invalid rule", async () => {
    setup(detail({ rules: [RULES[0], rule({ type: "when_user", userIds: [] }), rule({ type: "when_tenant", tenantIds: [] })] }))
    await edit()
    expect(screen.getByText("Rule 2: Add at least one user id.")).toBeTruthy()
    expect(screen.queryByText(/^Rule 3:/)).toBeNull()
  })
})

describe("rule editor: chip input", () => {
  async function tenantsField() {
    setup(detail({ rules: [rule({ type: "when_tenant", tenantIds: ["t-1"] })] }))
    await edit()
    openRow(1)
    return within(rows()[0]!).getByLabelText("Tenant ids") as HTMLInputElement
  }
  const chips = () =>
    within(rows()[0]!)
      .queryAllByRole("button", { name: /^Remove tenant id / })
      .map((b) => b.getAttribute("aria-label")?.replace("Remove tenant id ", ""))

  it("adds a trimmed id on Enter", async () => {
    const box = await tenantsField()
    fireEvent.change(box, { target: { value: "  t-2  " } })
    fireEvent.keyDown(box, { key: "Enter" })
    expect(chips()).toEqual(["t-1", "t-2"])
    expect(box.value).toBe("")
  })

  it("adds an id on a comma, and keeps typing after it", async () => {
    const box = await tenantsField()
    fireEvent.change(box, { target: { value: "t-2,t-3" } })
    expect(chips()).toEqual(["t-1", "t-2"])
    expect(box.value).toBe("t-3")
  })

  it("ignores a duplicate and an empty entry", async () => {
    const box = await tenantsField()
    fireEvent.change(box, { target: { value: "t-1" } })
    fireEvent.keyDown(box, { key: "Enter" })
    fireEvent.change(box, { target: { value: "   " } })
    fireEvent.keyDown(box, { key: "Enter" })
    fireEvent.change(box, { target: { value: "t-1," } })
    expect(chips()).toEqual(["t-1"])
    expect(box.value).toBe("")
  })

  it("takes the last chip back on Backspace in an empty field only", async () => {
    const box = await tenantsField()
    fireEvent.change(box, { target: { value: "t-2" } })
    fireEvent.keyDown(box, { key: "Enter" })
    fireEvent.change(box, { target: { value: "x" } })
    fireEvent.keyDown(box, { key: "Backspace" })
    expect(chips()).toEqual(["t-1", "t-2"])
    fireEvent.change(box, { target: { value: "" } })
    fireEvent.keyDown(box, { key: "Backspace" })
    expect(chips()).toEqual(["t-1"])
  })

  it("removes a chip with its button", async () => {
    const box = await tenantsField()
    fireEvent.change(box, { target: { value: "t-2" } })
    fireEvent.keyDown(box, { key: "Enter" })
    fireEvent.click(within(rows()[0]!).getByRole("button", { name: "Remove tenant id t-1" }))
    expect(chips()).toEqual(["t-2"])
  })

  it("keeps text left in the field when it loses focus, instead of dropping it", async () => {
    const box = await tenantsField()
    fireEvent.change(box, { target: { value: "t-9" } })
    fireEvent.blur(box)
    expect(chips()).toEqual(["t-1", "t-9"])
  })

  it("does not submit or save on Enter", async () => {
    const { saves } = setup(detail({ rules: [rule({ type: "when_tenant", tenantIds: ["t-1"] })] }))
    await edit()
    openRow(1)
    const box = within(rows()[0]!).getByLabelText("Tenant ids")
    fireEvent.change(box, { target: { value: "t-2" } })
    fireEvent.keyDown(box, { key: "Enter" })
    expect(saves()).toHaveLength(0)
  })

  it("sends the ids in the order they were added", async () => {
    const { saves } = setup(detail({ rules: [rule({ type: "when_tenant", tenantIds: ["t-1"] })] }))
    await edit()
    openRow(1)
    const box = within(rows()[0]!).getByLabelText("Tenant ids")
    fireEvent.change(box, { target: { value: "t-3,t-2," } })
    fireEvent.click(save())
    await waitFor(() => expect(saves()).toHaveLength(1))
    expect(saves()[0]!.rules[0]!.tenantIds).toEqual(["t-1", "t-3", "t-2"])
  })
})

describe("rule editor: rollout", () => {
  const percent = () => screen.getByRole("textbox", { name: "Percentage of tenants" }) as HTMLInputElement
  // Base UI draws the thumb hidden until it has measured a layout, and jsdom
  // never does, so the accessible tree has no slider to query by role here.
  const slider = () =>
    rows()[0]!.querySelector('input[type="range"]') as HTMLInputElement

  async function rollout(n = 25) {
    const s = setup(detail({ rules: [rule({ type: "rollout", percentage: n })] }))
    await edit()
    openRow(1)
    return s
  }

  it("starts both controls at the saved percentage and says what it means", async () => {
    await rollout(25)
    expect(percent().value).toBe("25")
    expect(slider().value).toBe("25")
    expect(
      screen.getByText("Tenants whose bucket is under 25 get this value. Users without a tenant never match."),
    ).toBeTruthy()
  })

  it("moves the number when the slider moves", async () => {
    await rollout(25)
    fireEvent.change(slider(), { target: { value: "70" } })
    expect(percent().value).toBe("70")
    expect(screen.getByText(/bucket is under 70 get/)).toBeTruthy()
  })

  it("moves the slider when the number is typed", async () => {
    await rollout(25)
    fireEvent.change(percent(), { target: { value: "40" } })
    expect(slider().value).toBe("40")
  })

  it("sends the percentage that was set", async () => {
    const { saves } = await rollout(25)
    fireEvent.change(percent(), { target: { value: "40" } })
    fireEvent.click(save())
    await waitFor(() => expect(saves()).toHaveLength(1))
    expect(saves()[0]!.rules[0]).toEqual({ type: "rollout", percentage: 40, returnValue: true })
  })

  it("holds Save for a number outside 0 to 100, or an empty one", async () => {
    await rollout(25)
    fireEvent.change(percent(), { target: { value: "101" } })
    expect(save().disabled).toBe(true)
    expect(screen.getByText("Rule 1: The percentage must be a whole number from 0 to 100.")).toBeTruthy()
    fireEvent.change(percent(), { target: { value: "" } })
    expect(save().disabled).toBe(true)
    fireEvent.change(percent(), { target: { value: "100" } })
    expect(save().disabled).toBe(false)
    fireEvent.change(percent(), { target: { value: "0" } })
    expect(save().disabled).toBe(false)
  })

  it("refuses characters that are not digits", async () => {
    await rollout(25)
    fireEvent.change(percent(), { target: { value: "2.5" } })
    expect(percent().value).toBe("25")
    fireEvent.change(percent(), { target: { value: "-3" } })
    expect(percent().value).toBe("25")
  })
})

describe("rule editor: schedule", () => {
  const start = () => screen.getByLabelText("Start (UTC)") as HTMLInputElement
  const end = () => screen.getByLabelText("End (UTC)") as HTMLInputElement

  async function schedule(over: Record<string, unknown> = {}) {
    const s = setup(detail({ rules: [rule({ type: "schedule", ...over })] }))
    await edit()
    openRow(1)
    return s
  }

  it("shows the saved times as UTC fields, either of which may be empty", async () => {
    await schedule({ startAt: "2026-03-01T09:00:00Z" })
    expect(start().value).toBe("2026-03-01T09:00")
    expect(end().value).toBe("")
    expect(screen.getByText(/Times are UTC/)).toBeTruthy()
  })

  it("blocks Save, inline, when the start is not before the end", async () => {
    await schedule({ startAt: "2026-03-01T09:00:00Z", endAt: "2026-03-14T17:30:00Z" })
    expect(save().disabled).toBe(false)
    fireEvent.change(end(), { target: { value: "2026-03-01T09:00" } })
    expect(save().disabled).toBe(true)
    // In the form, under the fields, and named again beside Save.
    expect(within(rows()[0]!).getAllByText("The start must be before the end.").length).toBeGreaterThan(0)
    expect(screen.getByText("Rule 1: The start must be before the end.")).toBeTruthy()
    expect(start().getAttribute("aria-invalid")).toBe("true")
    fireEvent.change(end(), { target: { value: "2026-03-01T09:01" } })
    expect(save().disabled).toBe(false)
  })

  it("blocks Save when a schedule has neither a start nor an end, as the server would", async () => {
    await schedule({ startAt: "2026-03-01T09:00:00Z" })
    fireEvent.change(start(), { target: { value: "" } })
    expect(save().disabled).toBe(true)
    expect(screen.getByText("Rule 1: A schedule needs a start, an end, or both.")).toBeTruthy()
  })

  it("sends the times as RFC3339 UTC, and an empty end as no end", async () => {
    const { saves } = await schedule({ startAt: "2026-03-01T09:00:00Z" })
    fireEvent.change(start(), { target: { value: "2026-03-02T10:30" } })
    fireEvent.click(save())
    await waitFor(() => expect(saves()).toHaveLength(1))
    expect(saves()[0]!.rules[0]).toEqual({
      type: "schedule",
      startAt: "2026-03-02T10:30:00.000Z",
      returnValue: true,
    })
  })

  it("sends an untouched time back exactly as it was read", async () => {
    const { saves } = await schedule({
      startAt: "2026-03-01T09:00:00.250Z",
      endAt: "2026-03-14T17:30:45Z",
    })
    expect(end().value).toMatch(/^2026-03-14T17:30:45/)
    fireEvent.click(save())
    await waitFor(() => expect(saves()).toHaveLength(1))
    expect(saves()[0]!.rules[0]).toMatchObject({
      startAt: "2026-03-01T09:00:00.250Z",
      endAt: "2026-03-14T17:30:45Z",
    })
  })
})

function evaluation() {
  return {
    value: false,
    valueMatchesType: true,
    reason: "rule",
    matchedRulePriority: 1,
    trace: [
      { priority: 0, type: "when_tenant", matched: false, reached: true, note: "tenant t-x is not listed" },
      { priority: 1, type: "when_user", matched: true, reached: true, note: "user u-1 is listed" },
      { priority: 2, type: "rollout", matched: false, reached: false, note: "" },
    ],
    evaluatedAt: "2026-09-29T10:00:00Z",
  }
}

async function evaluateAs(user = "u-1") {
  fireEvent.change(screen.getByLabelText("User id"), { target: { value: user } })
  fireEvent.click(screen.getByRole("button", { name: "Evaluate" }))
  await waitFor(() => expect(document.querySelector('[data-slot="evaluation-result"]')).toBeTruthy())
}

const REASON = "Save or discard the rule changes to evaluate."

describe("rule editor and evaluation", () => {
  it("hides every mark and the result, and disables Evaluate with the reason, while a draft is open", async () => {
    const { queries } = setup(detail(), undefined, { "flags.evaluate": evaluation() })
    await ready()
    await evaluateAs()
    expect(screen.getAllByText("Decided here").length).toBeGreaterThan(0)

    fireEvent.click(within(rung()).getByRole("button", { name: "Edit rules" }))
    expect(screen.queryByText("Decided here")).toBeNull()
    expect(screen.queryByText("Not reached")).toBeNull()
    expect(document.querySelector('[data-slot="evaluation-result"]')).toBeNull()
    expect(document.querySelector("[data-decided]")).toBeNull()
    const button = screen.getByRole("button", { name: "Evaluate" }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(screen.getByText(REASON)).toBeTruthy()
    expect(button.getAttribute("aria-describedby")).toBe(screen.getByText(REASON).id)

    // Enter in an input must not slip past the disabled button.
    const before = queries.filter((q) => q.intent === "flags.evaluate").length
    fireEvent.submit(screen.getByRole("form", { name: "Evaluate as" }))
    await new Promise((r) => setTimeout(r, 20))
    expect(queries.filter((q) => q.intent === "flags.evaluate")).toHaveLength(before)
  })

  it("brings the marks back when the draft is discarded", async () => {
    setup(detail(), undefined, { "flags.evaluate": evaluation() })
    await ready()
    await evaluateAs()
    fireEvent.click(within(rung()).getByRole("button", { name: "Edit rules" }))
    fireEvent.click(screen.getByRole("button", { name: "Discard" }))
    await waitFor(() => expect(screen.queryByRole("button", { name: "Save rules" })).toBeNull())
    expect(screen.getAllByText("Decided here").length).toBeGreaterThan(0)
    expect(screen.queryByText(REASON)).toBeNull()
    expect((screen.getByRole("button", { name: "Evaluate" }) as HTMLButtonElement).disabled).toBe(false)
  })

  it("drops an evaluation once its rules were replaced by a save", async () => {
    setup(detail(), undefined, { "flags.evaluate": evaluation() })
    await ready()
    await evaluateAs()
    fireEvent.click(within(rung()).getByRole("button", { name: "Edit rules" }))
    fireEvent.click(save())
    await waitFor(() => expect(screen.queryByRole("button", { name: "Save rules" })).toBeNull())
    expect(document.querySelector('[data-slot="evaluation-result"]')).toBeNull()
    expect(screen.queryByText("Decided here")).toBeNull()
  })
})

describe("rule editor: discard", () => {
  it("closes at once when nothing changed", async () => {
    setup()
    await edit()
    fireEvent.click(screen.getByRole("button", { name: "Discard" }))
    expect(screen.queryByRole("alertdialog")).toBeNull()
    expect(screen.queryByRole("button", { name: "Save rules" })).toBeNull()
  })

  it("asks first when something changed, and Cancel keeps the draft", async () => {
    setup()
    await edit()
    fireEvent.click(screen.getByRole("button", { name: "Remove rule 1" }))
    fireEvent.click(screen.getByRole("button", { name: "Discard" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(dialog.textContent).toContain("Discard your changes to the rules?")
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(rows()).toHaveLength(2)
  })

  it("drops the draft on confirm, and the next open starts from what is saved", async () => {
    const { saves } = setup()
    await edit()
    fireEvent.click(screen.getByRole("button", { name: "Remove rule 1" }))
    fireEvent.click(screen.getByRole("button", { name: "Discard" }))
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Discard" }))
    await waitFor(() => expect(screen.queryByRole("button", { name: "Save rules" })).toBeNull())
    expect(saves()).toHaveLength(0)
    expect(within(rung()).getAllByRole("listitem")).toHaveLength(3)
    fireEvent.click(within(rung()).getByRole("button", { name: "Edit rules" }))
    expect(rows()).toHaveLength(3)
  })

  it("does not count a change that was undone", async () => {
    setup()
    await edit()
    openRow(3)
    const box = screen.getByRole("textbox", { name: "Percentage of tenants" })
    fireEvent.change(box, { target: { value: "60" } })
    fireEvent.change(box, { target: { value: "25" } })
    fireEvent.click(screen.getByRole("button", { name: "Discard" }))
    expect(screen.queryByRole("alertdialog")).toBeNull()
  })
})

describe("rule editor: leaving with unsaved changes", () => {
  function beforeUnload(): boolean {
    const event = new Event("beforeunload", { cancelable: true })
    window.dispatchEvent(event)
    return event.defaultPrevented
  }

  // jsdom cannot navigate, so a click that gets through is stopped here, at
  // the bubbling end. A click the guard blocks never reaches this far, which
  // is how a test tells "blocked" from "allowed".
  let reached = false
  const sink = (e: Event) => {
    reached = true
    e.preventDefault()
  }
  beforeEach(() => {
    reached = false
    document.addEventListener("click", sink)
  })
  afterEach(() => document.removeEventListener("click", sink))

  /** True when the guard stopped the click. */
  function clickLink(): boolean {
    reached = false
    const link = screen.getByRole("link", { name: "Elsewhere" })
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }))
    return !reached
  }

  it("does not ask while nothing has changed", async () => {
    setup()
    await edit()
    expect(beforeUnload()).toBe(false)
    expect(clickLink()).toBe(false)
    expect(window.confirm).not.toHaveBeenCalled()
  })

  it("does not ask when no draft is open", async () => {
    setup()
    await ready()
    expect(beforeUnload()).toBe(false)
    expect(clickLink()).toBe(false)
    expect(window.confirm).not.toHaveBeenCalled()
  })

  it("asks before the tab is closed once the draft changed", async () => {
    setup()
    await edit()
    fireEvent.click(screen.getByRole("button", { name: "Remove rule 1" }))
    expect(beforeUnload()).toBe(true)
  })

  it("asks before an in-app link is followed, and stays when the answer is no", async () => {
    setup()
    await edit()
    fireEvent.click(screen.getByRole("button", { name: "Remove rule 1" }))
    vi.mocked(window.confirm).mockReturnValue(false)
    expect(clickLink()).toBe(true)
    expect(window.confirm).toHaveBeenCalledTimes(1)
    expect(rows()).toHaveLength(2)
  })

  it("lets the link through when the answer is yes", async () => {
    setup()
    await edit()
    fireEvent.click(screen.getByRole("button", { name: "Remove rule 1" }))
    vi.mocked(window.confirm).mockReturnValue(true)
    expect(clickLink()).toBe(false)
    expect(window.confirm).toHaveBeenCalledTimes(1)
  })

  it("stops asking once the draft is saved or discarded", async () => {
    setup()
    await edit()
    fireEvent.click(screen.getByRole("button", { name: "Remove rule 1" }))
    fireEvent.click(save())
    await waitFor(() => expect(screen.queryByRole("button", { name: "Save rules" })).toBeNull())
    expect(beforeUnload()).toBe(false)
    expect(clickLink()).toBe(false)
    expect(window.confirm).not.toHaveBeenCalled()
  })

  it("leaves a modified click and a link to another tab alone", async () => {
    setup()
    await edit()
    fireEvent.click(screen.getByRole("button", { name: "Remove rule 1" }))
    const link = screen.getByRole("link", { name: "Elsewhere" })
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ctrlKey: true }))
    link.setAttribute("target", "_blank")
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }))
    expect(window.confirm).not.toHaveBeenCalled()
  })
})
