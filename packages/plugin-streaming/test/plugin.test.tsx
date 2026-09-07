import { describe, expect, it } from "vitest"
import { screen } from "@testing-library/react"
import { resolvePluginState } from "@forge-go/dashboard-plugin"
import type { Capabilities } from "@forge-go/dashboard-plugin"
import streamingPlugin, { streamingPlugin as named } from "../src/index"
import { renderPage, stubClient } from "./harness"

/**
 * A capabilities document shaped like the one the Go host answers, carrying
 * whichever contributors a test wants to exist.
 */
function capabilities(
  ...contributors: { name: string; configured?: boolean; message?: string }[]
): Capabilities {
  return {
    shellEnvelopes: ["v1"],
    contributors: contributors.map((c) => ({
      name: c.name,
      envelopes: ["v1"],
      configured: c.configured ?? true,
      ...(c.message ? { message: c.message } : {}),
    })),
  }
}

describe("streamingPlugin", () => {
  it("is the default export as well as a named one", () => {
    expect(streamingPlugin).toBe(named)
  })

  /**
   * The join key, checked the only way that means anything.
   *
   * Comparing `plugin.extension` to the literal "streaming-contract" would
   * compare the source line to itself: rename the constant and the test
   * renames with it. What matters is what the host does with the name, so
   * this resolves the plugin against a capabilities response carrying the
   * contributor the extension really registers (from
   * `extensions/streaming/contract/manifest.yaml`). The key is otherwise
   * covered only from a third package, `apps/shell/test/app.test.tsx`, so
   * without this the suite would stay green with the name wrong.
   */
  it("resolves to ready against a host reporting streaming's contributor", () => {
    expect(
      resolvePluginState(
        streamingPlugin,
        capabilities({ name: "streaming-contract" })
      )
    ).toEqual({ kind: "ready" })
  })

  it("is hidden when the host reports the extension name but not the contributor", () => {
    // "streaming" is the extension's own name and the tempting wrong value.
    // A host reporting it under that name is still not reporting
    // `streaming-contract`, and the plugin must vanish rather than render
    // against a contributor that is not there: no routes, no nav, no log.
    expect(
      resolvePluginState(streamingPlugin, capabilities({ name: "streaming" }))
    ).toEqual({ kind: "hidden" })
  })

  it("asks for setup when the contributor is present but unconfigured", () => {
    expect(
      resolvePluginState(
        streamingPlugin,
        capabilities({
          name: "streaming-contract",
          configured: false,
          message: "Enable the streaming extension to continue",
        })
      )
    ).toEqual({
      kind: "setup",
      message: "Enable the streaming extension to continue",
    })
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
