import { describe, expect, it, vi } from "vitest"
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import {
  ContractError,
  NavigationProvider,
  PluginProvider,
  queryStore,
} from "@forge-go/dashboard-plugin"
import type { ScopedClient } from "@forge-go/dashboard-plugin"
import { FlagDetailPage } from "../src/pages/flag-detail"
import { stubClient } from "./harness"

/**
 * jsdom 25 has no PointerEvent, and Base UI's switch and toggle dispatch
 * through it. A MouseEvent subclass is what a click is.
 */
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
    tags: ["payments", "web"],
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
  rule({ id: "rul_1", priority: 0, type: "when_tenant", tenantIds: ["t-beta", "t-gamma"] }),
  rule({ id: "rul_2", priority: 1, type: "when_user", userIds: ["u-1"] }),
  rule({ id: "rul_3", priority: 2, type: "rollout", percentage: 25 }),
  rule({
    id: "rul_4",
    priority: 3,
    type: "schedule",
    startAt: "2026-03-01T09:00:00Z",
    endAt: "2026-03-14T17:30:00Z",
  }),
  rule({ id: "rul_5", priority: 4, type: "schedule", startAt: "2026-03-01T09:00:00Z" }),
  rule({ id: "rul_6", priority: 5, type: "schedule", endAt: "2026-03-14T17:30:00Z" }),
  rule({
    id: "rul_7",
    priority: 6,
    type: "when_tenant_tag",
    implemented: false,
    tagKey: "tier",
    tagValue: "gold",
  }),
  rule({
    id: "rul_8",
    priority: 7,
    type: "custom",
    implemented: false,
    evaluator: "beta-users",
    params: { n: 1 },
  }),
]

const OVERRIDES = [
  { tenantId: "t-acme", value: true, valueMatchesType: true, updatedAt: "2026-09-22T10:00:00Z" },
  { tenantId: "t-globex", value: false, valueMatchesType: true, updatedAt: "2026-09-22T11:00:00Z" },
]

const AUDIT = [
  {
    id: "aud_1",
    action: "flag.update",
    outcome: "success",
    userId: "usr_1",
    createdAt: "2026-09-23T10:00:00Z",
  },
]

function detail(over: Record<string, unknown> = {}) {
  return {
    flag: flag(),
    variants: [] as unknown[],
    metadata: {} as Record<string, string>,
    rules: [] as unknown[],
    overrides: [] as unknown[],
    recentAudit: [] as unknown[],
    cacheTtlSeconds: 30,
    ...over,
  }
}

interface Harness {
  client: ScopedClient
  queries: { intent: string; params?: unknown }[]
  commands: { intent: string; payload?: unknown }[]
}

/** One client that records both the reads and the writes a page sends. */
function harness(
  answer: unknown = detail(),
  commands: Record<string, unknown> = {},
): Harness {
  const queries: Harness["queries"] = []
  const sent: Harness["commands"] = []
  const inner = stubClient({ "flags.detail": answer }, commands)
  return {
    queries,
    commands: sent,
    client: {
      extension: inner.extension,
      query: (intent: string, params?: Record<string, unknown>) => {
        queries.push({ intent, params })
        return inner.query(intent, params)
      },
      command: (intent: string, payload?: unknown) => {
        sent.push({ intent, payload })
        return inner.command(intent, payload)
      },
    } as ScopedClient,
  }
}

/** Commands that throw, for the failure path. */
function failingCommands(error: ContractError, answer: unknown = detail()): Harness {
  const h = harness(answer)
  return {
    ...h,
    client: {
      ...h.client,
      command: async (intent: string, payload?: unknown) => {
        h.commands.push({ intent, payload })
        throw error
      },
    } as ScopedClient,
  }
}

/** Commands that never settle, for the pending path. */
function neverSettles(answer: unknown = detail()): Harness {
  const h = harness(answer)
  return {
    ...h,
    client: {
      ...h.client,
      command: (intent: string, payload?: unknown) => {
        h.commands.push({ intent, payload })
        return new Promise<never>(() => {})
      },
    } as ScopedClient,
  }
}

function renderDetail(client: ScopedClient, params: Record<string, string> = { key: KEY }) {
  const navigate = vi.fn()
  render(
    <PluginProvider client={client}>
      <NavigationProvider
        value={{
          Link: ({ to, children, className }) => (
            <a href={to} className={className}>
              {children}
            </a>
          ),
          navigate,
        }}
      >
        <FlagDetailPage params={params} />
      </NavigationProvider>
    </PluginProvider>,
  )
  return { navigate }
}

const rung = (id: string) =>
  document.querySelector(`[data-rung="${id}"]`) as HTMLElement
const rungBody = (id: string) =>
  rung(id).querySelector('[data-slot="rung-body"]') as HTMLElement
const ready = () => screen.findByRole("heading", { name: KEY })
const click = (name: string | RegExp) =>
  fireEvent.click(screen.getByRole("button", { name }))

async function openDialog(button: string | RegExp) {
  await ready()
  click(button)
  return await screen.findByRole("dialog")
}

describe("FlagDetailPage reads", () => {
  it("sends the decoded key with flags.detail", async () => {
    const h = harness()
    renderDetail(h.client)
    await ready()
    const reads = h.queries.filter((q) => q.intent === "flags.detail")
    expect(reads[0]?.params).toEqual({ key: KEY })
  })

  it("renders a status line and sends no query when the key is missing", async () => {
    const h = harness()
    renderDetail(h.client, {})
    expect(screen.getByRole("status").textContent).toMatch(/no flag key/i)
    await new Promise((r) => setTimeout(r, 20))
    expect(h.queries).toHaveLength(0)
  })

  it("says there is no flag with that name, and links back to the list, on NOT_FOUND", async () => {
    const client = {
      extension: "vault",
      query: async () => {
        throw new ContractError("NOT_FOUND", "flag not found")
      },
      command: async () => undefined,
    } as unknown as ScopedClient
    renderDetail(client)
    expect(await screen.findByText(`No flag named ${KEY}.`)).toBeTruthy()
    const link = screen.getByRole("link", { name: /flags/i })
    expect(link.getAttribute("href")).toBe("/flags")
  })

  it("does not call a wrong intent name a missing flag", async () => {
    const client = {
      extension: "vault",
      query: async () => {
        throw new ContractError("NOT_FOUND", 'no handler for intent "flags.detail"')
      },
      command: async () => undefined,
    } as unknown as ScopedClient
    renderDetail(client)
    expect((await screen.findAllByText(/no handler for intent/)).length).toBeGreaterThan(0)
    expect(screen.queryByText(`No flag named ${KEY}.`)).toBeNull()
  })

  it("shows any other read failure instead of a blank page", async () => {
    const client = {
      extension: "vault",
      query: async () => {
        throw new ContractError("INTERNAL", "store is down")
      },
      command: async () => undefined,
    } as unknown as ScopedClient
    renderDetail(client)
    expect((await screen.findAllByText(/store is down/)).length).toBeGreaterThan(0)
  })
})

describe("FlagDetailPage refresh", () => {
  it("stays on screen, dialogs and all, while a write's refetch is in flight", async () => {
    // A command invalidates flags.detail, and the store reports loading with
    // the old data still there. A page that swapped itself for a skeleton then
    // would drop whatever dialog is open, and its state, on every write.
    let reads = 0
    const client = {
      extension: "vault",
      query: () => (++reads === 1 ? Promise.resolve(detail()) : new Promise<never>(() => {})),
      command: async () => undefined,
    } as unknown as ScopedClient
    renderDetail(client)
    const dialog = await openDialog("Edit description")
    fireEvent.change(within(dialog).getByLabelText("Description"), { target: { value: "half typed" } })
    queryStore.invalidate("vault", ["flags.detail"])
    await waitFor(() => expect(reads).toBe(2))
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByRole("status", { name: /Loading/ })).toBeNull()
    expect((screen.getByLabelText("Description") as HTMLInputElement).value).toBe("half typed")
  })
})

describe("FlagDetailPage header and definition", () => {
  it("shows the key in mono, the type badge, the description and the tags", async () => {
    renderDetail(harness().client)
    const heading = await ready()
    // PageHeader takes a string title, so the key's mono comes from a variant
    // on the header that reaches its h1.
    expect(heading.closest('[data-slot="page-header"]')?.className).toContain(
      "[&_h1]:font-mono",
    )
    expect(screen.getAllByText("bool").length).toBeGreaterThan(0)
    expect(screen.getAllByText("The new checkout flow").length).toBeGreaterThan(0)
    expect(screen.getAllByText("payments").length).toBeGreaterThan(0)
  })

  it("says so when there is no description or no tags", async () => {
    renderDetail(harness(detail({ flag: flag({ description: "", tags: [] }) })).client)
    await ready()
    expect(screen.getAllByText("No description").length).toBeGreaterThan(0)
    expect(screen.getAllByLabelText("no tags").length).toBeGreaterThan(0)
  })

  it("shows the default typed, and marks a default that is not a value of the type", async () => {
    renderDetail(
      harness(
        detail({
          flag: flag({ type: "string", defaultValue: true, defaultMatchesType: false }),
        }),
      ).client,
    )
    await ready()
    const def = screen.getByText("Default", { selector: "dt" }).nextElementSibling as HTMLElement
    expect(def.textContent).toContain("true")
    expect(def.textContent).not.toContain('"true"')
    expect(within(def).getByText("Wrong type")).toBeTruthy()
  })

  it("draws a string default quoted, so it is not mistaken for a boolean", async () => {
    renderDetail(
      harness(detail({ flag: flag({ type: "string", defaultValue: "true" }) })).client,
    )
    await ready()
    const def = screen.getByText("Default", { selector: "dt" }).nextElementSibling as HTMLElement
    expect(def.textContent).toContain('"true"')
    expect(within(def).queryByText("Wrong type")).toBeNull()
  })

  it("lists variants and metadata as read-only, and says variants are not used", async () => {
    renderDetail(
      harness(
        detail({
          variants: [{ value: "blue", description: "Blue button" }],
          metadata: { team: "payments", env: "prod" },
        }),
      ).client,
    )
    await ready()
    expect(screen.getByText("Not used when evaluating")).toBeTruthy()
    expect(screen.getByText("Blue button")).toBeTruthy()
    expect(screen.getByText("env=prod")).toBeTruthy()
    expect(screen.getByText("team=payments")).toBeTruthy()
    // Read-only: nothing edits them.
    expect(screen.queryByRole("button", { name: /variant/i })).toBeNull()
    expect(screen.queryByRole("button", { name: /metadata/i })).toBeNull()
  })

  it("labels absent variants and metadata", async () => {
    renderDetail(harness().client)
    await ready()
    expect(screen.getByLabelText("no variants")).toBeTruthy()
    expect(screen.getByLabelText("no metadata")).toBeTruthy()
  })

  it("lists recent activity, or says there is none", async () => {
    renderDetail(harness(detail({ recentAudit: AUDIT })).client)
    await ready()
    expect(screen.getByText("flag.update")).toBeTruthy()
  })

  it("says there is no recorded activity", async () => {
    renderDetail(harness().client)
    await ready()
    expect(screen.getByText("No recorded activity yet.")).toBeTruthy()
  })
})

describe("FlagDetailPage ladder", () => {
  it("draws four rungs in the engine's order, numbered 1 to 4", async () => {
    renderDetail(harness(detail({ rules: RULES, overrides: OVERRIDES })).client)
    await ready()
    const rungs = Array.from(document.querySelectorAll("[data-rung]"))
    expect(rungs.map((r) => r.getAttribute("data-rung"))).toEqual([
      "enabled",
      "overrides",
      "rules",
      "default",
    ])
    const titles = rungs.map((r) => r.querySelector("h2")?.textContent)
    expect(titles).toEqual(["Enabled", "Tenant overrides", "Rules", "Default"])
    rungs.forEach((r, i) => {
      expect(r.textContent?.startsWith(String(i + 1))).toBe(true)
    })
  })

  it("says what each rung does in a sentence", async () => {
    renderDetail(harness().client)
    await ready()
    expect(within(rung("enabled")).getByText(/Off: everything below returns the default\./)).toBeTruthy()
    expect(within(rung("overrides")).getByText(/Beat every rule below\./)).toBeTruthy()
    expect(within(rung("rules")).getByText(/First match wins\./)).toBeTruthy()
  })

  it("lists overrides in the order given, each with its value", async () => {
    renderDetail(harness(detail({ overrides: OVERRIDES })).client)
    await ready()
    const rows = within(rung("overrides")).getAllByRole("listitem")
    expect(rows[0]?.textContent).toContain("t-acme")
    expect(rows[0]?.textContent).toContain("true")
    expect(rows[1]?.textContent).toContain("t-globex")
    expect(rows[1]?.textContent).toContain("false")
    expect(within(rows[0]!).getByText("t-acme").className).toContain("font-mono")
  })

  it("says there are no overrides, and no rules", async () => {
    renderDetail(harness().client)
    await ready()
    expect(within(rung("overrides")).getByText("No tenant overrides.")).toBeTruthy()
    expect(within(rung("rules")).getByText(/No rules\./)).toBeTruthy()
  })

  it("marks an override whose value is not a value of the type", async () => {
    renderDetail(
      harness(
        detail({
          overrides: [
            { tenantId: "t-x", value: "yes", valueMatchesType: false, updatedAt: "2026-09-22T10:00:00Z" },
          ],
        }),
      ).client,
    )
    await ready()
    expect(within(rung("overrides")).getByText("Wrong type")).toBeTruthy()
  })

  it("renders rules in the order given and numbers them by position, not by priority", async () => {
    renderDetail(
      harness(
        detail({
          rules: [
            rule({ id: "a", priority: 9, type: "when_user", userIds: ["u-first"] }),
            rule({ id: "b", priority: 2, type: "when_user", userIds: ["u-second"] }),
          ],
        }),
      ).client,
    )
    await ready()
    const rows = within(rung("rules")).getAllByRole("listitem")
    expect(rows).toHaveLength(2)
    expect(rows[0]?.textContent).toMatch(/^1/)
    expect(rows[0]?.textContent).toContain("u-first")
    expect(rows[1]?.textContent).toMatch(/^2/)
    expect(rows[1]?.textContent).toContain("u-second")
  })

  it("says every rule type in words", async () => {
    renderDetail(harness(detail({ rules: RULES })).client)
    await ready()
    const rows = within(rung("rules")).getAllByRole("listitem")
    expect(rows).toHaveLength(8)
    // Tenant and user rules: chips.
    expect(rows[0]?.textContent).toContain("Tenant is one of")
    expect(within(rows[0]!).getByText("t-beta").className).toContain("font-mono")
    expect(within(rows[0]!).getByText("t-gamma")).toBeTruthy()
    expect(rows[1]?.textContent).toContain("User is one of")
    expect(within(rows[1]!).getByText("u-1")).toBeTruthy()
    // Rollout: says it buckets by tenant only.
    expect(rows[2]?.textContent).toContain("Rollout to 25% of tenants")
    expect(rows[2]?.textContent).toMatch(/never by user/i)
    // Schedule: three shapes, all in UTC.
    expect(rows[3]?.textContent).toContain("Between 2026-03-01 09:00 and 2026-03-14 17:30 UTC")
    expect(rows[4]?.textContent).toContain("From 2026-03-01 09:00 UTC")
    expect(rows[5]?.textContent).toContain("Until 2026-03-14 17:30 UTC")
    // The two the engine never matches.
    expect(rows[6]?.textContent).toContain("Tenant tag tier = gold")
    expect(rows[7]?.textContent).toContain("Custom evaluator beta-users")
  })

  it("shows the Never matches badge on exactly the two rule types the engine cannot match", async () => {
    renderDetail(harness(detail({ rules: RULES })).client)
    await ready()
    const rows = within(rung("rules")).getAllByRole("listitem")
    const flagged = rows.map((r) => within(r).queryByText("Never matches") !== null)
    expect(flagged).toEqual([false, false, false, false, false, false, true, true])
  })

  it("calls an unknown rule type unknown, and says it never matches", async () => {
    renderDetail(
      harness(
        detail({ rules: [rule({ type: "geo_fence", implemented: false })] }),
      ).client,
    )
    await ready()
    const row = within(rung("rules")).getByRole("listitem")
    expect(row.textContent).toContain("Unknown rule type geo_fence")
    expect(within(row).getByText("Never matches")).toBeTruthy()
  })

  it("says a schedule with no ends always matches", async () => {
    renderDetail(harness(detail({ rules: [rule({ type: "schedule" })] })).client)
    await ready()
    expect(within(rung("rules")).getByRole("listitem").textContent).toMatch(/no start or end/i)
  })

  it("shows each rule's return value typed, and marks one that is the wrong type", async () => {
    renderDetail(
      harness(
        detail({
          rules: [
            rule({ id: "a", type: "when_user", userIds: ["u"], returnValue: true }),
            rule({
              id: "b",
              type: "when_user",
              userIds: ["v"],
              returnValue: "yes",
              returnMatchesType: false,
            }),
          ],
        }),
      ).client,
    )
    await ready()
    const rows = within(rung("rules")).getAllByRole("listitem")
    expect(rows[0]?.textContent).toContain("true")
    expect(within(rows[0]!).queryByText("Wrong type")).toBeNull()
    expect(rows[1]?.textContent).toContain('"yes"')
    expect(within(rows[1]!).getByText("Wrong type")).toBeTruthy()
  })

  it("shows the default on the last rung", async () => {
    renderDetail(
      harness(detail({ flag: flag({ type: "int", defaultValue: 7 }) })).client,
    )
    await ready()
    expect(within(rung("default")).getByText("7")).toBeTruthy()
  })

  it("offers no rule editing yet", async () => {
    renderDetail(harness(detail({ rules: RULES })).client)
    await ready()
    expect(screen.queryByRole("button", { name: /rules/i })).toBeNull()
  })

  it("says how long applications may serve a cached answer", async () => {
    renderDetail(harness(detail({ cacheTtlSeconds: 45 })).client)
    await ready()
    expect(screen.getByText(/up to 45 seconds/)).toBeTruthy()
  })
})

describe("FlagDetailPage when the flag is off", () => {
  const OFF = detail({
    flag: flag({ enabled: false }),
    rules: RULES,
    overrides: OVERRIDES,
  })
  const SENTENCE = "The flag is off, so everything below returns the default."

  it("says so in words above rung 2, and dims rungs 2 and 3 only", async () => {
    renderDetail(harness(OFF).client)
    await ready()
    expect(screen.getAllByText(SENTENCE)).toHaveLength(1)
    // The sentence sits with rung 2, not inside its dimmed body.
    expect(rung("overrides").textContent).toContain(SENTENCE)
    expect(rungBody("overrides").textContent).not.toContain(SENTENCE)
    expect(rungBody("overrides").className).toContain("opacity-60")
    expect(rungBody("rules").className).toContain("opacity-60")
    expect(rungBody("enabled").className).not.toContain("opacity-60")
    expect(rungBody("default").className).not.toContain("opacity-60")
  })

  it("shows neither the sentence nor any dimming when the flag is on", async () => {
    renderDetail(harness(detail({ rules: RULES, overrides: OVERRIDES })).client)
    await ready()
    expect(screen.queryByText(SENTENCE)).toBeNull()
    for (const id of ["enabled", "overrides", "rules", "default"]) {
      expect(rungBody(id).className).not.toContain("opacity-60")
    }
  })
})

describe("FlagDetailPage enabled switch", () => {
  const sw = () => screen.getByRole("switch", { name: "Enabled" })

  it("reflects the flag's state", async () => {
    renderDetail(harness().client)
    await ready()
    expect(sw().getAttribute("aria-checked")).toBe("true")
  })

  it("sends key and enabled:false for an enabled flag", async () => {
    const h = harness(detail(), { "flags.setEnabled": { flag: flag({ enabled: false }) } })
    renderDetail(h.client)
    await ready()
    fireEvent.click(sw())
    await waitFor(() => expect(h.commands).toHaveLength(1))
    expect(h.commands[0]).toEqual({
      intent: "flags.setEnabled",
      payload: { key: KEY, enabled: false },
    })
  })

  it("sends enabled:true for a disabled flag", async () => {
    const h = harness(detail({ flag: flag({ enabled: false }) }), {
      "flags.setEnabled": { flag: flag() },
    })
    renderDetail(h.client)
    await ready()
    fireEvent.click(sw())
    await waitFor(() => expect(h.commands).toHaveLength(1))
    expect(h.commands[0]?.payload).toEqual({ key: KEY, enabled: true })
  })

  it("is disabled while the command is pending", async () => {
    const h = neverSettles()
    renderDetail(h.client)
    await ready()
    fireEvent.click(sw())
    await waitFor(() => expect(sw().hasAttribute("data-disabled")).toBe(true))
    fireEvent.click(sw())
    expect(h.commands).toHaveLength(1)
  })

  it("shows a failure under rung 1", async () => {
    const h = failingCommands(new ContractError("INTERNAL", "could not save the flag"))
    renderDetail(h.client)
    await ready()
    fireEvent.click(sw())
    const alert = await within(rung("enabled")).findByRole("alert")
    expect(alert.textContent).toContain("could not save the flag")
    // The switch still shows the flag's real state.
    expect(sw().getAttribute("aria-checked")).toBe("true")
  })
})

describe("FlagDetailPage edit dialogs", () => {
  it("edits the default of a bool flag and sends only defaultValue, as a boolean", async () => {
    const h = harness(detail(), { "flags.update": { flag: flag() } })
    renderDetail(h.client)
    const dialog = await openDialog("Edit default")
    fireEvent.click(within(dialog).getByRole("button", { name: "true" }))
    fireEvent.click(within(dialog).getByRole("button", { name: "Save default" }))
    await waitFor(() => expect(h.commands).toHaveLength(1))
    expect(h.commands[0]).toEqual({
      intent: "flags.update",
      payload: { key: KEY, defaultValue: true },
    })
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })

  it("edits the default of an int flag and sends a number", async () => {
    const h = harness(detail({ flag: flag({ type: "int", defaultValue: 7 }) }), {
      "flags.update": { flag: flag() },
    })
    renderDetail(h.client)
    const dialog = await openDialog("Edit default")
    const input = within(dialog).getByRole("textbox") as HTMLInputElement
    expect(input.value).toBe("7")
    fireEvent.change(input, { target: { value: "42" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Save default" }))
    await waitFor(() => expect(h.commands).toHaveLength(1))
    expect(h.commands[0]?.payload).toEqual({ key: KEY, defaultValue: 42 })
  })

  it("can set a string default to the empty string", async () => {
    const h = harness(detail({ flag: flag({ type: "string", defaultValue: "x" }) }), {
      "flags.update": { flag: flag() },
    })
    renderDetail(h.client)
    const dialog = await openDialog("Edit default")
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Save default" }))
    await waitFor(() => expect(h.commands).toHaveLength(1))
    expect(h.commands[0]?.payload).toEqual({ key: KEY, defaultValue: "" })
  })

  it("will not save a default that is not a value yet", async () => {
    const h = harness(detail({ flag: flag({ type: "int", defaultValue: 7 }) }))
    renderDetail(h.client)
    const dialog = await openDialog("Edit default")
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "" } })
    const save = within(dialog).getByRole("button", { name: "Save default" }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.submit(dialog.querySelector("form") as HTMLFormElement)
    expect(h.commands).toHaveLength(0)
  })

  it("starts a mistyped default empty, not on the wrong value", async () => {
    const h = harness(
      detail({ flag: flag({ type: "bool", defaultValue: "true", defaultMatchesType: false }) }),
    )
    renderDetail(h.client)
    const dialog = await openDialog("Edit default")
    for (const name of ["true", "false"]) {
      expect(
        within(dialog).getByRole("button", { name }).getAttribute("aria-pressed"),
      ).toBe("false")
    }
    expect(
      (within(dialog).getByRole("button", { name: "Save default" }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it("edits the description and sends only description", async () => {
    const h = harness(detail(), { "flags.update": { flag: flag() } })
    renderDetail(h.client)
    const dialog = await openDialog("Edit description")
    const input = within(dialog).getByLabelText("Description") as HTMLInputElement
    expect(input.value).toBe("The new checkout flow")
    fireEvent.change(input, { target: { value: "  Shorter  " } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Save description" }))
    await waitFor(() => expect(h.commands).toHaveLength(1))
    expect(h.commands[0]).toEqual({
      intent: "flags.update",
      payload: { key: KEY, description: "Shorter" },
    })
  })

  it("can clear the description", async () => {
    const h = harness(detail(), { "flags.update": { flag: flag() } })
    renderDetail(h.client)
    const dialog = await openDialog("Edit description")
    fireEvent.change(within(dialog).getByLabelText("Description"), { target: { value: "" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Save description" }))
    await waitFor(() => expect(h.commands).toHaveLength(1))
    expect(h.commands[0]?.payload).toEqual({ key: KEY, description: "" })
  })

  it("edits the tags and sends only tags, as a list", async () => {
    const h = harness(detail(), { "flags.update": { flag: flag() } })
    renderDetail(h.client)
    const dialog = await openDialog("Edit tags")
    const input = within(dialog).getByLabelText("Tags") as HTMLInputElement
    expect(input.value).toBe("payments, web")
    fireEvent.change(input, { target: { value: "web, , beta ," } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Save tags" }))
    await waitFor(() => expect(h.commands).toHaveLength(1))
    expect(h.commands[0]).toEqual({
      intent: "flags.update",
      payload: { key: KEY, tags: ["web", "beta"] },
    })
  })

  it("can remove every tag, sending an empty list and not omitting it", async () => {
    const h = harness(detail(), { "flags.update": { flag: flag() } })
    renderDetail(h.client)
    const dialog = await openDialog("Edit tags")
    fireEvent.change(within(dialog).getByLabelText("Tags"), { target: { value: "" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Save tags" }))
    await waitFor(() => expect(h.commands).toHaveLength(1))
    expect(h.commands[0]?.payload).toEqual({ key: KEY, tags: [] })
  })

  it("shows a failure inside the dialog and keeps it open", async () => {
    const h = failingCommands(new ContractError("BAD_REQUEST", "flag: description: too long"))
    renderDetail(h.client)
    const dialog = await openDialog("Edit description")
    fireEvent.click(within(dialog).getByRole("button", { name: "Save description" }))
    const alert = await within(dialog).findByRole("alert")
    expect(alert.textContent).toContain("flag: description: too long")
    expect(screen.queryByRole("dialog")).toBeTruthy()
  })

  it("shows no stale error when a dialog is reopened, even a different one", async () => {
    const h = failingCommands(new ContractError("BAD_REQUEST", "flag: description: too long"))
    renderDetail(h.client)
    const dialog = await openDialog("Edit description")
    fireEvent.click(within(dialog).getByRole("button", { name: "Save description" }))
    await within(dialog).findByRole("alert")
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    click("Edit tags")
    await screen.findByRole("dialog")
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("starts each open from the flag's current value, not from an abandoned edit", async () => {
    renderDetail(harness().client)
    let dialog = await openDialog("Edit description")
    fireEvent.change(within(dialog).getByLabelText("Description"), { target: { value: "abandoned" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    click("Edit description")
    dialog = await screen.findByRole("dialog")
    expect((within(dialog).getByLabelText("Description") as HTMLInputElement).value).toBe(
      "The new checkout flow",
    )
  })

  it("disables save while pending and keeps the dialog open on Escape and Close", async () => {
    const h = neverSettles()
    renderDetail(h.client)
    const dialog = await openDialog("Edit description")
    fireEvent.click(within(dialog).getByRole("button", { name: "Save description" }))
    const saving = await within(dialog).findByRole("button", { name: /Saving/ })
    expect((saving as HTMLButtonElement).disabled).toBe(true)
    fireEvent.keyDown(dialog, { key: "Escape" })
    fireEvent.keyDown(document.body, { key: "Escape" })
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }))
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByRole("dialog")).toBeTruthy()
    expect(h.commands).toHaveLength(1)
  })

  it("still closes on Escape when nothing is pending", async () => {
    renderDetail(harness().client)
    const dialog = await openDialog("Edit tags")
    fireEvent.keyDown(dialog, { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })
})

describe("FlagDetailPage tenant overrides", () => {
  const addButton = () => screen.getByRole("button", { name: "Add override" })

  it("adds an override for a bool flag with a real boolean", async () => {
    const h = harness(detail(), { "flags.setTenantOverride": { override: OVERRIDES[0] } })
    renderDetail(h.client)
    const dialog = await openDialog("Add override")
    fireEvent.change(within(dialog).getByLabelText("Tenant ID"), { target: { value: " t-new " } })
    fireEvent.click(within(dialog).getByRole("button", { name: "true" }))
    fireEvent.click(within(dialog).getByRole("button", { name: "Save override" }))
    await waitFor(() => expect(h.commands).toHaveLength(1))
    expect(h.commands[0]).toEqual({
      intent: "flags.setTenantOverride",
      payload: { key: KEY, tenantId: "t-new", value: true },
    })
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })

  it("adds an override for an int flag as a number", async () => {
    const h = harness(detail({ flag: flag({ type: "int", defaultValue: 1 }) }), {
      "flags.setTenantOverride": { override: OVERRIDES[0] },
    })
    renderDetail(h.client)
    const dialog = await openDialog("Add override")
    fireEvent.change(within(dialog).getByLabelText("Tenant ID"), { target: { value: "t-1" } })
    fireEvent.change(within(dialog).getByLabelText("Value"), { target: { value: "5" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Save override" }))
    await waitFor(() => expect(h.commands).toHaveLength(1))
    expect(h.commands[0]?.payload).toEqual({ key: KEY, tenantId: "t-1", value: 5 })
  })

  it("adds a string override, including the empty string", async () => {
    const h = harness(detail({ flag: flag({ type: "string", defaultValue: "a" }) }), {
      "flags.setTenantOverride": { override: OVERRIDES[0] },
    })
    renderDetail(h.client)
    const dialog = await openDialog("Add override")
    fireEvent.change(within(dialog).getByLabelText("Tenant ID"), { target: { value: "t-1" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Save override" }))
    await waitFor(() => expect(h.commands).toHaveLength(1))
    expect(h.commands[0]?.payload).toEqual({ key: KEY, tenantId: "t-1", value: "" })
  })

  it("will not save without a tenant, or without a value", async () => {
    const h = harness()
    renderDetail(h.client)
    const dialog = await openDialog("Add override")
    const save = within(dialog).getByRole("button", { name: "Save override" }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.change(within(dialog).getByLabelText("Tenant ID"), { target: { value: "t-1" } })
    expect(save.disabled).toBe(true) // a bool has no value until one is chosen
    fireEvent.submit(dialog.querySelector("form") as HTMLFormElement)
    expect(h.commands).toHaveLength(0)
    fireEvent.click(within(dialog).getByRole("button", { name: "false" }))
    expect(save.disabled).toBe(false)
    fireEvent.change(within(dialog).getByLabelText("Tenant ID"), { target: { value: "   " } })
    expect(save.disabled).toBe(true)
  })

  it("shows a failure inside the dialog", async () => {
    const h = failingCommands(new ContractError("BAD_REQUEST", "flag: value: not an int"))
    renderDetail(h.client)
    const dialog = await openDialog("Add override")
    fireEvent.change(within(dialog).getByLabelText("Tenant ID"), { target: { value: "t-1" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "true" }))
    fireEvent.click(within(dialog).getByRole("button", { name: "Save override" }))
    expect((await within(dialog).findByRole("alert")).textContent).toContain("not an int")
  })

  it("starts empty on every open", async () => {
    renderDetail(harness().client)
    let dialog = await openDialog("Add override")
    fireEvent.change(within(dialog).getByLabelText("Tenant ID"), { target: { value: "t-1" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    fireEvent.click(addButton())
    dialog = await screen.findByRole("dialog")
    expect((within(dialog).getByLabelText("Tenant ID") as HTMLInputElement).value).toBe("")
  })

  it("keeps the dialog open on Escape while pending", async () => {
    const h = neverSettles()
    renderDetail(h.client)
    const dialog = await openDialog("Add override")
    fireEvent.change(within(dialog).getByLabelText("Tenant ID"), { target: { value: "t-1" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "true" }))
    fireEvent.click(within(dialog).getByRole("button", { name: "Save override" }))
    await within(dialog).findByRole("button", { name: /Saving/ })
    fireEvent.keyDown(dialog, { key: "Escape" })
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByRole("dialog")).toBeTruthy()
  })

  async function openRemove(tenant: string) {
    await ready()
    fireEvent.click(screen.getByRole("button", { name: `Remove override for ${tenant}` }))
    return await screen.findByRole("alertdialog")
  }

  it("removes an override after confirming, sending key and tenantId", async () => {
    const h = harness(detail({ overrides: OVERRIDES }), {
      "flags.deleteTenantOverride": { ok: true, key: KEY, tenantId: "t-globex" },
    })
    renderDetail(h.client)
    const dialog = await openRemove("t-globex")
    expect(dialog.textContent).toContain("t-globex")
    expect(h.commands).toHaveLength(0)
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }))
    await waitFor(() => expect(h.commands).toHaveLength(1))
    expect(h.commands[0]).toEqual({
      intent: "flags.deleteTenantOverride",
      payload: { key: KEY, tenantId: "t-globex" },
    })
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
  })

  it("shows a NOT_FOUND from the remove inside the dialog", async () => {
    const h = failingCommands(
      new ContractError("NOT_FOUND", "tenant override not found"),
      detail({ overrides: OVERRIDES }),
    )
    renderDetail(h.client)
    const dialog = await openRemove("t-acme")
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }))
    expect((await within(dialog).findByRole("alert")).textContent).toContain(
      "tenant override not found",
    )
  })

  it("keeps the remove dialog open on Escape while pending, and disables confirm", async () => {
    const h = neverSettles(detail({ overrides: OVERRIDES }))
    renderDetail(h.client)
    const dialog = await openRemove("t-acme")
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }))
    const working = await within(dialog).findByRole("button", { name: /Working/ })
    expect((working as HTMLButtonElement).disabled).toBe(true)
    fireEvent.keyDown(dialog, { key: "Escape" })
    fireEvent.keyDown(document.body, { key: "Escape" })
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByRole("alertdialog")).toBeTruthy()
    expect(h.commands).toHaveLength(1)
  })

  it("shows no stale error when the remove dialog is reopened", async () => {
    const h = failingCommands(
      new ContractError("NOT_FOUND", "tenant override not found"),
      detail({ overrides: OVERRIDES }),
    )
    renderDetail(h.client)
    const dialog = await openRemove("t-acme")
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }))
    await within(dialog).findByRole("alert")
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    await openRemove("t-globex")
    expect(screen.queryByRole("alert")).toBeNull()
  })
})

describe("FlagDetailPage delete", () => {
  async function openDelete() {
    await ready()
    fireEvent.click(screen.getByRole("button", { name: "Delete" }))
    return await screen.findByRole("alertdialog")
  }

  it("counts the rules and the overrides it takes with it", async () => {
    renderDetail(harness(detail({ rules: RULES, overrides: OVERRIDES })).client)
    const dialog = await openDelete()
    expect(dialog.textContent).toContain(
      `This deletes ${KEY}, its 8 rules and 2 tenant overrides. Applications fall back to their own default.`,
    )
  })

  it("uses the singular for one of each", async () => {
    renderDetail(
      harness(detail({ rules: [RULES[0]], overrides: [OVERRIDES[0]] })).client,
    )
    const dialog = await openDelete()
    expect(dialog.textContent).toContain("its 1 rule and 1 tenant override.")
  })

  it("says none when there are none", async () => {
    renderDetail(harness().client)
    const dialog = await openDelete()
    expect(dialog.textContent).toContain("its 0 rules and 0 tenant overrides.")
  })

  it("sends the key, then navigates to the list", async () => {
    const h = harness(detail(), { "flags.delete": { ok: true, key: KEY } })
    const { navigate } = renderDetail(h.client)
    const dialog = await openDelete()
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/flags"))
    expect(h.commands[0]).toEqual({ intent: "flags.delete", payload: { key: KEY } })
  })

  it("shows a failure inside the dialog and does not navigate", async () => {
    const h = failingCommands(new ContractError("INTERNAL", "delete refused"))
    const { navigate } = renderDetail(h.client)
    const dialog = await openDelete()
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }))
    expect((await within(dialog).findByRole("alert")).textContent).toContain("delete refused")
    expect(navigate).not.toHaveBeenCalled()
  })

  it("keeps the dialog open on Escape while pending, and only sends once", async () => {
    const h = neverSettles()
    renderDetail(h.client)
    const dialog = await openDelete()
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }))
    const working = await within(dialog).findByRole("button", { name: /Working/ })
    expect((working as HTMLButtonElement).disabled).toBe(true)
    fireEvent.keyDown(dialog, { key: "Escape" })
    fireEvent.keyDown(document.body, { key: "Escape" })
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByRole("alertdialog")).toBeTruthy()
    expect(h.commands).toHaveLength(1)
  })

  it("shows no stale error when reopened", async () => {
    const h = failingCommands(new ContractError("INTERNAL", "delete refused"))
    renderDetail(h.client)
    const dialog = await openDelete()
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }))
    await within(dialog).findByRole("alert")
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    await openDelete()
    expect(screen.queryByRole("alert")).toBeNull()
  })
})
