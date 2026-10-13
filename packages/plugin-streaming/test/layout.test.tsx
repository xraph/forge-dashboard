import { describe, expect, it } from "vitest"
import { fireEvent, screen } from "@testing-library/react"
import { layoutViolations } from "@forge-go/dashboard-kit/lib/layout-check"
import { StreamingChannelsPage } from "../src/pages/channels"
import { StreamingConfigPage } from "../src/pages/config"
import { StreamingConnectionsPage } from "../src/pages/connections"
import { StreamingOverviewPage } from "../src/pages/overview"
import { StreamingPresencePage } from "../src/pages/presence"
import { StreamingRoomDetailPage } from "../src/pages/room-detail"
import { StreamingRoomsPage } from "../src/pages/rooms"
import { renderPage, stubClient } from "./harness"

const START = "2026-09-06T09:00:00.000Z"

const room = {
  id: "room_1",
  name: "General",
  description: "General discussion",
  owner: "usr_1",
  members: 2,
  private: false,
  archived: false,
  created: START,
  updated: START,
}

const presence = {
  presence: [
    {
      userID: "ada",
      status: "online",
      lastSeen: START,
      rooms: ["room_1"],
    },
  ],
}

describe("Streaming pages follow the shared layout", () => {
  it("Channels follows the shared layout", async () => {
    const { container } = renderPage(
      StreamingChannelsPage,
      stubClient({
        "channels.list": {
          channels: [
            {
              id: "c1",
              name: "alerts",
              subscriberCount: 12,
              messageCount: 400,
            },
          ],
        },
      })
    )
    await screen.findByText("alerts")
    expect(layoutViolations(container)).toEqual([])
  })

  it("Configuration follows the shared layout", async () => {
    const { container } = renderPage(
      StreamingConfigPage,
      stubClient({
        config: {
          backendType: "redis",
          distributed: true,
          nodeID: "node-1",
          features: { presence: true },
          limits: { maxRooms: 100 },
          // Left empty so the empty-map branch is covered too.
          timeouts: {},
        },
      })
    )
    await screen.findByText("maxRooms")
    expect(layoutViolations(container)).toEqual([])
  })

  it("Connections follows the shared layout", async () => {
    const { container } = renderPage(
      StreamingConnectionsPage,
      stubClient({
        "connections.list": {
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
          ],
        },
      })
    )
    await screen.findByText("conn_1")
    expect(layoutViolations(container)).toEqual([])
  })

  it("Overview follows the shared layout", async () => {
    const { container } = renderPage(
      StreamingOverviewPage,
      stubClient({
        stats: {
          totalConnections: 4,
          totalRooms: 7,
          totalChannels: 3,
          totalMessages: 49,
          onlineUsers: 1,
          messagesPerSec: 3.2,
          uptimeSeconds: 3725,
          memoryBytes: 52_428_800,
        },
        "presence.list": presence,
      })
    )
    await screen.findByText("50.0 MiB")
    await screen.findByText("ada")
    expect(layoutViolations(container)).toEqual([])
  })

  it("Presence follows the shared layout", async () => {
    const { container } = renderPage(
      StreamingPresencePage,
      stubClient({ "presence.list": presence })
    )
    await screen.findByText("ada")
    expect(layoutViolations(container)).toEqual([])
  })

  it("Room detail follows the shared layout", async () => {
    const { container } = renderPage(
      StreamingRoomDetailPage,
      stubClient({
        "rooms.detail": room,
        "rooms.members": {
          members: [
            {
              userID: "ada",
              role: "owner",
              joinedAt: START,
              permissions: ["all"],
            },
          ],
        },
        "rooms.moderation": {
          entries: [
            {
              timestamp: START,
              action: "mute",
              actorID: "ada",
              targetID: "grace",
              reason: "spam",
            },
          ],
        },
      }),
      { id: "room_1" }
    )
    await screen.findByText("mute")
    await screen.findByText("owner")
    expect(layoutViolations(container)).toEqual([])
  })

  it("Rooms follows the shared layout", async () => {
    const { container } = renderPage(
      StreamingRoomsPage,
      stubClient({ "rooms.list": { rooms: [room] } })
    )
    await screen.findByText("usr_1")
    expect(layoutViolations(container)).toEqual([])

    // The create form opens in place and must keep the page on the recipe.
    fireEvent.click(screen.getByRole("button", { name: "New room" }))
    await screen.findByLabelText("Name")
    expect(layoutViolations(container)).toEqual([])
  })
})
