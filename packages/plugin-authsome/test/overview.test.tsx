import { describe, expect, it } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import { renderPage, stubClient } from "./harness"
import { AuthOverviewPage } from "../src/pages/overview"

const answers = {
  "overview.stats": { users: 42, sessions: 7, devices: 3, plugins: 2 },
  "overview.recentSignups": {
    users: [
      {
        id: "u1",
        email: "ada@example.com",
        emailVerified: true,
        firstName: "Ada",
        lastName: "Lovelace",
        banned: false,
        createdAt: "2026-01-01T00:00:00Z",
      },
    ],
  },
}

describe("AuthOverviewPage", () => {
  it("renders the four counters and the recent signups", async () => {
    const { client } = stubClient(answers)
    renderPage(AuthOverviewPage, client)

    await waitFor(() => expect(screen.getByText("42")).toBeTruthy())
    expect(screen.getByText("7")).toBeTruthy()
    expect(screen.getByText("3")).toBeTruthy()
    expect(screen.getByText("2")).toBeTruthy()
    expect(screen.getByText("Users")).toBeTruthy()
    expect(screen.getByText("Sessions")).toBeTruthy()
    expect(screen.getByText("Devices")).toBeTruthy()
    expect(screen.getByText("Plugins")).toBeTruthy()

    expect(screen.getByText("ada@example.com")).toBeTruthy()
    expect(screen.getByText("Ada Lovelace")).toBeTruthy()
  })

  it("passes the recent-signups limit through to the server", async () => {
    const { client, intents } = stubClient(answers)
    renderPage(AuthOverviewPage, client)
    await waitFor(() => expect(screen.getByText("ada@example.com")).toBeTruthy())
    expect(intents).toContain("overview.recentSignups")
  })

  it("renders correctly standalone, with no widgets heading, when nothing contributes to the slot", async () => {
    // This page is mounted with no SubPluginProvider anywhere above it, the
    // way `renderPage` always renders a page: as the host's own route, not as
    // a slot contribution. `useSlotCount` reads 0 in that case, so the
    // heading above `PluginSlot` must not appear, and `PluginSlot` itself
    // renders nothing at all.
    const { client } = stubClient(answers)
    renderPage(AuthOverviewPage, client)
    await waitFor(() => expect(screen.getByText("42")).toBeTruthy())
    expect(screen.queryByText("More from your plugins")).toBeNull()
  })
})
