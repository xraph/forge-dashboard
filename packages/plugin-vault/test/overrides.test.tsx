import { describe, expect, it } from "vitest"
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import {
  ContractError,
  NavigationProvider,
  PluginProvider,
  queryStore,
} from "@forge-go/dashboard-plugin"
import type { ScopedClient } from "@forge-go/dashboard-plugin"
import { OverridesPage } from "../src/pages/overrides"
import { configPath } from "../src/keys"
import { stubClient } from "./harness"

function ov(over: Record<string, unknown> = {}) {
  return {
    key: "app/greeting",
    tenantId: "acme",
    value: "howdy",
    valueMatchesType: true,
    keyExists: true,
    updatedAt: "2026-09-22T10:00:00Z",
    ...over,
  }
}

const ORPHAN = ov({
  key: "gone/key",
  tenantId: "wayne",
  value: "x",
  valueMatchesType: false,
  keyExists: false,
})

interface Harness {
  client: ScopedClient
  lists: unknown[]
  commands: { intent: string; payload?: unknown }[]
}

function harness(
  list: { overrides: unknown[]; total: number } | ((params: unknown) => unknown),
  commands: Record<string, unknown> = { "overrides.delete": { ok: true, key: "k", tenantId: "t" } },
  commandError?: ContractError,
  hang = false,
): Harness {
  const lists: unknown[] = []
  const sent: Harness["commands"] = []
  const inner = stubClient({}, commands)
  return {
    lists,
    commands: sent,
    client: {
      extension: "vault",
      query: async (intent: string, params?: unknown) => {
        if (intent !== "overrides.list") {
          return inner.query(intent, params as Record<string, unknown> | undefined)
        }
        lists.push(params)
        return typeof list === "function" ? list(params) : list
      },
      command: (intent: string, payload?: unknown) => {
        sent.push({ intent, payload })
        if (hang) return new Promise<never>(() => {})
        if (commandError) return Promise.reject(commandError)
        return inner.command(intent, payload)
      },
    } as ScopedClient,
  }
}

function renderOverrides(client: ScopedClient) {
  render(
    <PluginProvider client={client}>
      <NavigationProvider
        value={{
          Link: ({ to, children, className }) => (
            <a href={to} className={className}>
              {children}
            </a>
          ),
          navigate: () => {},
        }}
      >
        <OverridesPage params={{}} />
      </NavigationProvider>
    </PluginProvider>,
  )
}

const tenantBox = () => screen.getByLabelText("Tenant id") as HTMLInputElement
const keyBox = () => screen.getByLabelText("Config key") as HTMLInputElement
const showTenant = () => fireEvent.click(screen.getByRole("button", { name: "Show overrides for a tenant" }))
const showKey = () => fireEvent.click(screen.getByRole("button", { name: "Show overrides for a key" }))
const rowOf = (text: string) => screen.getByText(text).closest("tr") as HTMLElement

describe("OverridesPage before a choice", () => {
  it("says what to pick and why, and asks nothing", async () => {
    const h = harness({ overrides: [], total: 0 })
    renderOverrides(h.client)
    expect(
      screen.getByText(
        "Pick a tenant or a key to see its overrides. The store can only list them one way at a time.",
      ),
    ).toBeTruthy()
    await new Promise((r) => setTimeout(r, 20))
    expect(h.lists).toHaveLength(0)
  })

  it("does not ask for a blank tenant or key", async () => {
    const h = harness({ overrides: [], total: 0 })
    renderOverrides(h.client)
    fireEvent.change(tenantBox(), { target: { value: "   " } })
    showTenant()
    fireEvent.change(keyBox(), { target: { value: "" } })
    showKey()
    await new Promise((r) => setTimeout(r, 20))
    expect(h.lists).toHaveLength(0)
    expect(
      (screen.getByRole("button", { name: "Show overrides for a tenant" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })
})

describe("OverridesPage queries", () => {
  it("sends the tenant and never a key", async () => {
    const h = harness({ overrides: [ov()], total: 1 })
    renderOverrides(h.client)
    fireEvent.change(tenantBox(), { target: { value: " acme " } })
    showTenant()
    await screen.findByText("app/greeting")
    expect(h.lists).toEqual([{ tenantId: "acme", limit: 25, offset: 0 }])
  })

  it("sends the key and never a tenant", async () => {
    const h = harness({ overrides: [ov()], total: 1 })
    renderOverrides(h.client)
    fireEvent.change(keyBox(), { target: { value: "app/greeting" } })
    showKey()
    await screen.findByText("acme")
    expect(h.lists).toEqual([{ key: "app/greeting", limit: 25, offset: 0 }])
  })

  it("keeps one choice active: choosing a key drops the tenant and empties its box", async () => {
    const h = harness({ overrides: [ov()], total: 1 })
    renderOverrides(h.client)
    fireEvent.change(tenantBox(), { target: { value: "acme" } })
    showTenant()
    await screen.findByText("app/greeting")
    fireEvent.change(keyBox(), { target: { value: "app/greeting" } })
    showKey()
    await waitFor(() => expect(h.lists).toHaveLength(2))
    expect(h.lists[1]).toEqual({ key: "app/greeting", limit: 25, offset: 0 })
    expect(tenantBox().value).toBe("")
    for (const params of h.lists) {
      expect(Object.keys(params as object)).not.toEqual(expect.arrayContaining(["tenantId", "key"]))
    }
  })

  it("pages with limit and offset, and starts over on a new choice", async () => {
    const h = harness({ overrides: [ov()], total: 60 })
    renderOverrides(h.client)
    fireEvent.change(tenantBox(), { target: { value: "acme" } })
    showTenant()
    await screen.findByText(/Page 1 of 3, 60 total/)
    fireEvent.click(screen.getByRole("button", { name: "Next page" }))
    await screen.findByText(/Page 2 of 3/)
    expect(h.lists).toContainEqual({ tenantId: "acme", limit: 25, offset: 25 })
    fireEvent.change(tenantBox(), { target: { value: "wayne" } })
    showTenant()
    await waitFor(() =>
      expect(h.lists.at(-1)).toEqual({ tenantId: "wayne", limit: 25, offset: 0 }),
    )
  })

  it("steps back to the last page when the page it was on runs out", async () => {
    let total = 26
    const h = harness((params) => {
      const offset = (params as { offset: number }).offset
      return { overrides: offset >= total ? [] : [ov({ tenantId: `t${offset}` })], total }
    })
    renderOverrides(h.client)
    fireEvent.change(tenantBox(), { target: { value: "acme" } })
    showTenant()
    await screen.findByText(/Page 1 of 2/)
    fireEvent.click(screen.getByRole("button", { name: "Next page" }))
    await screen.findByText(/Page 2 of 2/)
    // The second page's only row goes away, as a revert would leave it.
    total = 25
    act(() => queryStore.invalidate("vault", ["overrides.list"]))
    await waitFor(() =>
      expect(h.lists.at(-1)).toEqual({ tenantId: "acme", limit: 25, offset: 0 }),
    )
    expect(await screen.findAllByText("t0")).not.toHaveLength(0)
  })

  it("Clear returns to the prompt", async () => {
    const h = harness({ overrides: [ov()], total: 1 })
    renderOverrides(h.client)
    fireEvent.change(tenantBox(), { target: { value: "acme" } })
    showTenant()
    await screen.findByText("app/greeting")
    fireEvent.click(screen.getByRole("button", { name: "Clear" }))
    expect(screen.getByText(/Pick a tenant or a key/)).toBeTruthy()
    expect(tenantBox().value).toBe("")
  })

  it("says which kind of empty it is", async () => {
    renderOverrides(harness({ overrides: [], total: 0 }).client)
    fireEvent.change(tenantBox(), { target: { value: "acme" } })
    showTenant()
    expect(await screen.findByText("No overrides for tenant acme.")).toBeTruthy()
  })
})

describe("OverridesPage rows", () => {
  it("shows the key as a link to its entry, the tenant and value in mono, and the time", async () => {
    const key = "app/http.timeout"
    const h = harness({ overrides: [ov({ key, tenantId: "acme", value: "5s" })], total: 1 })
    renderOverrides(h.client)
    fireEvent.change(tenantBox(), { target: { value: "acme" } })
    showTenant()
    const link = await screen.findByRole("link", { name: key })
    expect(link.getAttribute("href")).toBe(configPath(key))
    const row = link.closest("tr") as HTMLElement
    expect(within(row).getByText("acme").className).toContain("font-mono")
    expect(within(row).getByText('"5s"')).toBeTruthy()
    expect(screen.getByText("1 override")).toBeTruthy()
  })

  it("shows an override of the empty string quoted", async () => {
    renderOverrides(harness({ overrides: [ov({ value: "" })], total: 1 }).client)
    fireEvent.change(tenantBox(), { target: { value: "acme" } })
    showTenant()
    expect(await screen.findByText('""')).toBeTruthy()
  })

  it("marks a wrong-typed value", async () => {
    renderOverrides(
      harness({ overrides: [ov({ value: 5, valueMatchesType: false })], total: 1 }).client,
    )
    fireEvent.change(tenantBox(), { target: { value: "acme" } })
    showTenant()
    expect(await screen.findByText("Wrong type")).toBeTruthy()
  })

  it("marks an orphan Key deleted, with no link and only the revert action", async () => {
    renderOverrides(harness({ overrides: [ov(), ORPHAN], total: 2 }).client)
    fireEvent.change(tenantBox(), { target: { value: "acme" } })
    showTenant()
    await screen.findByText("gone/key")
    const row = rowOf("gone/key")
    const badge = within(row).getByText("Key deleted")
    expect(badge.className).toContain("text-destructive")
    expect(within(row).queryByRole("link")).toBeNull()
    // A wrong-type badge on an orphan would blame the value for the key's absence.
    expect(within(row).queryByText("Wrong type")).toBeNull()
    const buttons = within(row).getAllByRole("button")
    expect(buttons).toHaveLength(1)
    // There is no app default to go back to, so the button does not say so.
    expect(buttons[0]?.querySelector("svg")).toBeTruthy()
    expect(buttons[0]?.getAttribute("aria-label")).toBe(
      "Remove leftover override for tenant wayne of gone/key",
    )
    // A live row still names the app default as its destination.
    expect(within(rowOf("app/greeting")).getByRole("button").getAttribute("aria-label")).toContain(
      "Revert to app default",
    )
  })

  it("shows a refusal from the list", async () => {
    const h = harness(() => {
      throw new ContractError("BAD_REQUEST", "give a tenantId or a key")
    })
    renderOverrides(h.client)
    fireEvent.change(tenantBox(), { target: { value: "acme" } })
    showTenant()
    expect((await screen.findAllByText(/give a tenantId or a key/)).length).toBeGreaterThan(0)
  })
})

describe("OverridesPage revert", () => {
  async function open(h: Harness) {
    renderOverrides(h.client)
    fireEvent.change(tenantBox(), { target: { value: "acme" } })
    showTenant()
    await screen.findByText("app/greeting")
    fireEvent.click(
      within(rowOf("app/greeting")).getByRole("button", { name: /Revert to app default/ }),
    )
    return await screen.findByRole("alertdialog")
  }

  it("names the tenant and the key, and sends overrides.delete with both", async () => {
    const h = harness({ overrides: [ov()], total: 1 })
    const dialog = await open(h)
    expect(dialog.textContent).toContain("Tenant acme goes back to the app default for app/greeting.")
    fireEvent.click(within(dialog).getByRole("button", { name: "Revert to app default" }))
    await waitFor(() =>
      expect(h.commands).toEqual([
        { intent: "overrides.delete", payload: { key: "app/greeting", tenantId: "acme" } },
      ]),
    )
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
  })

  it("says an orphan's override is what is being removed", async () => {
    const h = harness({ overrides: [ORPHAN], total: 1 })
    renderOverrides(h.client)
    fireEvent.change(tenantBox(), { target: { value: "wayne" } })
    showTenant()
    await screen.findByText("gone/key")
    fireEvent.click(within(rowOf("gone/key")).getByRole("button"))
    const dialog = await screen.findByRole("alertdialog")
    // No app default exists for a deleted key, so the dialog does not promise one.
    expect(dialog.textContent).not.toMatch(/app default/)
    expect(within(dialog).getByText("Remove wayne's leftover override?")).toBeTruthy()
    expect(dialog.textContent).toContain(
      "Tenant wayne's override of gone/key is removed. That key no longer exists, so apps reading it fall back to their own default.",
    )
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove leftover override" }))
    await waitFor(() =>
      expect(h.commands).toEqual([
        { intent: "overrides.delete", payload: { key: "gone/key", tenantId: "wayne" } },
      ]),
    )
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
  })

  it("shows an orphan's refusal under the orphan's own words", async () => {
    const h = harness(
      { overrides: [ORPHAN], total: 1 },
      {},
      new ContractError("NOT_FOUND", "tenant override not found"),
    )
    renderOverrides(h.client)
    fireEvent.change(tenantBox(), { target: { value: "wayne" } })
    showTenant()
    await screen.findByText("gone/key")
    fireEvent.click(within(rowOf("gone/key")).getByRole("button"))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove leftover override" }))
    expect(await within(dialog).findByText(/tenant override not found/)).toBeTruthy()
    expect(within(dialog).getByText("Could not remove the override")).toBeTruthy()
  })

  it("shows a refusal inside the dialog and keeps it open", async () => {
    const h = harness(
      { overrides: [ov()], total: 1 },
      {},
      new ContractError("NOT_FOUND", "tenant override not found"),
    )
    const dialog = await open(h)
    fireEvent.click(within(dialog).getByRole("button", { name: "Revert to app default" }))
    expect(await within(dialog).findByText(/tenant override not found/)).toBeTruthy()
    expect(screen.getByRole("alertdialog")).toBeTruthy()
  })

  it("does not send twice, and cannot be cancelled, while pending", async () => {
    const h = harness({ overrides: [ov()], total: 1 }, {}, undefined, true)
    const dialog = await open(h)
    const confirm = within(dialog).getByRole("button", { name: "Revert to app default" })
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    await waitFor(() => expect(h.commands).toHaveLength(1))
    expect((within(dialog).getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.keyDown(dialog, { key: "Escape" })
    expect(screen.getByRole("alertdialog")).toBeTruthy()
  })

  it("starts each open with no earlier refusal", async () => {
    const h = harness(
      { overrides: [ov(), ov({ key: "other/key", tenantId: "wayne" })], total: 2 },
      {},
      new ContractError("NOT_FOUND", "tenant override not found"),
    )
    const first = await open(h)
    fireEvent.click(within(first).getByRole("button", { name: "Revert to app default" }))
    await within(first).findByText(/tenant override not found/)
    fireEvent.click(within(first).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    fireEvent.click(
      within(screen.getByText("wayne").closest("tr") as HTMLElement).getByRole("button", {
        name: /Revert to app default/,
      }),
    )
    const second = await screen.findByRole("alertdialog")
    expect(within(second).queryByText(/tenant override not found/)).toBeNull()
  })
})
