import { describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { ForgeDashboardProvider, SessionProvider } from "@forge-go/dashboard-runtime"
import { definePlugin, queryStore } from "@forge-go/dashboard-plugin"
import type { ContextDimension } from "@forge-go/dashboard-plugin"
import { PluginHost } from "../src/host/PluginHost"

window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia

const config = { basePath: "/dashboard" }

function jsonOk(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response
}

function jsonError(status: number, code: string, message: string): Response {
  return {
    ok: false,
    status,
    json: async () => ({ ok: false, error: { code, message } }),
  } as Response
}

interface AppRow {
  id: string
  name: string
  slug: string
}

interface EnvRow {
  id: string
  name: string
  slug: string
  appId: string
}

/**
 * A fixture server modelling exactly the two behaviours the real authsome
 * handlers have that a naive fake would miss: switching the app clears
 * whatever environment was selected (handlers_context.go clears the env
 * cookie right after setting the app cookie), and switching the environment
 * rejects one that does not belong to the current app.
 */
function fixtureServer() {
  const apps: AppRow[] = [
    { id: "app_platform", name: "Platform", slug: "platform" },
    { id: "app_demo", name: "Demo App", slug: "demo-app" },
    { id: "app_storefront", name: "Storefront", slug: "storefront" },
  ]
  const envs: EnvRow[] = [
    { id: "env_platform_prod", name: "Production", slug: "production", appId: "app_platform" },
    { id: "env_demo_prod", name: "Production", slug: "production", appId: "app_demo" },
    // "staging" belongs to demo-app only. That asymmetry is deliberate: it
    // is what lets a test prove "?env=staging" is refused for platform
    // rather than silently accepted because the slug happens to exist
    // somewhere.
    { id: "env_demo_staging", name: "Staging", slug: "staging", appId: "app_demo" },
  ]

  let currentAppId: string | undefined
  let currentEnvId: string | undefined
  const commandOrder: string[] = []

  function contextData() {
    const currentApp = apps.find((a) => a.id === currentAppId)
    const availableEnvs = currentAppId ? envs.filter((e) => e.appId === currentAppId) : []
    const currentEnv = availableEnvs.find((e) => e.id === currentEnvId)
    return {
      currentApp: currentApp
        ? { id: currentApp.id, name: currentApp.name, slug: currentApp.slug }
        : undefined,
      availableApps: apps.map((a) => ({ id: a.id, name: a.name, slug: a.slug })),
      currentEnv: currentEnv
        ? { id: currentEnv.id, name: currentEnv.name, slug: currentEnv.slug }
        : undefined,
      availableEnvs: availableEnvs.map((e) => ({ id: e.id, name: e.name, slug: e.slug })),
    }
  }

  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith("/principal")) {
      return jsonOk({ authenticated: true, subject: "usr_test", email: "test@example.com" })
    }
    if (url.endsWith("/capabilities")) {
      return jsonOk({
        shellEnvelopes: ["v1"],
        contributors: [{ name: "auth", envelopes: ["v1"], configured: true }],
      })
    }
    if (url.endsWith("/csrf")) {
      return jsonOk({ token: "t" })
    }

    const body = JSON.parse(String(init?.body ?? "{}")) as {
      intent?: string
      payload?: Record<string, unknown>
    }

    if (body.intent === "apps.context") {
      return jsonOk({ ok: true, data: contextData() })
    }
    if (body.intent === "apps.switch") {
      commandOrder.push("apps.switch")
      const appId = (body.payload as { appId?: string } | undefined)?.appId
      currentAppId = apps.some((a) => a.id === appId) ? appId : undefined
      // handlers_context.go: appsSwitchHandler clears the env cookie right
      // after setting the app cookie, because the new app has a different
      // environment list.
      currentEnvId = undefined
      return jsonOk({ ok: true, data: { ok: true } })
    }
    if (body.intent === "environments.switch") {
      commandOrder.push("environments.switch")
      const envId = (body.payload as { envId?: string } | undefined)?.envId
      const env = envs.find((e) => e.id === envId)
      if (!env || env.appId !== currentAppId) {
        return jsonError(400, "BAD_REQUEST", "environment does not belong to the current app")
      }
      currentEnvId = envId
      return jsonOk({ ok: true, data: { ok: true } })
    }

    throw new Error(`fixtureServer: unexpected intent "${body.intent}"`)
  }) as unknown as typeof fetch

  return {
    fetchImpl,
    commandOrder,
    setCurrentApp: (id: string | undefined) => {
      currentAppId = id
    },
    setCurrentEnv: (id: string | undefined) => {
      currentEnvId = id
    },
  }
}

const Picker = () => <p>choose an app</p>

const appDimension: ContextDimension = {
  id: "app",
  label: "App",
  query: "apps.context",
  switchCommand: "apps.switch",
  select: (data) => {
    const d = data as { currentApp?: AppRow; availableApps: AppRow[] }
    return {
      current: d.currentApp
        ? { id: d.currentApp.id, label: d.currentApp.name, slug: d.currentApp.slug }
        : undefined,
      options: d.availableApps.map((a) => ({ id: a.id, label: a.name, slug: a.slug })),
    }
  },
  payload: (appId) => ({ appId }),
  routed: { placement: "path", param: "app", by: "slug", picker: Picker },
}

const envDimension: ContextDimension = {
  id: "environment",
  label: "Environment",
  query: "apps.context",
  switchCommand: "environments.switch",
  select: (data) => {
    const d = data as { currentEnv?: EnvRow; availableEnvs: EnvRow[] }
    return {
      current: d.currentEnv
        ? { id: d.currentEnv.id, label: d.currentEnv.name, slug: d.currentEnv.slug }
        : undefined,
      options: (d.availableEnvs ?? []).map((e) => ({ id: e.id, label: e.name, slug: e.slug })),
    }
  },
  payload: (envId) => ({ envId }),
  routed: { placement: "query", param: "env", by: "slug" },
}

function routedAuthPlugin() {
  return definePlugin({
    extension: "auth",
    namespace: "auth",
    label: "Auth",
    nav: [
      { label: "Users", to: "/users" },
      { label: "Overview", to: "/overview" },
    ],
    routes: [
      { path: "/users", element: () => <p>users page</p> },
      { path: "/overview", element: () => <p>overview page</p> },
    ],
    context: [appDimension, envDimension],
  })
}

function plainPlugin() {
  return definePlugin({
    extension: "streaming-contract",
    namespace: "streaming",
    label: "Streaming",
    nav: [{ label: "Rooms", to: "/rooms" }],
    routes: [{ path: "/rooms", element: () => <p>rooms list</p> }],
  })
}

function renderAt(plugin: ReturnType<typeof routedAuthPlugin>, fetchImpl: typeof fetch, path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ForgeDashboardProvider config={config}>
        <SessionProvider fetchImpl={fetchImpl}>
          <PluginHost plugins={[plugin]} fetchImpl={fetchImpl} />
        </SessionProvider>
      </ForgeDashboardProvider>
    </MemoryRouter>
  )
}

describe("a plugin with no routed dimension", () => {
  it("mounts exactly where it did before -- the regression that would break core and streaming", async () => {
    queryStore.clear()
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith("/principal")) {
        return jsonOk({ authenticated: true, subject: "usr_test", email: "t@example.com" })
      }
      if (url.endsWith("/capabilities")) {
        return jsonOk({
          shellEnvelopes: ["v1"],
          contributors: [{ name: "streaming-contract", envelopes: ["v1"], configured: true }],
        })
      }
      throw new Error(`unexpected request to ${url}`)
    }) as unknown as typeof fetch

    render(
      <MemoryRouter initialEntries={["/@streaming/rooms"]}>
        <ForgeDashboardProvider config={config}>
          <SessionProvider fetchImpl={fetchImpl}>
            <PluginHost plugins={[plainPlugin()]} fetchImpl={fetchImpl} />
          </SessionProvider>
        </ForgeDashboardProvider>
      </MemoryRouter>
    )

    await waitFor(() => expect(screen.getByText("rooms list")).toBeTruthy())
    expect(screen.getByRole("link", { name: "Rooms" }).getAttribute("href")).toBe("/@streaming/rooms")
  })
})

describe("a plugin with a path-routed dimension", () => {
  it("mounts pages under the URL's segment and carries it into nav hrefs", async () => {
    // queryStore is module scope by design (see its own docs), so a cached
    // "auth" apps.context entry from a previous test would otherwise answer
    // this test's first render before its own fetch stub ever runs.
    queryStore.clear()
    const server = fixtureServer()
    server.setCurrentApp("app_demo")

    renderAt(routedAuthPlugin(), server.fetchImpl, "/@auth/demo-app/users")

    await waitFor(() => expect(screen.getByText("users page")).toBeTruthy())
    expect(screen.getByRole("link", { name: "Overview" }).getAttribute("href")).toBe(
      "/@auth/demo-app/overview"
    )
    // Already agreeing with the server: no switch should have been sent.
    expect(server.commandOrder).toEqual([])
  })

  it("renders the picker and no nav items when the URL names no app at all", async () => {
    queryStore.clear()
    const server = fixtureServer()
    // No current app on the server either, so RoutedPicker has nothing to
    // redirect to and falls through to the dimension's own picker.

    renderAt(routedAuthPlugin(), server.fetchImpl, "/@auth")

    await waitFor(() => expect(screen.getByText("choose an app")).toBeTruthy())
    expect(screen.queryByRole("link", { name: "Users" })).toBeNull()
    expect(screen.queryByRole("link", { name: "Overview" })).toBeNull()
  })

  it("redirects a bare namespace root to the server's known current app", async () => {
    queryStore.clear()
    const server = fixtureServer()
    server.setCurrentApp("app_platform")

    renderAt(routedAuthPlugin(), server.fetchImpl, "/@auth")

    // Lands on the app's own first nav item, not the bare segment root --
    // nothing is mounted at "/@auth/platform" alone.
    await waitFor(() => expect(screen.getByText("users page")).toBeTruthy())
  })

  it("shows an unknown-app error instead of another app's page for a slug the server never named", async () => {
    queryStore.clear()
    const server = fixtureServer()
    // A real, different app is current -- proving this is not a "no current
    // app" fallback but an actual refusal to guess.
    server.setCurrentApp("app_platform")

    renderAt(routedAuthPlugin(), server.fetchImpl, "/@auth/bogus-app/users")

    await waitFor(() => expect(screen.getByText(/Unknown app/i)).toBeTruthy())
    expect(screen.queryByText("users page")).toBeNull()
    // Still offers a way out.
    expect(screen.getByText("choose an app")).toBeTruthy()
  })

  it("sends the switch command and only then clears the store, in that order", async () => {
    queryStore.clear()
    const server = fixtureServer()
    server.setCurrentApp("app_platform")

    // Seed a cache entry under the "auth" extension so a clear is
    // observable.
    const staleKey = queryStore.keyOf("auth", "users.list")
    queryStore.read(staleKey, () => Promise.resolve({ total: 9 }), 60_000)
    await waitFor(() => expect(queryStore.snapshot(staleKey).data).toBeTruthy())

    // The command lands in server.commandOrder from inside the fetch stub;
    // the clear spy appends to the SAME array, bound back to the real
    // implementation so the store still actually clears. One array means
    // one true relative order to assert on, rather than reconciling two.
    const originalClear = queryStore.clear.bind(queryStore)
    const clearSpy = vi.spyOn(queryStore, "clear").mockImplementation(() => {
      server.commandOrder.push("clear")
      originalClear()
    })

    renderAt(routedAuthPlugin(), server.fetchImpl, "/@auth/demo-app/users")

    await waitFor(() => expect(clearSpy).toHaveBeenCalled())
    await waitFor(() => expect(queryStore.snapshot(staleKey).data).toBeUndefined())

    expect(server.commandOrder).toEqual(["apps.switch", "clear"])
    clearSpy.mockRestore()
  })
})

describe("the ?env query dimension", () => {
  it("survives a navigation to another page in the same app", async () => {
    queryStore.clear()
    const server = fixtureServer()
    server.setCurrentApp("app_demo")
    server.setCurrentEnv("env_demo_staging")

    renderAt(routedAuthPlugin(), server.fetchImpl, "/@auth/demo-app/users?env=staging")

    await waitFor(() => expect(screen.getByText("users page")).toBeTruthy())
    expect(screen.getByRole("link", { name: "Overview" }).getAttribute("href")).toBe(
      "/@auth/demo-app/overview?env=staging"
    )
  })

  it("shows an error rather than silently switching when the value names another app's environment", async () => {
    queryStore.clear()
    const server = fixtureServer()
    server.setCurrentApp("app_platform")
    server.setCurrentEnv("env_platform_prod")

    // "staging" exists, but only for demo-app, not for the current app
    // (platform). The server would reject environments.switch for it (400),
    // so this must not be sent at all -- it has to be surfaced as an error.
    renderAt(routedAuthPlugin(), server.fetchImpl, "/@auth/platform/users?env=staging")

    await waitFor(() => expect(screen.getByText(/Unknown environment/i)).toBeTruthy())
    expect(server.commandOrder).not.toContain("environments.switch")
  })

  it("is dropped from the URL when switching apps, because the server clears it too", async () => {
    queryStore.clear()
    const server = fixtureServer()
    server.setCurrentApp("app_platform")
    server.setCurrentEnv("env_platform_prod")

    // "production" exists for both apps, so if the stale query value were
    // left in place it would look valid for demo-app too and this test
    // would not catch the bug it exists to catch.
    const view = renderAt(
      routedAuthPlugin(),
      server.fetchImpl,
      "/@auth/demo-app/users?env=production"
    )

    await waitFor(() => expect(screen.getByText("users page")).toBeTruthy())
    await waitFor(() =>
      expect(view.getByRole("link", { name: "Overview" }).getAttribute("href")).toBe(
        "/@auth/demo-app/overview"
      )
    )
  })
})
