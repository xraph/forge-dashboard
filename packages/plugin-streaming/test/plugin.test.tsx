import { describe, expect, it } from "vitest"
import { screen } from "@testing-library/react"
import streamingPlugin, { streamingPlugin as named } from "../src/index"
import { renderPage, stubClient } from "./harness"

describe("streamingPlugin", () => {
  it("is the default export as well as a named one", () => {
    expect(streamingPlugin).toBe(named)
  })

  /**
   * The join key. "streaming" is the extension's own name and the wrong value
   * here; the contributor in the manifest is "streaming-contract". Getting
   * this wrong resolves to `hidden`, which renders nothing and reports
   * nothing, so nothing else in this suite would catch it.
   */
  it("names the Go contributor, not the extension", () => {
    expect(streamingPlugin.extension).toBe("streaming-contract")
  })

  it("declares no requires range, so the version check is skipped", () => {
    expect(streamingPlugin.requires).toBeUndefined()
  })

  it("gives every route a nav entry pointing at it", () => {
    const paths = streamingPlugin.routes.map((r) => r.path).sort()
    const targets = streamingPlugin.nav.map((n) => n.to).sort()
    expect(paths).toEqual([
      "/streaming",
      "/streaming/connections",
      "/streaming/rooms",
    ])
    expect(targets).toEqual(paths)
  })

  it("mounts each route's element, and each one reads its own intent", async () => {
    const answers = {
      stats: {
        totalConnections: 2,
        totalRooms: 7,
        totalChannels: 3,
        totalMessages: 49,
        onlineUsers: 1,
        messagesPerSec: 3.2,
        uptimeSeconds: 3725,
        memoryBytes: 52_428_800,
      },
      "rooms.list": {
        rooms: [
          {
            id: "room_1",
            name: "General",
            description: "",
            owner: "usr_1",
            members: 2,
            private: false,
            archived: false,
            created: "2026-09-06T09:00:00.000Z",
            updated: "2026-09-06T09:00:00.000Z",
          },
        ],
      },
      "connections.list": {
        connections: [
          {
            connID: "conn_1",
            userID: "usr_1",
            transport: "websocket",
            joinedRooms: ["room_1"],
            subscriptions: ["chan_1"],
            lastActivity: "2026-09-06T09:00:00.000Z",
            status: "active",
          },
        ],
      },
    }

    const expected: Record<string, string> = {
      "/streaming": "7",
      "/streaming/rooms": "General",
      "/streaming/connections": "conn_1",
    }

    for (const route of streamingPlugin.routes) {
      const { unmount } = renderPage(route.element, stubClient(answers))
      expect(await screen.findByText(expected[route.path])).toBeDefined()
      unmount()
    }
  })
})
