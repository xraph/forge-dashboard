import { describe, expect, it } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import {
  StreamingOverviewPage,
  formatBytes,
  formatUptime,
} from "../src/pages/overview"
import type { StreamingStats } from "../src/pages/overview"
import {
  failingClient,
  pendingClient,
  recordingClient,
  renderPage,
  stubClient,
} from "./harness"

const stats: StreamingStats = {
  totalConnections: 2,
  totalRooms: 7,
  totalChannels: 3,
  totalMessages: 49,
  onlineUsers: 1,
  messagesPerSec: 3.2,
  uptimeSeconds: 3725,
  memoryBytes: 52_428_800,
}

describe("StreamingOverviewPage", () => {
  it("renders every stat it was given", async () => {
    renderPage(StreamingOverviewPage, stubClient({ stats }))

    // Each label pairs with a value that appears nowhere else in the fixture,
    // so a card wired to the wrong field fails rather than coincidentally
    // matching its neighbour.
    expect(await screen.findByText("7")).toBeDefined()
    expect(screen.getByText("Connections")).toBeDefined()
    expect(screen.getByText("Rooms")).toBeDefined()
    expect(screen.getByText("49")).toBeDefined()
    expect(screen.getByText("3.2")).toBeDefined()
    expect(screen.getByText("1h 2m")).toBeDefined()
    expect(screen.getByText("50.0 MiB")).toBeDefined()
  })

  it("reads the stats and presence intents and nothing else", async () => {
    const { client, intents } = recordingClient({
      stats,
      "presence.list": { presence: [] },
    })
    renderPage(StreamingOverviewPage, client)

    await screen.findByText("7")
    // Stats and presence are separate reads in separate components, so their
    // relative order is not guaranteed - only that these are the only two.
    expect(intents).toHaveLength(2)
    expect(new Set(intents)).toEqual(new Set(["stats", "presence.list"]))
  })

  it("says it is loading rather than rendering a blank pane", () => {
    renderPage(StreamingOverviewPage, pendingClient())

    // The stats grid and the presence panel are separate reads with separate
    // boundaries, so each announces its own busy state rather than sharing one.
    const statsBusy = screen.getByRole("status", { name: "Loading Streaming stats" })
    expect(statsBusy.getAttribute("aria-busy")).toBe("true")

    const presenceBusy = screen.getByRole("status", { name: "Loading Online users" })
    expect(presenceBusy.getAttribute("aria-busy")).toBe("true")
  })

  it("shows the contract error code and message when the read fails", async () => {
    renderPage(
      StreamingOverviewPage,
      failingClient(
        new ContractError("UNAVAILABLE", "streaming service is not running")
      )
    )

    // Both reads fail independently, so both boundaries render their own
    // error card rather than one read's failure hiding the other's.
    const alerts = await screen.findAllByRole("alert")
    expect(alerts).toHaveLength(2)
    for (const alert of alerts) {
      expect(alert.textContent).toContain("UNAVAILABLE")
      expect(alert.textContent).toContain("streaming service is not running")
    }
  })
})

describe("StreamingOverviewPage presence", () => {
  it("lists who is online alongside the counters", async () => {
    renderPage(
      StreamingOverviewPage,
      stubClient({
        stats,
        "presence.list": {
          presence: [
            { userID: "ada", status: "online", lastSeen: "2026-09-08T10:00:00Z", rooms: ["r1"] },
            { userID: "grace", status: "away", customStatus: "lunch", lastSeen: "2026-09-08T09:00:00Z", rooms: [] },
          ],
        },
      }),
    )

    await waitFor(() => expect(screen.getByText("ada")).toBeTruthy())
    expect(screen.getByText("grace")).toBeTruthy()
    // A custom status is the operator-supplied part and must survive.
    expect(screen.getByText("lunch")).toBeTruthy()
    // The caption carries a live row count, not the static "Online users"
    // title this table used to render regardless of how many rows it had.
    expect(screen.getByText("2 people online", { selector: "caption" })).toBeTruthy()
  })

  it("says so when nobody is online rather than rendering an empty table", async () => {
    renderPage(StreamingOverviewPage, stubClient({ stats, "presence.list": { presence: [] } }))
    await waitFor(() => expect(screen.getByText("Nobody is online.")).toBeTruthy())
  })
})

describe("formatters", () => {
  it("formats uptime by the largest unit that is non-zero", () => {
    expect(formatUptime(45)).toBe("45s")
    expect(formatUptime(125)).toBe("2m 5s")
    expect(formatUptime(3725)).toBe("1h 2m")
  })

  it("formats bytes without inventing a unit below a kibibyte", () => {
    expect(formatBytes(512)).toBe("512 B")
    expect(formatBytes(2048)).toBe("2.0 KiB")
    expect(formatBytes(52_428_800)).toBe("50.0 MiB")
  })
})
