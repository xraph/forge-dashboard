import { describe, expect, it } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { StreamingConnectionsPage } from "../src/pages/connections"
import type { ConnectionsList } from "../src/pages/connections"
import {
  failingClient,
  pendingClient,
  recordingClient,
  renderPage,
  stubClient,
} from "./harness"

const START = "2026-09-06T09:00:00.000Z"

const connections: ConnectionsList = {
  connections: [
    {
      connID: "conn_1",
      userID: "usr_1",
      transport: "websocket",
      joinedRooms: ["room_1"],
      subscriptions: ["chan_1"],
      lastActivity: START,
      status: "active",
    },
    {
      connID: "conn_2",
      userID: "usr_2",
      transport: "sse",
      joinedRooms: [],
      subscriptions: ["chan_1", "chan_2"],
      lastActivity: START,
      status: "idle",
    },
  ],
}

describe("StreamingConnectionsPage", () => {
  it("renders a row per connection, with the fields it was given", async () => {
    renderPage(
      StreamingConnectionsPage,
      stubClient({ "connections.list": connections })
    )

    expect(await screen.findByText("conn_1")).toBeDefined()
    expect(screen.getByText("conn_2")).toBeDefined()
    expect(screen.getByText("usr_1")).toBeDefined()
    expect(screen.getByText("usr_2")).toBeDefined()
    expect(screen.getByText("websocket")).toBeDefined()
    expect(screen.getByText("sse")).toBeDefined()
    expect(screen.getByText("active")).toBeDefined()
    expect(screen.getByText("idle")).toBeDefined()
    expect(
      screen.getByText("Connections", { selector: "caption" })
    ).toBeDefined()

    // One row per connection: the header row plus a row for each of the two
    // connections. `ResourceTable` renders a real table now, unlike the old
    // hand-rolled markup, so counting rows through the table's own role is
    // what stands in for the old "2 connections" caption text.
    expect(screen.getAllByRole("row")).toHaveLength(3)

    // The joined rooms are shown as their own ids, not just a count, so an
    // operator can see WHICH room a connection is in. conn_1 is in room_1;
    // conn_2 has joined no rooms and renders no badge for it.
    expect(screen.getByText("room_1")).toBeDefined()

    // The subscriptions column is a count, not the channel ids themselves
    // (the brief only asked for a count here, unlike the rooms column) - one
    // subscription for conn_1, two for conn_2.
    expect(screen.getByText("1")).toBeDefined()
    expect(screen.getByText("2")).toBeDefined()
  })

  it("reads the connections.list intent and nothing else", async () => {
    const { client, intents } = recordingClient({
      "connections.list": connections,
    })
    renderPage(StreamingConnectionsPage, client)

    await screen.findByText("conn_1")
    expect(intents).toEqual(["connections.list"])
  })

  it("says it is loading rather than rendering a blank pane", () => {
    renderPage(StreamingConnectionsPage, pendingClient())

    const busy = screen.getByRole("status")
    expect(busy.getAttribute("aria-busy")).toBe("true")
    expect(busy.getAttribute("aria-label")).toBe("Loading Connections")
  })

  it("shows the contract error code and message when the read fails", async () => {
    renderPage(
      StreamingConnectionsPage,
      failingClient(
        new ContractError("TRANSPORT", "contract request failed with HTTP 502")
      )
    )

    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toContain("TRANSPORT")
    expect(alert.textContent).toContain("HTTP 502")
  })

  it("shows the empty message instead of a headerless table", async () => {
    renderPage(
      StreamingConnectionsPage,
      stubClient({ "connections.list": { connections: [] } })
    )

    await waitFor(() =>
      expect(screen.getByText("No connections right now.")).toBeDefined()
    )
    expect(screen.queryByRole("table")).toBeNull()
  })
})
