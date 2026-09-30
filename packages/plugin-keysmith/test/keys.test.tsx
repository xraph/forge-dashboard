import { describe, expect, it } from "vitest"
import { fireEvent, screen, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import type { ScopedClient } from "@forge-go/dashboard-plugin"
import { KeysPage } from "../src/pages/keys"
import { keyPath } from "../src/format"
import type { KeySummary } from "../src/types"
import {
  failingClient,
  recordingQueryClient,
  renderPage,
  stubClient,
} from "./harness"

function key(over: Partial<KeySummary>): KeySummary {
  return {
    id: "akey_01",
    name: "Billing service",
    prefix: "sk",
    hint: "a3f8",
    environment: "live",
    state: "active",
    effectiveState: "active",
    expiryPending: false,
    expiresSoon: false,
    scopes: [],
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
    ...over,
  }
}

// Five keys, each exercising a different absent value or state.
const BILLING = key({
  id: "akey_billing",
  name: "Billing service",
  policyId: "kpol_standard",
  scopes: ["billing:read", "billing:write"],
  expiresAt: "2027-01-01T00:00:00Z",
  lastUsedAt: "2026-09-29T10:00:00Z",
})
const REPORTING = key({
  id: "akey_reporting",
  name: "Reporting export",
  hint: "3d0b",
  environment: "test",
  scopes: ["reports:read"],
  expiresAt: "2027-02-01T00:00:00Z",
})
const WEBHOOK = key({
  id: "akey_webhook",
  name: "Legacy webhook signer",
  prefix: "whk",
  hint: "e5c2",
  effectiveState: "expired",
  expiryPending: true,
  policyId: "kpol_standard",
  scopes: [],
  expiresAt: "2026-09-01T00:00:00Z",
  lastUsedAt: "2026-08-30T00:00:00Z",
})
const PARTNER = key({
  id: "akey_partner",
  name: "Partner sandbox",
  hint: "42ad",
  environment: "staging",
  state: "suspended",
  effectiveState: "suspended",
  policyId: "kpol_standard",
  scopes: ["catalog:read"],
  expiresAt: "2027-03-01T00:00:00Z",
  lastUsedAt: "2026-09-20T00:00:00Z",
})
const MOBILE = key({
  id: "akey_mobile",
  name: "Old mobile app",
  hint: "b7f8",
  state: "revoked",
  effectiveState: "revoked",
  revokedAt: "2026-09-20T00:00:00Z",
  scopes: ["devices:read"],
  lastUsedAt: "2026-09-19T00:00:00Z",
})

const LIST = { keys: [BILLING, REPORTING, WEBHOOK, PARTNER, MOBILE], total: 5 }

/** A client whose keys.list answer depends on the params it was sent. */
function stubClientByParams(
  answer: (params: Record<string, unknown>) => unknown,
): ScopedClient {
  return {
    extension: "keysmith",
    query: async (intent: string, params?: Record<string, unknown>) => {
      if (intent !== "keys.list") {
        throw new ContractError("NOT_FOUND", `no handler for intent "${intent}"`)
      }
      return answer(params ?? {})
    },
    command: async () => {
      throw new ContractError("NOT_FOUND", "no commands")
    },
  } as ScopedClient
}

function rowFor(name: string): HTMLElement {
  const row = screen
    .getAllByRole("row")
    .find((r) => within(r).queryByText(name))
  if (!row) throw new Error(`no row for ${name}`)
  return row
}

describe("KeysPage", () => {
  it("asks keys.list for the first page with no filter params", async () => {
    const { client, sent } = recordingQueryClient({ "keys.list": LIST })
    renderPage(KeysPage, client)
    await screen.findByText("Reporting export")
    const first = sent.find((s) => s.intent === "keys.list")
    expect(first?.params).toEqual({ limit: 25, offset: 0 })
    expect(first?.params).not.toHaveProperty("environment")
    expect(first?.params).not.toHaveProperty("state")
  })

  it("reads the server total in the caption", async () => {
    renderPage(
      KeysPage,
      stubClient({ "keys.list": { keys: LIST.keys, total: 5 } }),
    )
    await screen.findByText("Reporting export")
    expect(screen.getByText("5 keys")).toBeTruthy()
  })

  it("uses the singular for one key", async () => {
    renderPage(
      KeysPage,
      stubClient({ "keys.list": { keys: [BILLING], total: 1 } }),
    )
    await screen.findByText("Billing service")
    expect(screen.getByText("1 key")).toBeTruthy()
  })

  it("says so when there are no keys, with no create action yet", async () => {
    renderPage(KeysPage, stubClient({ "keys.list": { keys: [], total: 0 } }))
    expect(await screen.findByText("No API keys yet.")).toBeTruthy()
    expect(screen.getByText("0 keys")).toBeTruthy()
    expect(screen.queryByRole("link")).toBeNull()
    expect(screen.queryByRole("button", { name: /create|new/i })).toBeNull()
  })

  it("links the name to the key's detail path and shows the masked key in mono", async () => {
    renderPage(KeysPage, stubClient({ "keys.list": LIST }))
    const link = await screen.findByRole("link", { name: "Billing service" })
    expect(link.getAttribute("href")).toBe(keyPath("akey_billing"))
    expect(link.closest("td")?.className).toMatch(/font-medium/)

    const masked = within(rowFor("Billing service")).getByText("sk_live_…a3f8")
    const cell = masked.closest("td")!
    expect(cell.className).toMatch(/font-mono/)
    expect(cell.className).toMatch(/text-xs/)
  })

  it("shows the environment as plain text", async () => {
    renderPage(KeysPage, stubClient({ "keys.list": LIST }))
    await screen.findByText("Partner sandbox")
    expect(within(rowFor("Partner sandbox")).getByText("staging")).toBeTruthy()
  })

  it("shows the policy id in mono, and says so when a key has none", async () => {
    renderPage(KeysPage, stubClient({ "keys.list": LIST }))
    await screen.findByText("Billing service")
    const billing = within(rowFor("Billing service"))
    const policy = billing.getByText("kpol_standard")
    expect(policy.closest("td")?.className).toMatch(/font-mono text-xs/)
    expect(billing.queryByLabelText("no policy")).toBeNull()
    expect(within(rowFor("Reporting export")).getByLabelText("no policy")).toBeTruthy()
  })

  it("shows scopes as tags, and says so when a key has none", async () => {
    renderPage(KeysPage, stubClient({ "keys.list": LIST }))
    await screen.findByText("Billing service")
    expect(within(rowFor("Billing service")).getByText("billing:write")).toBeTruthy()
    expect(within(rowFor("Legacy webhook signer")).getByLabelText("no scopes")).toBeTruthy()
    expect(within(rowFor("Billing service")).queryByLabelText("no scopes")).toBeNull()
  })

  it("says so when a key has never been used or never expires", async () => {
    renderPage(KeysPage, stubClient({ "keys.list": LIST }))
    await screen.findByText("Billing service")
    expect(within(rowFor("Reporting export")).getByLabelText("no recorded use")).toBeTruthy()
    expect(within(rowFor("Old mobile app")).getByLabelText("no expiry")).toBeTruthy()
    const billing = within(rowFor("Billing service"))
    expect(billing.queryByLabelText("no recorded use")).toBeNull()
    expect(billing.queryByLabelText("no expiry")).toBeNull()
  })

  it("shows an expired-but-unmarked key as Expired and keeps the stored state in the row", async () => {
    renderPage(KeysPage, stubClient({ "keys.list": LIST }))
    await screen.findByText("Legacy webhook signer")
    const row = within(rowFor("Legacy webhook signer"))
    expect(row.getByText(/^Expired/)).toBeTruthy()
    expect(row.getByText(/not yet marked/)).toBeTruthy()
  })

  it("filters by environment, sending only the chosen value and resetting to page one", async () => {
    const { client, sent } = recordingQueryClient({
      "keys.list": { keys: LIST.keys, total: 60 },
    })
    renderPage(KeysPage, client)
    await screen.findByText("Reporting export")

    fireEvent.click(screen.getByRole("button", { name: "Next page" }))
    await screen.findByText(/Page 2 of 3/)

    fireEvent.change(screen.getByLabelText("Environment"), {
      target: { value: "test" },
    })
    await screen.findByText(/Page 1 of 3/)
    const calls = sent.filter((s) => s.intent === "keys.list").map((s) => s.params)
    expect(calls).toContainEqual({ limit: 25, offset: 0, environment: "test" })

    // Back to All: no environment key at all, not an empty string.
    fireEvent.change(screen.getByLabelText("Environment"), {
      target: { value: "" },
    })
    await screen.findByText(/Page 1 of 3/)
    const last = sent.filter((s) => s.intent === "keys.list").at(-1)
    expect(last?.params).toEqual({ limit: 25, offset: 0 })
  })

  it("filters by state and explains what the state filter matches", async () => {
    const { client, sent } = recordingQueryClient({ "keys.list": LIST })
    renderPage(KeysPage, client)
    await screen.findByText("Reporting export")

    fireEvent.change(screen.getByLabelText("State"), {
      target: { value: "suspended" },
    })
    await screen.findByText("Reporting export")
    const params = sent.filter((s) => s.intent === "keys.list").map((s) => s.params)
    expect(params).toContainEqual({ limit: 25, offset: 0, state: "suspended" })

    expect(
      screen.getByText(
        "State filters match the recorded state. A key past its expiry is marked expired the next time it is used.",
      ),
    ).toBeTruthy()
  })

  it("combines both filters", async () => {
    const { client, sent } = recordingQueryClient({ "keys.list": LIST })
    renderPage(KeysPage, client)
    await screen.findByText("Reporting export")
    fireEvent.change(screen.getByLabelText("Environment"), { target: { value: "live" } })
    fireEvent.change(screen.getByLabelText("State"), { target: { value: "revoked" } })
    await screen.findByText("Reporting export")
    const params = sent.filter((s) => s.intent === "keys.list").map((s) => s.params)
    expect(params).toContainEqual({
      limit: 25,
      offset: 0,
      environment: "live",
      state: "revoked",
    })
  })

  it("offers the environments and states the contract accepts", async () => {
    renderPage(KeysPage, stubClient({ "keys.list": LIST }))
    await screen.findByText("Reporting export")
    const options = (label: string) =>
      within(screen.getByLabelText(label))
        .getAllByRole("option")
        .map((o) => o.textContent)
    expect(options("Environment")).toEqual(["All", "Live", "Test", "Staging"])
    expect(options("State")).toEqual(["All", "Active", "Suspended", "Revoked", "Expired"])
  })

  it("pages to offset 25 on page two", async () => {
    const { client, sent } = recordingQueryClient({
      "keys.list": { keys: LIST.keys, total: 31 },
    })
    renderPage(KeysPage, client)
    await screen.findByText("Reporting export")
    fireEvent.click(screen.getByRole("button", { name: "Next page" }))
    await screen.findByText(/Page 2 of 2/)
    const params = sent.filter((s) => s.intent === "keys.list").map((s) => s.params)
    expect(params).toContainEqual({ limit: 25, offset: 25 })
  })

  it("says no keys match when a filter finds nothing, and keeps the filters", async () => {
    const client = stubClientByParams((params) =>
      params.state === "revoked"
        ? { keys: [], total: 0 }
        : { keys: LIST.keys, total: 5 },
    )
    renderPage(KeysPage, client)
    await screen.findByText("Reporting export")

    fireEvent.change(screen.getByLabelText("State"), {
      target: { value: "revoked" },
    })
    expect(await screen.findByText("No keys match these filters.")).toBeTruthy()
    expect(screen.queryByText("No API keys yet.")).toBeNull()
    // The count is the server total for the query, which is true.
    expect(screen.getByText("0 keys")).toBeTruthy()
    expect(screen.queryByRole("link")).toBeNull()
    expect(screen.getByLabelText("Environment")).toBeTruthy()
    expect((screen.getByLabelText("State") as HTMLSelectElement).value).toBe("revoked")
  })

  it("keeps saying no API keys yet when nothing is filtered", async () => {
    renderPage(KeysPage, stubClient({ "keys.list": { keys: [], total: 0 } }))
    await screen.findByText("No API keys yet.")
    expect(screen.queryByText("No keys match these filters.")).toBeNull()
    expect(screen.getByLabelText("Environment")).toBeTruthy()
    expect(screen.getByLabelText("State")).toBeTruthy()
  })

  it("steps back to the last page when the data shrinks under the current one", async () => {
    const sent: Record<string, unknown>[] = []
    const client = stubClientByParams((params) => {
      sent.push(params)
      // 60 keys until the viewer reaches page 3, then only 30 remain.
      if (params.offset === 50) return { keys: [], total: 30 }
      if (params.offset === 25) return { keys: LIST.keys, total: sent.some((p) => p.offset === 50) ? 30 : 60 }
      return { keys: LIST.keys, total: 60 }
    })
    renderPage(KeysPage, client)
    await screen.findByText("Reporting export")
    fireEvent.click(screen.getByRole("button", { name: "Next page" }))
    await screen.findByText(/Page 2 of 3/)
    fireEvent.click(screen.getByRole("button", { name: "Next page" }))

    await screen.findByText(/Page 2 of 2/)
    expect(sent.filter((p) => p.offset === 50)).toHaveLength(1)
    expect(sent.filter((p) => p.offset === 25).length).toBeGreaterThan(0)
    expect(screen.getByText("Reporting export")).toBeTruthy()
  })

  it("shows the error state with the message when the list fails", async () => {
    renderPage(
      KeysPage,
      failingClient(new ContractError("INTERNAL", "keys store is down")),
    )
    expect(await screen.findByText(/keys store is down/)).toBeTruthy()
    expect(screen.queryByRole("table")).toBeNull()
  })
})
