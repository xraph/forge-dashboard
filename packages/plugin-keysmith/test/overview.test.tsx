import { describe, expect, it, vi } from "vitest"
import { screen, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { formatTimestamp } from "@forge-go/dashboard-kit/lib/format"
import { OverviewPage } from "../src/pages/overview"
import { keyPath } from "../src/format"
import type { KeySummary, Overview, RotationItem } from "../src/types"
import {
  failingClient,
  recordingClient,
  renderPage,
  stubClient,
} from "./harness"

// The overview is eager, in the plugin's entry chunk. Recharts belongs to the
// lazy Usage page alone, and this package reaches it only through the kit's
// chart module (recharts is not one of its own dependencies, so mocking the
// bare "recharts" id here would match nothing). If anything the overview
// imports loads that module, this factory throws and the file fails to load.
vi.mock("@forge-go/dashboard-kit/components/chart", () => {
  throw new Error(
    "the overview must not load the kit chart, and Recharts with it"
  )
})

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
    createdAt: "2026-10-01T09:00:00Z",
    updatedAt: "2026-10-01T09:00:00Z",
    ...over,
  }
}

function rotation(over: Partial<RotationItem>): RotationItem {
  return {
    id: "krot_1",
    keyId: "akey_billing",
    keyName: "Billing service",
    prefix: "sk",
    environment: "live",
    oldHint: "9c1e",
    newHint: "a3f8",
    reason: "manual",
    graceSeconds: 86400,
    graceEnds: "2026-10-06T12:00:00Z",
    windowOpen: true,
    rotatedBy: "user_ops",
    rotatedAt: "2026-10-05T12:00:00Z",
    ...over,
  }
}

const BILLING = key({ id: "akey_billing", name: "Billing service" })
const PARTNER = key({
  id: "akey_partner",
  name: "Partner sandbox",
  environment: "staging",
  hint: "42ad",
  state: "suspended",
  effectiveState: "suspended",
  createdAt: "2026-09-20T08:30:00Z",
})

// Stored active, but its expiry has passed: the badge reads Expired, and the
// counts put it under expired with it.
const WEBHOOK = key({
  id: "akey_webhook",
  name: "Legacy webhook signer",
  prefix: "whk",
  hint: "e5c2",
  effectiveState: "expired",
  expiryPending: true,
  expiresAt: "2026-10-03T00:00:00Z",
  createdAt: "2026-06-27T00:00:00Z",
})

const OPEN = rotation({})
const CLOSED = rotation({
  id: "krot_2",
  keyId: "akey_partner",
  keyName: "Partner sandbox",
  environment: "staging",
  newHint: "42ad",
  reason: "compromise",
  graceSeconds: 0,
  graceEnds: "2026-10-04T09:00:00Z",
  windowOpen: false,
  rotatedAt: "2026-10-04T09:00:00Z",
})
// The key no longer exists in this tenant: no name, prefix or environment.
const GONE = rotation({
  id: "krot_3",
  keyId: "akey_deleted",
  keyName: null,
  prefix: null,
  environment: null,
  newHint: "77e1",
  reason: "policy",
  windowOpen: false,
  rotatedAt: "2026-09-01T00:00:00Z",
})

function overview(over: Partial<Overview> = {}): Overview {
  return {
    counts: { active: 3, suspended: 1, revoked: 2, expired: 1 },
    openGraceWindows: 2,
    expiringWithin7Days: 1,
    requestsLast24h: 1234,
    recentKeys: [BILLING, PARTNER, WEBHOOK],
    recentRotations: [OPEN, CLOSED, GONE],
    enforcedFields: 3,
    policyFields: 13,
    ...over,
  }
}

function renderOverview(data: Overview = overview()) {
  return renderPage(OverviewPage, stubClient({ overview: data }))
}

/** The stat card whose label is `label`. */
function stat(label: string): HTMLElement {
  const card = screen.getByText(label).closest<HTMLElement>("[data-slot=card]")
  if (!card) throw new Error(`no stat card for ${label}`)
  return card
}

/** The stat's value, the card title. */
function statValue(label: string): string {
  const title = stat(label).querySelector("[data-slot=card-title]")
  return title?.textContent ?? ""
}

function rowWith(table: HTMLElement, text: string): HTMLElement {
  const row = within(table)
    .getAllByRole("row")
    .find((r) => within(r).queryByText(text))
  if (!row) throw new Error(`no row with ${text}`)
  return row
}

function cellOf(
  table: HTMLElement,
  row: HTMLElement,
  column: string
): HTMLElement {
  const headers = within(table)
    .getAllByRole("columnheader")
    .map((h) => h.textContent)
  const index = headers.indexOf(column)
  if (index < 0) throw new Error(`no column ${column}`)
  return within(row).getAllByRole("cell")[index]!
}

/** The section under the heading `name`. */
function section(name: string): HTMLElement {
  const el = screen.getByRole("region", { name })
  return el
}

describe("OverviewPage", () => {
  it("asks for the overview", async () => {
    const { client, intents } = recordingClient({ overview: overview() })
    renderPage(OverviewPage, client)
    expect(
      await screen.findByRole("heading", { name: "Overview" })
    ).toBeTruthy()
    await screen.findByText("Active keys")
    expect(intents).toEqual(["overview"])
  })

  it("loads without Recharts, which only the lazy Usage page may pull in", async () => {
    // The vi.mock above is the assertion: this file would not load otherwise.
    renderOverview()
    expect(await screen.findByText("Active keys")).toBeTruthy()
  })

  describe("stats", () => {
    it("counts active keys, with the other states beneath", async () => {
      renderOverview()
      await screen.findByText("Active keys")
      expect(statValue("Active keys")).toBe("3")
      expect(
        within(stat("Active keys")).getByText(
          "1 suspended, 2 revoked, 1 expired"
        )
      ).toBeTruthy()
    })

    it("counts the way the badges read, so a key past its expiry is expired in both", async () => {
      // The counts come from the contract by effective state. The one key in
      // the list whose stored state is active but whose badge says Expired is
      // the one the expired count holds, not one more active key.
      renderOverview()
      await screen.findByText("Recent keys")
      const table = within(section("Recent keys")).getByRole("table")
      expect(
        cellOf(table, rowWith(table, "Legacy webhook signer"), "State")
          .textContent
      ).toMatch(/^Expired/)
      expect(within(stat("Active keys")).getByText(/, 1 expired$/)).toBeTruthy()
    })

    it("counts open grace windows", async () => {
      renderOverview()
      await screen.findByText("Open grace windows")
      expect(statValue("Open grace windows")).toBe("2")
    })

    it("counts keys expiring within 7 days", async () => {
      renderOverview()
      await screen.findByText("Expiring within 7 days")
      expect(statValue("Expiring within 7 days")).toBe("1")
    })

    it("counts requests in the last 24 hours with separators", async () => {
      renderOverview()
      await screen.findByText("Requests in the last 24h")
      expect(statValue("Requests in the last 24h")).toBe("1,234")
      expect(screen.queryByText("Not recorded")).toBeNull()
    })

    it("reads Not recorded when the tenant has never recorded usage, never 0", async () => {
      renderOverview(overview({ requestsLast24h: null }))
      await screen.findByText("Requests in the last 24h")
      const card = stat("Requests in the last 24h")
      expect(statValue("Requests in the last 24h")).toBe("Not recorded")
      expect(
        within(card).getByText(
          "Usage appears once your application calls RecordUsage."
        )
      ).toBeTruthy()
    })

    it("shows a real 0 as 0 when usage was recorded, just not lately", async () => {
      renderOverview(overview({ requestsLast24h: 0 }))
      await screen.findByText("Requests in the last 24h")
      expect(statValue("Requests in the last 24h")).toBe("0")
      expect(screen.queryByText("Not recorded")).toBeNull()
      expect(
        screen.queryByText(
          "Usage appears once your application calls RecordUsage."
        )
      ).toBeNull()
    })
  })

  describe("expiring emphasis", () => {
    /** The kit's tone, as the card carries it. */
    function toneOf(label: string): string | null {
      return stat(label).getAttribute("data-tone")
    }

    function title(label: string): HTMLElement {
      return stat(label).querySelector<HTMLElement>("[data-slot=card-title]")!
    }

    it("gives the expiring card the danger tone when a key expires within 7 days", async () => {
      renderOverview(overview({ expiringWithin7Days: 2 }))
      await screen.findByText("Expiring within 7 days")
      expect(toneOf("Expiring within 7 days")).toBe("danger")
      expect(stat("Expiring within 7 days").className).toContain(
        "ring-destructive/50"
      )
      expect(title("Expiring within 7 days").className).toContain(
        "text-destructive"
      )
      // Colour is not the only cue: the card says what to do.
      expect(
        within(stat("Expiring within 7 days")).getByText(
          "Shown as Expires soon on Keys."
        )
      ).toBeTruthy()
      // The tone is the card's own. Nothing on the grid aims at it by position.
      expect(
        stat("Expiring within 7 days").parentElement!.className
      ).not.toContain("destructive")
    })

    it("leaves the card plain at 0", async () => {
      renderOverview(overview({ expiringWithin7Days: 0 }))
      await screen.findByText("Expiring within 7 days")
      expect(statValue("Expiring within 7 days")).toBe("0")
      expect(toneOf("Expiring within 7 days")).toBe("default")
      expect(stat("Expiring within 7 days").className).not.toContain(
        "destructive"
      )
      expect(screen.queryByText("Shown as Expires soon on Keys.")).toBeNull()
    })

    it("emphasises nothing else, however high the other counts", async () => {
      renderOverview(
        overview({
          counts: { active: 90, suspended: 9, revoked: 9, expired: 9 },
          openGraceWindows: 40,
          expiringWithin7Days: 3,
          requestsLast24h: 99999,
        })
      )
      await screen.findByText("Expiring within 7 days")
      for (const label of [
        "Active keys",
        "Open grace windows",
        "Requests in the last 24h",
      ]) {
        expect(toneOf(label)).toBe("default")
        expect(stat(label).className).not.toContain("destructive")
        expect(title(label).className).not.toContain("destructive")
      }
    })
  })

  describe("recent keys", () => {
    it("lists each key with a link, the masked key, its state and when it was created", async () => {
      renderOverview()
      await screen.findByText("Recent keys")
      const table = within(section("Recent keys")).getByRole("table")
      const row = rowWith(table, "Billing service")

      const link = within(cellOf(table, row, "Name")).getByRole("link", {
        name: "Billing service",
      })
      expect(link.getAttribute("href")).toBe(keyPath("akey_billing"))

      const masked = cellOf(table, row, "Key")
      expect(masked.textContent).toBe("sk_live_…a3f8")
      expect(masked.className).toContain("font-mono")
      expect(masked.className).toContain("text-xs")

      expect(cellOf(table, row, "State").textContent).toBe("Active")
      expect(cellOf(table, row, "Created").textContent).toBe(
        formatTimestamp("2026-10-01T09:00:00Z")
      )

      const partner = rowWith(table, "Partner sandbox")
      expect(cellOf(table, partner, "Key").textContent).toBe("sk_staging_…42ad")
      expect(cellOf(table, partner, "State").textContent).toBe("Suspended")
    })

    it("links to every key", async () => {
      renderOverview()
      await screen.findByText("Recent keys")
      const link = within(section("Recent keys")).getByRole("link", {
        name: "View all keys",
      })
      expect(link.getAttribute("href")).toBe("/keys")
      expect(link.textContent).toBe("View all")
    })

    it("says No keys yet. when there are none", async () => {
      renderOverview(overview({ recentKeys: [] }))
      expect(await screen.findByText("No keys yet.")).toBeTruthy()
      expect(within(section("Recent keys")).queryByRole("table")).toBeNull()
    })
  })

  describe("recent rotations", () => {
    it("lists each rotation with its key, reason, window and time", async () => {
      renderOverview()
      await screen.findByText("Recent rotations")
      const table = within(section("Recent rotations")).getByRole("table")

      const open = rowWith(table, "Billing service")
      const link = within(cellOf(table, open, "Key")).getByRole("link", {
        name: "Billing service",
      })
      expect(link.getAttribute("href")).toBe(keyPath("akey_billing"))
      expect(cellOf(table, open, "Reason").textContent).toBe("Manual")
      expect(cellOf(table, open, "Window").textContent).toBe(
        `Window ends ${formatTimestamp("2026-10-06T12:00:00Z")}`
      )
      expect(cellOf(table, open, "When").textContent).toBe(
        formatTimestamp("2026-10-05T12:00:00Z")
      )

      const closed = rowWith(table, "Partner sandbox")
      expect(cellOf(table, closed, "Reason").textContent).toBe("Compromise")
      expect(cellOf(table, closed, "Window").textContent).toBe("Closed")
    })

    it("never says a previous key keeps working", async () => {
      renderOverview()
      await screen.findByText("Recent rotations")
      expect(screen.queryByText(/keeps working/)).toBeNull()
    })

    it("shows a rotation whose key no longer exists by id, without a link", async () => {
      renderOverview()
      await screen.findByText("Recent rotations")
      const table = within(section("Recent rotations")).getByRole("table")
      const row = rowWith(table, "akey_deleted")
      const keyCell = cellOf(table, row, "Key")
      expect(within(keyCell).queryByRole("link")).toBeNull()
      expect(within(keyCell).getByText("akey_deleted").className).toContain(
        "font-mono"
      )
      expect(within(keyCell).getByText("Key no longer exists")).toBeTruthy()
      expect(cellOf(table, row, "Reason").textContent).toBe("Policy")
      expect(cellOf(table, row, "Window").textContent).toBe("Closed")
    })

    it("links to every rotation", async () => {
      renderOverview()
      await screen.findByText("Recent rotations")
      const link = within(section("Recent rotations")).getByRole("link", {
        name: "View all rotations",
      })
      expect(link.getAttribute("href")).toBe("/rotations")
      expect(link.textContent).toBe("View all")
    })

    it("says No rotations yet. when there are none", async () => {
      renderOverview(overview({ recentRotations: [] }))
      expect(await screen.findByText("No rotations yet.")).toBeTruthy()
      expect(
        within(section("Recent rotations")).queryByRole("table")
      ).toBeNull()
    })
  })

  describe("enforcement line", () => {
    it("says how many policy fields this deployment enforces, linking to settings", async () => {
      renderOverview()
      const link = await screen.findByRole("link", {
        name: "This deployment enforces 3 of 13 policy fields.",
      })
      expect(link.getAttribute("href")).toBe("/settings")
    })

    it("counts the rate-limit fields when a limiter is configured", async () => {
      renderOverview(overview({ enforcedFields: 5 }))
      expect(
        await screen.findByRole("link", {
          name: "This deployment enforces 5 of 13 policy fields.",
        })
      ).toBeTruthy()
    })

    it("takes the field total from the response", async () => {
      renderOverview(overview({ enforcedFields: 4, policyFields: 14 }))
      expect(
        await screen.findByText(
          "This deployment enforces 4 of 14 policy fields."
        )
      ).toBeTruthy()
    })
  })

  it("shows the error state with the message when the overview fails", async () => {
    renderPage(
      OverviewPage,
      failingClient(new ContractError("INTERNAL", "overview store is down"))
    )
    expect(await screen.findByText(/overview store is down/)).toBeTruthy()
    expect(screen.queryByText("Active keys")).toBeNull()
    expect(screen.queryByRole("table")).toBeNull()
  })
})
