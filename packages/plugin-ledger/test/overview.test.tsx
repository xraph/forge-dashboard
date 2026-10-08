import { describe, expect, it } from "vitest"
import { screen, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { LedgerOverviewPage } from "../src/pages/overview"
import {
  failingClient,
  recordingQueryClient,
  renderPage,
  stubClient,
} from "./harness"
import { aPage, anInvoice, usd } from "./fixtures"

const STATS = {
  plans: 6,
  active_plans: 2,
  subscriptions_by_status: {
    active: 3,
    trialing: 1,
    past_due: 1,
    paused: 1,
    canceled: 1,
  },
  pending_invoices: 2,
  past_due_invoices: 3,
  coupons: 5,
  capped: false,
}

function answers(over: Record<string, unknown> = {}) {
  return {
    "overview.stats": STATS,
    "invoices.pending": [anInvoice({ id: "inv_p1" })],
    "invoices.list": aPage([anInvoice({ id: "inv_d1", status: "past_due" })]),
    "overview.recentInvoices": [
      anInvoice({ id: "inv_r1", status: "paid", total: usd(12010) }),
      anInvoice({ id: "inv_r2", status: "past_due" }),
    ],
    ...over,
  }
}

// The kit's Badge base class carries `aria-invalid:border-destructive` on every
// variant, so a match on the whole className would hit a paid badge. Drop those
// tokens and what is left is the variant's own classes.
function variantOf(text: string) {
  const badge = screen.getByText(text, { selector: '[data-slot="badge"]' })
  return badge.className
    .split(/\s+/)
    .filter((token) => !token.includes("aria-invalid"))
    .join(" ")
}

describe("LedgerOverviewPage", () => {
  it("counts past-due invoices apart from pending ones", async () => {
    renderPage(LedgerOverviewPage, stubClient(answers()))
    await screen.findByText("inv_r1")
    const card = screen
      .getByText("Past-due invoices", { selector: "[data-slot='card'] *" })
      .closest("[data-slot='card']") as HTMLElement
    expect(within(card).getByText("3")).toBeTruthy()
    expect(within(card).getByText("Not counted as pending")).toBeTruthy()
  })

  it("leaves the past-due stat out for a ledger that does not send the count", async () => {
    const older: Record<string, unknown> = { ...STATS }
    delete older.past_due_invoices
    renderPage(
      LedgerOverviewPage,
      stubClient(answers({ "overview.stats": older }))
    )
    await screen.findByText("inv_r1")
    expect(
      screen.queryByText("Past-due invoices", {
        selector: "[data-slot='card'] *",
      })
    ).toBeNull()
    expect(
      screen.getByText("Pending invoices", { selector: "[data-slot='card'] *" })
    ).toBeTruthy()
  })

  it("reads the overview intents: recent and past-due invoices with a limit of 10", async () => {
    const { client, sent } = recordingQueryClient(answers())
    renderPage(LedgerOverviewPage, client)
    await screen.findByText("inv_r1")
    expect(sent.map((s) => s.intent).sort()).toEqual([
      "invoices.list",
      "invoices.pending",
      "overview.recentInvoices",
      "overview.stats",
    ])
    expect(
      sent.find((s) => s.intent === "overview.recentInvoices")?.params
    ).toEqual({ limit: 10 })
    expect(sent.find((s) => s.intent === "invoices.list")?.params).toEqual({
      status: "past_due",
      limit: 10,
    })
  })

  it("counts live subscriptions as active plus trialing, and past due apart", async () => {
    renderPage(LedgerOverviewPage, stubClient(answers()))
    await screen.findByText("inv_r1")
    const live = screen
      .getByText("Live subscriptions")
      .closest("[data-slot='card']") as HTMLElement
    expect(within(live).getByText("4")).toBeTruthy()
    expect(within(live).getByText("1 trialing")).toBeTruthy()
    const pastDue = screen
      .getByText("Subscriptions past due")
      .closest("[data-slot='card']") as HTMLElement
    expect(within(pastDue).getByText("1")).toBeTruthy()
  })

  it("marks capped counts as lower bounds", async () => {
    renderPage(
      LedgerOverviewPage,
      stubClient(answers({ "overview.stats": { ...STATS, capped: true } }))
    )
    await screen.findByText("inv_r1")
    expect(screen.getByText("6+")).toBeTruthy()
    // The hints are counts of the same scan, so they are floors too.
    expect(screen.getByText("2+ active")).toBeTruthy()
    expect(screen.getByText("1+ trialing")).toBeTruthy()
    expect(screen.getByText("2+")).toBeTruthy()
    expect(screen.getByText(/at least these/)).toBeTruthy()
  })

  it("lists pending invoices and recent ones, with live counts", async () => {
    renderPage(LedgerOverviewPage, stubClient(answers()))
    await screen.findByText("inv_r1")
    expect(screen.getByText("1 invoice pending")).toBeTruthy()
    expect(screen.getByText("2 recent invoices")).toBeTruthy()
    // Only the recent table has a Status column: the pending table is all one status.
    expect(
      screen.getAllByRole("columnheader", { name: "Status" })
    ).toHaveLength(1)
    expect(
      screen.getByText("Pending invoices", { selector: "*:not(h2)" })
    ).toBeTruthy()
    expect(
      screen.getByRole("link", { name: "inv_p1" }).getAttribute("href")
    ).toBe("/invoices/inv_p1")
    expect(variantOf("Past due")).toMatch(/destructive/)
  })

  it("lists the past-due invoices in their own table, so an overdue one is still reachable", async () => {
    // inv_d1 is past due and so is not in the pending answer: this table is the
    // only link to it from the Overview.
    renderPage(LedgerOverviewPage, stubClient(answers()))
    await screen.findByText("inv_r1")
    const heading = screen.getByRole("heading", { name: "Past-due invoices" })
    const section = heading.closest("section") as HTMLElement
    expect(
      within(section).getByRole("link", { name: "inv_d1" }).getAttribute("href")
    ).toBe("/invoices/inv_d1")
    expect(within(section).getByText("1 invoice past due")).toBeTruthy()
    expect(within(section).queryByText(/Showing the newest/)).toBeNull()
  })

  it("says so when no invoice is past due", async () => {
    renderPage(
      LedgerOverviewPage,
      stubClient(answers({ "invoices.list": aPage([]) }))
    )
    expect(await screen.findByText("No invoices are past due.")).toBeTruthy()
    expect(screen.getByText("0 invoices past due")).toBeTruthy()
  })

  it("names the cut when more past-due invoices exist than the table shows", async () => {
    renderPage(
      LedgerOverviewPage,
      stubClient(
        answers({
          "invoices.list": aPage(
            [anInvoice({ id: "inv_d1", status: "past_due" })],
            { has_more: true }
          ),
        })
      )
    )
    expect(
      await screen.findByText(
        "Showing the newest 10. Filter the Invoices list by Past due to see the rest."
      )
    ).toBeTruthy()
    expect(screen.getByText("1 invoice past due, newest first")).toBeTruthy()
  })

  it("says so when no invoice is pending", async () => {
    renderPage(
      LedgerOverviewPage,
      stubClient(answers({ "invoices.pending": [] }))
    )
    expect(await screen.findByText("No invoices are pending.")).toBeTruthy()
    expect(screen.getByText("0 invoices pending")).toBeTruthy()
  })

  it("shows the no-app refusal, not an empty dashboard", async () => {
    renderPage(
      LedgerOverviewPage,
      failingClient(
        new ContractError(
          "PERMISSION_DENIED",
          "no app selected: set the extension's app_id or send an app_id claim"
        )
      )
    )
    const alerts = await screen.findAllByText(
      /PERMISSION_DENIED: no app selected/
    )
    expect(alerts.length).toBeGreaterThan(0)
    // ResourceTable renders an EmptyState, not a table, so a table query proves
    // nothing. These are what an empty dashboard would have said instead.
    expect(screen.queryByText("No invoices are pending.")).toBeNull()
    expect(screen.queryByText("No invoices have been issued yet.")).toBeNull()
    expect(screen.queryByText("Live subscriptions")).toBeNull()
    expect(screen.queryByRole("table")).toBeNull()
  })
})
