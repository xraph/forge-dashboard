import { afterEach, describe, expect, it, vi } from "vitest"
import { act, screen, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { OverviewPage } from "../src/pages/overview"
import type { Stats } from "../src/types"
import {
  failingClient,
  recordingClient,
  renderPage,
  stubClient,
} from "./harness"

const NODE: Stats = {
  scope: "node",
  tenants: 3,
  connected: 1234,
  sessions: 1500,
  subscriptions: 9876,
  retained: 42,
  messagesIn: 1_000_000,
  messagesOut: 2_500_000,
}

function stat(label: string): HTMLElement {
  const cell = screen.getByText(label).closest('[data-slot="stat"]')
  if (!cell) throw new Error(`no stat cell for ${label}`)
  return cell as HTMLElement
}

afterEach(() => {
  vi.useRealTimers()
})

describe("OverviewPage", () => {
  it("renders the node-wide counters", async () => {
    renderPage(OverviewPage, stubClient({ "overview.stats": NODE }))
    await screen.findByRole("heading", { name: "Overview" })
    await screen.findByText("Tenants")
    expect(within(stat("Tenants")).getByText("3")).toBeTruthy()
    expect(within(stat("Connected clients")).getByText("1,234")).toBeTruthy()
    expect(within(stat("Sessions")).getByText("1,500")).toBeTruthy()
    expect(within(stat("Subscriptions")).getByText("9,876")).toBeTruthy()
    expect(within(stat("Retained messages")).getByText("42")).toBeTruthy()
    expect(within(stat("Messages in")).getByText("1,000,000")).toBeTruthy()
    expect(within(stat("Messages out")).getByText("2,500,000")).toBeTruthy()
  })

  it("asks for the node total, which is no tenantId", async () => {
    const { client, queries } = recordingClient({ "overview.stats": NODE })
    renderPage(OverviewPage, client)
    await screen.findByText("Sessions")
    const stats = queries.filter((q) => q.intent === "overview.stats")
    expect(stats).toHaveLength(1)
    expect(stats[0].params ?? {}).not.toHaveProperty("tenantId")
  })

  it("polls overview.stats every 10 seconds", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })
    const { client, queries } = recordingClient({ "overview.stats": NODE })
    const stats = () => queries.filter((q) => q.intent === "overview.stats")
    renderPage(OverviewPage, client)
    await screen.findByText("Sessions")
    expect(stats()).toHaveLength(1)

    await act(async () => {
      vi.advanceTimersByTime(9_999)
    })
    expect(stats()).toHaveLength(1)
    await act(async () => {
      vi.advanceTimersByTime(1)
    })
    expect(stats()).toHaveLength(2)
  })

  it("keeps the counters on screen while a poll is in flight", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })
    let release: (() => void) | undefined
    let calls = 0
    const client = stubClient({
      "overview.stats": () => {
        calls += 1
        if (calls === 1) return NODE
        return new Promise((resolve) => {
          release = () => resolve({ ...NODE, connected: 7 })
        })
      },
    })
    renderPage(OverviewPage, client)
    await screen.findByText("1,234")
    await act(async () => {
      vi.advanceTimersByTime(10_000)
    })
    // The refetch has started and not settled: the old numbers stay.
    expect(screen.getByText("1,234")).toBeTruthy()
    expect(screen.queryByRole("status", { name: /Loading/ })).toBeNull()
    await act(async () => {
      release?.()
    })
    expect(await screen.findByText("7")).toBeTruthy()
  })

  it("tells a signed-out operator how to get in", async () => {
    renderPage(
      OverviewPage,
      failingClient(
        new ContractError("UNAUTHENTICATED", "authentication required")
      )
    )
    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toMatch(/UNAUTHENTICATED/)
    expect(alert.textContent).toMatch(/sign in/i)
    expect(alert.textContent).toMatch(/dashboard auth/i)
  })

  it("says the broker is down when it is", async () => {
    renderPage(
      OverviewPage,
      failingClient(
        new ContractError(
          "UNAVAILABLE",
          "broker is not running",
          undefined,
          true
        )
      )
    )
    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toMatch(/UNAVAILABLE/)
    expect(alert.textContent).toMatch(/broker/i)
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy()
  })

  it("links to the tenants page", async () => {
    renderPage(OverviewPage, stubClient({ "overview.stats": NODE }))
    const link = await screen.findByRole("link", { name: /tenants/i })
    expect(link.getAttribute("href")).toBe("/tenants")
  })
})
