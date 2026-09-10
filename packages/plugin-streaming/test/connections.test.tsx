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
    expect(screen.getByText("2 connections")).toBeDefined()

    // One row per connection: the header row plus a row for each of the two
    // connections. `ResourceTable` renders a real table now, unlike the old
    // hand-rolled markup, so counting rows through the table's own role is
    // an additional check alongside the caption's own count.
    expect(screen.getAllByRole("row")).toHaveLength(3)

    // The joined rooms are shown as their own ids, not just a count, so an
    // operator can see WHICH room a connection is in. conn_1 is in room_1;
    // conn_2 has joined no rooms and renders the "no rooms" placeholder
    // instead of a blank cell.
    expect(screen.getByText("room_1")).toBeDefined()
    expect(screen.getByLabelText("no rooms")).toBeDefined()

    // The subscriptions are shown as their own channel ids too, symmetric with
    // the rooms column: conn_1 is subscribed to chan_1; conn_2 is subscribed
    // to both chan_1 and chan_2, so chan_1 renders twice (once per row) and
    // chan_2 renders once.
    expect(screen.getAllByText("chan_1")).toHaveLength(2)
    expect(screen.getByText("chan_2")).toBeDefined()

    // The status badge carries colour as well as text: an unrecognised
    // status must not render the same as "active", or the at-a-glance scan
    // signal is gone even though the word survives.
    const activeBadge = screen.getByText("active")
    const idleBadge = screen.getByText("idle")
    expect(activeBadge.getAttribute("data-variant")).toBe("default")
    expect(idleBadge.getAttribute("data-variant")).toBe("secondary")
    expect(activeBadge.getAttribute("data-variant")).not.toBe(
      idleBadge.getAttribute("data-variant")
    )
  })

  it("labels an empty subscriptions cell instead of leaving it blank", async () => {
    renderPage(
      StreamingConnectionsPage,
      stubClient({
        "connections.list": {
          connections: [
            {
              connID: "conn_3",
              userID: "usr_3",
              transport: "websocket",
              joinedRooms: ["room_1"],
              subscriptions: [],
              lastActivity: START,
              status: "connecting",
            },
          ],
        },
      })
    )

    expect(await screen.findByLabelText("no subscriptions")).toBeDefined()

    // A status this page has never seen still gets a badge, just a neutral
    // one, rather than rendering as nothing.
    const badge = screen.getByText("connecting")
    expect(badge.getAttribute("data-variant")).toBe("outline")
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
