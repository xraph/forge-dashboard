import { describe, expect, it } from "vitest"
import { screen } from "@testing-library/react"
import { resolvePluginState } from "@forge-go/dashboard-plugin"
import type { Capabilities } from "@forge-go/dashboard-plugin"
import authsomePlugin, { authsomePlugin as named } from "../src/index"
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

describe("authsomePlugin", () => {
  it("is the default export as well as a named one", () => {
    expect(authsomePlugin).toBe(named)
  })

  /**
   * The join key, checked the only way that means anything.
   *
   * Comparing `plugin.extension` to the literal "auth" would compare the
   * source line to itself: rename the constant and the test renames with it.
   * What actually matters is what the host does with the name, so this
   * resolves the plugin against a capabilities response that carries the
   * contributor authsome really registers. Point `extension` at "authsome",
   * at the package name, or at anything else the server does not report and
   * this drops to `hidden` - which mounts no routes, shows no nav and logs
   * nothing.
   */
  it("resolves to ready against a host reporting authsome's contributor", () => {
    expect(
      resolvePluginState(authsomePlugin, capabilities({ name: "auth" }))
    ).toEqual({
      kind: "ready",
    })
  })

  it("is hidden when the host reports the app slug but not the contributor", () => {
    // "authsome" is the repository and the app slug. A host that reported it
    // under that name would still not be reporting `auth`, and the plugin
    // must vanish rather than render against a contributor that is not there.
    expect(
      resolvePluginState(authsomePlugin, capabilities({ name: "authsome" }))
    ).toEqual({ kind: "hidden" })
  })

  it("asks for setup when the contributor is present but unconfigured", () => {
    expect(
      resolvePluginState(
        authsomePlugin,
        capabilities({
          name: "auth",
          configured: false,
          message: "Connect an API key to continue",
        })
      )
    ).toEqual({ kind: "setup", message: "Connect an API key to continue" })
  })

  it("declares no requires range, so the version check is skipped", () => {
    expect(authsomePlugin.requires).toBeUndefined()
  })

  // Paths are relative to the plugin's own "@auth" mount now (Task 7 of the
  // w8-scoped-sidebar plan), not absolute from the site root: the host
  // applies the "/@auth" prefix itself via scopePath, so a route declared
  // here as "/auth/login" would double-prefix to "/@auth/auth/login" and
  // never match.
  it("gives every route a nav entry pointing at it", () => {
    const paths = authsomePlugin.routes.map((r) => r.path).sort()
    const targets = authsomePlugin.nav.map((n) => n.to).sort()
    expect(paths).toEqual(["/login", "/sessions", "/users"])
    expect(targets).toEqual(paths)
  })

  it("mounts each route's element, and each one reads its own intent", async () => {
    const queries = {
      "auth.config": { passwordEnabled: true, brand: "Forge Fixture" },
      "users.list": {
        users: [
          {
            id: "usr_1",
            email: "ada@example.com",
            emailVerified: true,
            firstName: "Ada",
            lastName: "Lovelace",
            username: "ada",
            banned: false,
            createdAt: "2026-09-06T09:00:00.000Z",
          },
        ],
        total: 1,
      },
      "sessions.list": {
        sessions: [
          {
            id: "ses_1",
            userId: "usr_1",
            ipAddress: "127.0.0.1",
            userAgent: "curl/8.4.0",
            lastActivityAt: "2026-09-06T09:00:00.000Z",
            expiresAt: "2026-09-07T09:00:00.000Z",
            createdAt: "2026-09-06T09:00:00.000Z",
          },
        ],
      },
    }

    const expected: Record<string, string> = {
      "/login": "Forge Fixture",
      "/users": "ada@example.com",
      "/sessions": "ses_1",
    }

    for (const route of authsomePlugin.routes) {
      const { client } = stubClient(queries)
      const { unmount } = renderPage(route.element, client)
      expect(await screen.findByText(expected[route.path])).toBeDefined()
      unmount()
    }
  })
})
