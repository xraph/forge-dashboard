import { describe, expect, it } from "vitest"
import { screen } from "@testing-library/react"
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

  it("reads the stats intent and nothing else", async () => {
    const { client, intents } = recordingClient({ stats })
    renderPage(StreamingOverviewPage, client)

    await screen.findByText("7")
    expect(intents).toEqual(["stats"])
  })

  it("says it is loading rather than rendering a blank pane", () => {
    renderPage(StreamingOverviewPage, pendingClient())

    const busy = screen.getByRole("status")
    expect(busy.getAttribute("aria-busy")).toBe("true")
    expect(busy.getAttribute("aria-label")).toBe("Loading Streaming stats")
  })

  it("shows the contract error code and message when the read fails", async () => {
    renderPage(
      StreamingOverviewPage,
      failingClient(
        new ContractError("UNAVAILABLE", "streaming service is not running")
      )
    )

    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toContain("UNAVAILABLE")
    expect(alert.textContent).toContain("streaming service is not running")
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
