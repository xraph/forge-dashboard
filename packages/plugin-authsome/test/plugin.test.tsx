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

  // Sign-in is no longer a route: the host renders the gate in its place
  // before any route table exists, so `/login` has nothing to mean here.
  it("declares the gate rather than a sign-in page", () => {
    expect(authsomePlugin.auth?.gate).toBeDefined()
    expect(authsomePlugin.nav.map((item) => item.to)).not.toContain("/login")
    expect(authsomePlugin.routes.map((route) => route.path)).not.toContain("/login")
  })

  it("mounts each route's element, and each one reads its own intent", async () => {
    // One fixture per intent, shared across every route below. A route with
    // a `:param` in its path is rendered with no params at all - the same
    // way the host renders a stale link - so it must hit its own missing-
    // param branch and say something useful rather than go blank or throw.
    const queries = {
      "overview.stats": { users: 3, sessions: 5, devices: 2, plugins: 4 },
      "overview.recentSignups": {
        users: [
          {
            id: "usr_1",
            email: "ada@example.com",
            emailVerified: true,
            firstName: "Ada",
            lastName: "Lovelace",
            banned: false,
            createdAt: "2026-09-06T09:00:00.000Z",
          },
        ],
      },
      "apps.list": {
        apps: [
          { id: "app_1", name: "Acme", slug: "acme", isPlatform: false, createdAt: "2026-09-06T09:00:00.000Z" },
        ],
      },
      "credentials.detail": {
        appId: "app_1",
        appName: "Acme",
        appSlug: "acme",
        isPlatform: false,
      },
      "devices.list": {
        devices: [
          {
            id: "dev_1",
            userId: "usr_1",
            name: "iPhone",
            trusted: false,
            lastSeenAt: "2026-09-06T09:00:00.000Z",
            createdAt: "2026-09-06T09:00:00.000Z",
          },
        ],
      },
      "environments.list": {
        environments: [
          {
            id: "env_1",
            name: "Production",
            slug: "prod",
            type: "prod",
            isDefault: true,
            createdAt: "2026-09-06T09:00:00.000Z",
          },
        ],
      },
      "auth.featureToggles": {
        toggles: [{ key: "mfa", label: "MFA", enabled: true, available: true }],
      },
      "roles.list": {
        roles: [{ id: "role_1", name: "Admin", slug: "admin", createdAt: "2026-09-06T09:00:00.000Z" }],
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
      "settings.namespaces": {
        namespaces: [{ name: "general", displayName: "General", settingCount: 3 }],
      },
      "formConfigs.list": {
        formConfigs: [{ id: "f1", formType: "signup", version: 1, active: true, createdAt: "2026-09-06T09:00:00.000Z" }],
      },
      "formConfigs.signup": {
        appId: "app_1",
        fields: [{ key: "email", label: "Email", type: "text", order: 1 }],
        updatedAt: "2026-09-06T09:00:00.000Z",
      },
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
      "webhooks.list": {
        webhooks: [
          {
            id: "w1",
            url: "https://example.com/hook",
            events: ["user.created"],
            active: true,
            createdAt: "2026-09-06T09:00:00.000Z",
          },
        ],
      },
    }

    const expected: Record<string, string> = {
      "/": "ada@example.com",
      "/apps": "Acme",
      "/apps/create": "New app",
      "/apps/:id": "No app selected.",
      "/credentials": "Acme",
      "/devices": "iPhone",
      "/devices/:id": "No device selected.",
      "/environments": "Production",
      "/environments/:id": "No environment selected.",
      "/features": "MFA",
      "/plugins": "MFA",
      "/roles": "Admin",
      "/roles/:id": "No role selected.",
      "/sessions": "ses_1",
      "/sessions/:id": "No session selected.",
      "/settings": "General",
      "/settings/:namespace": "No namespace selected.",
      "/signup-forms": "signup",
      "/signup-forms/edit": "Edit signup form",
      "/users": "ada@example.com",
      "/users/create": "New user",
      "/users/:id": "No user selected.",
      "/webhooks": "https://example.com/hook",
    }

    for (const route of authsomePlugin.routes) {
      const { client } = stubClient(queries)
      const { unmount } = renderPage(route.element, client)
      expect(
        await screen.findByText(expected[route.path]),
        `route "${route.path}" did not render the expected text`,
      ).toBeDefined()
      unmount()
    }
  })
})

const plugin = authsomePlugin

describe("icons", () => {
  // The sidebar's rows are icon-and-label. A plugin that declares no icons
  // renders as a bare list of words, which is the state the design brief
  // called out: the kit has supported PluginNavItem.icon since W8 and nothing
  // populated it, so the support was invisible.
  it("declares an icon for the scope and for every nav item", () => {
    expect(plugin.icon).toBeDefined()
    for (const item of plugin.nav) {
      expect(item.icon, `nav item "${item.label}" has no icon`).toBeDefined()
      for (const child of item.children ?? []) {
        expect(child.icon, `child "${child.label}" has no icon`).toBeDefined()
      }
    }
  })
})

describe("the finished plugin", () => {
  it("declares a route for every page", () => {
    const paths = authsomePlugin.routes.map((r) => r.path).sort()
    expect(paths).toEqual(
      [
        "/", "/apps", "/apps/create", "/apps/:id",
        "/credentials", "/devices", "/devices/:id",
        "/environments", "/environments/:id", "/features",
        "/plugins", "/roles", "/roles/:id",
        "/sessions", "/sessions/:id",
        "/settings", "/settings/:namespace",
        "/signup-forms", "/signup-forms/edit",
        "/users", "/users/create", "/users/:id", "/webhooks",
      ].sort(),
    )
  })

  it("groups its nav the way the Go manifests do", () => {
    const groups = [...new Set(authsomePlugin.nav.map((n) => n.group))]
    expect(groups).toEqual(["Identity", "Configuration", "Security", "System"])
  })

  it("declares the app and environment dimensions with their own payload builders", () => {
    const ids = authsomePlugin.context.map((d) => d.id)
    expect(ids).toEqual(["app", "environment"])

    const app = authsomePlugin.context.find((d) => d.id === "app")!
    const env = authsomePlugin.context.find((d) => d.id === "environment")!
    // The contract has no shared field name. A hardcoded `id` would send
    // something the server ignores and the switch would silently do nothing.
    expect(app.payload("a1")).toEqual({ appId: "a1" })
    expect(env.payload("e1")).toEqual({ envId: "e1" })
    expect(app.query).toBe("apps.context")
    expect(env.query).toBe("apps.context")
  })

  it("does not contribute a nav entry for a detail route", () => {
    const navPaths = authsomePlugin.nav.map((n) => n.to)
    expect(navPaths.some((p) => p.includes(":"))).toBe(false)
  })

  it("still resolves against a capabilities document naming the auth contributor", () => {
    const state = resolvePluginState(authsomePlugin, {
      shellEnvelopes: ["v1"],
      contributors: [{ name: "auth", envelopes: ["v1"], configured: true }],
    })
    expect(state.kind).toBe("ready")
  })

  // Not asserted mechanically above: every route path is unique. A duplicate
  // path is two pages fighting over which one the host actually renders, and
  // `.sort()` on the full path list would hide a duplicate rather than catch
  // it, since a repeated entry still sorts into place next to itself.
  it("never declares the same route path twice", () => {
    const paths = authsomePlugin.routes.map((r) => r.path)
    expect(new Set(paths).size).toBe(paths.length)
  })

  // A nav entry pointing at a path with no route opens the host's fallback,
  // which looks exactly like a broken page rather than a missing one.
  it("gives every nav item a route that actually exists", () => {
    const routePaths = new Set(authsomePlugin.routes.map((r) => r.path))
    for (const item of authsomePlugin.nav) {
      expect(
        routePaths.has(item.to),
        `nav item "${item.label}" points at undeclared route "${item.to}"`,
      ).toBe(true)
    }
  })

  // Complements "does not contribute a nav entry for a detail route" above:
  // this checks the positive claim too, that every LIST route does carry a
  // nav entry, matching what the Go manifests declare a page is reached from.
  it("gives every list route a nav entry, and no detail, create or edit route one", () => {
    const navTargets = new Set(authsomePlugin.nav.map((n) => n.to))
    const listRoutes = [
      "/", "/apps", "/credentials", "/devices", "/environments", "/features",
      "/plugins", "/roles", "/sessions", "/settings", "/signup-forms", "/users", "/webhooks",
    ]
    const detailCreateOrEditRoutes = [
      "/apps/create", "/apps/:id", "/devices/:id", "/environments/:id",
      "/roles/:id", "/sessions/:id", "/settings/:namespace",
      "/signup-forms/edit", "/users/create", "/users/:id",
    ]
    for (const path of listRoutes) {
      expect(navTargets.has(path), `list route "${path}" has no nav entry`).toBe(true)
    }
    for (const path of detailCreateOrEditRoutes) {
      expect(
        navTargets.has(path),
        `route "${path}" should not have a nav entry`,
      ).toBe(false)
    }
  })

  it("orders each nav group's items by priority", () => {
    const byGroup = new Map<string, number[]>()
    for (const item of authsomePlugin.nav) {
      const key = item.group ?? ""
      const priorities = byGroup.get(key) ?? []
      priorities.push(item.priority ?? 0)
      byGroup.set(key, priorities)
    }
    for (const [group, priorities] of byGroup) {
      const sorted = [...priorities].sort((a, b) => a - b)
      expect(priorities, `nav group "${group}" is not ordered by priority`).toEqual(sorted)
    }
  })
})
