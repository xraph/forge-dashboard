import { describe, expect, it, vi } from "vitest"
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import { MemoryRouter } from "react-router"
import {
  ForgeDashboardProvider,
  SessionProvider,
} from "@forge-go/dashboard-runtime"
import {
  PluginProvider,
  createScopedClient,
  definePlugin,
  queryStore,
} from "@forge-go/dashboard-plugin"
import type { ContextDimension } from "@forge-go/dashboard-plugin"
import { PluginHost } from "../src/host/PluginHost"
import { ContextControl } from "../src/host/ContextControl"

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
    {
      id: "env_platform_prod",
      name: "Production",
      slug: "production",
      appId: "app_platform",
    },
    {
      id: "env_demo_prod",
      name: "Production",
      slug: "production",
      appId: "app_demo",
    },
    // "staging" belongs to demo-app only. That asymmetry is deliberate: it
    // is what lets a test prove "?env=staging" is refused for platform
    // rather than silently accepted because the slug happens to exist
    // somewhere.
    {
      id: "env_demo_staging",
      name: "Staging",
      slug: "staging",
      appId: "app_demo",
    },
  ]

  let contextFails = false
  let ignoreSwitch = false
  let currentAppId: string | undefined
  let currentEnvId: string | undefined
  const commandOrder: string[] = []

  function contextData() {
    const currentApp = apps.find((a) => a.id === currentAppId)
    const availableEnvs = currentAppId
      ? envs.filter((e) => e.appId === currentAppId)
      : []
    const currentEnv = availableEnvs.find((e) => e.id === currentEnvId)
    return {
      currentApp: currentApp
        ? { id: currentApp.id, name: currentApp.name, slug: currentApp.slug }
        : undefined,
      availableApps: apps.map((a) => ({
        id: a.id,
        name: a.name,
        slug: a.slug,
      })),
      currentEnv: currentEnv
        ? { id: currentEnv.id, name: currentEnv.name, slug: currentEnv.slug }
        : undefined,
      availableEnvs: availableEnvs.map((e) => ({
        id: e.id,
        name: e.name,
        slug: e.slug,
      })),
    }
  }

  const fetchImpl = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith("/principal")) {
        return jsonOk({
          authenticated: true,
          subject: "usr_test",
          email: "test@example.com",
        })
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
        if (contextFails) {
          return jsonOk({
            ok: false,
            envelope: "v1",
            error: { code: "INTERNAL", message: "context unavailable" },
          })
        }
        return jsonOk({ ok: true, data: contextData() })
      }
      if (body.intent === "apps.switch") {
        commandOrder.push("apps.switch")
        if (ignoreSwitch) {
          // Accepted, and nothing changes. Authsome writes a cookie here that
          // nothing reads back, so the next apps.context answers exactly as it
          // did before.
          return jsonOk({ ok: true, data: { ok: true } })
        }
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
          return jsonError(
            400,
            "BAD_REQUEST",
            "environment does not belong to the current app"
          )
        }
        currentEnvId = envId
        return jsonOk({ ok: true, data: { ok: true } })
      }

      throw new Error(`fixtureServer: unexpected intent "${body.intent}"`)
    }
  ) as unknown as typeof fetch

  return {
    fetchImpl,
    commandOrder,
    setCurrentApp: (id: string | undefined) => {
      currentAppId = id
    },
    /** Accept apps.switch and change nothing, the way authsome does today. */
    ignoreAppSwitch: () => {
      ignoreSwitch = true
    },
    /** Make apps.context fail, the way a server that never registered it does. */
    failContext: () => {
      contextFails = true
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
        ? {
            id: d.currentApp.id,
            label: d.currentApp.name,
            slug: d.currentApp.slug,
          }
        : undefined,
      options: d.availableApps.map((a) => ({
        id: a.id,
        label: a.name,
        slug: a.slug,
      })),
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
        ? {
            id: d.currentEnv.id,
            label: d.currentEnv.name,
            slug: d.currentEnv.slug,
          }
        : undefined,
      options: (d.availableEnvs ?? []).map((e) => ({
        id: e.id,
        label: e.name,
        slug: e.slug,
      })),
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
    extension: "streaming",
    namespace: "streaming",
    label: "Streaming",
    nav: [{ label: "Rooms", to: "/rooms" }],
    routes: [{ path: "/rooms", element: () => <p>rooms list</p> }],
  })
}

function renderAt(
  plugin: ReturnType<typeof routedAuthPlugin>,
  fetchImpl: typeof fetch,
  path: string
) {
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
        return jsonOk({
          authenticated: true,
          subject: "usr_test",
          email: "t@example.com",
        })
      }
      if (url.endsWith("/capabilities")) {
        return jsonOk({
          shellEnvelopes: ["v1"],
          contributors: [
            { name: "streaming", envelopes: ["v1"], configured: true },
          ],
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
    expect(
      screen.getByRole("link", { name: "Rooms" }).getAttribute("href")
    ).toBe("/@streaming/rooms")
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
    expect(
      screen.getByRole("link", { name: "Overview" }).getAttribute("href")
    ).toBe("/@auth/demo-app/overview")
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
    // The picker is the page. The pane's "Pick an app" notice only shows in the
    // mobile sheet; on desktop there is no secondary sidebar to carry it.
    const main = document.getElementById("dashboard-main") as HTMLElement
    expect(within(main).getByText("choose an app")).toBeTruthy()
    expect(screen.queryByText("Pick an app to see its pages.")).toBeNull()
  })

  it("shows a rail with no entries when the URL names no app", async () => {
    queryStore.clear()
    const server = fixtureServer()

    renderAt(routedAuthPlugin(), server.fetchImpl, "/@auth")

    await waitFor(() => expect(screen.getByText("choose an app")).toBeTruthy())
    const rail = screen.getByRole("navigation", { name: "Scope navigation" })
    expect(within(rail).queryAllByRole("link")).toHaveLength(0)
    const main = document.getElementById("dashboard-main") as HTMLElement
    expect(within(main).getByText("choose an app")).toBeTruthy()
  })

  it("mounts the scope's pages under the URL's segment, marks the current one, and shows the context control", async () => {
    queryStore.clear()
    const server = fixtureServer()
    server.setCurrentApp("app_platform")

    renderAt(routedAuthPlugin(), server.fetchImpl, "/@auth/platform/users")

    await waitFor(() => expect(screen.getByText("users page")).toBeTruthy())
    const rail = screen.getByRole("navigation", { name: "Scope navigation" })
    const users = within(rail).getByRole("link", { name: "Users" })
    expect(users.getAttribute("href")).toBe("/@auth/platform/users")
    expect(users.getAttribute("aria-current")).toBe("page")
    const overview = within(rail).getByRole("link", { name: "Overview" })
    expect(overview.getAttribute("href")).toBe("/@auth/platform/overview")
    expect(overview.getAttribute("aria-current")).toBeNull()
    expect(
      await within(rail).findByRole("button", { name: /^Platform \/ / })
    ).toBeTruthy()
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
    await waitFor(() =>
      expect(queryStore.snapshot(staleKey).data).toBeUndefined()
    )

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

    renderAt(
      routedAuthPlugin(),
      server.fetchImpl,
      "/@auth/demo-app/users?env=staging"
    )

    await waitFor(() => expect(screen.getByText("users page")).toBeTruthy())
    expect(
      screen.getByRole("link", { name: "Overview" }).getAttribute("href")
    ).toBe("/@auth/demo-app/overview?env=staging")
  })

  it("shows an error rather than silently switching when the value names another app's environment", async () => {
    queryStore.clear()
    const server = fixtureServer()
    server.setCurrentApp("app_platform")
    server.setCurrentEnv("env_platform_prod")

    // "staging" exists, but only for demo-app, not for the current app
    // (platform). The server would reject environments.switch for it (400),
    // so this must not be sent at all -- it has to be surfaced as an error.
    renderAt(
      routedAuthPlugin(),
      server.fetchImpl,
      "/@auth/platform/users?env=staging"
    )

    await waitFor(() =>
      expect(screen.getByText(/Unknown environment/i)).toBeTruthy()
    )
    expect(server.commandOrder).not.toContain("environments.switch")
  })

  it("survives an app switch when the new app has it, and reaches the server", async () => {
    queryStore.clear()
    const server = fixtureServer()
    server.setCurrentApp("app_platform")
    server.setCurrentEnv("env_platform_prod")

    // Switching app AND naming an environment in one URL. The server clears
    // the environment cookie as a side effect of the app switch, so this used
    // to strip the query param on the grounds that it named something the
    // server had just forgotten.
    //
    // That was wrong. The gate sends it straight back, so the server ends up
    // holding exactly what the URL asked for, and stripping it only robbed
    // the address of it: the page was right and the link you could copy out
    // of the bar was not.
    const view = renderAt(
      routedAuthPlugin(),
      server.fetchImpl,
      "/@auth/demo-app/users?env=production"
    )

    await waitFor(() => expect(screen.getByText("users page")).toBeTruthy())
    await waitFor(() =>
      expect(
        view.getByRole("link", { name: "Overview" }).getAttribute("href")
      ).toBe("/@auth/demo-app/overview?env=production")
    )
    // Not merely left in the address: actually applied. The app switch runs
    // first, then the environment, which is the order the server requires.
    await waitFor(() =>
      expect(server.commandOrder).toContain("environments.switch")
    )
    expect(server.commandOrder.indexOf("apps.switch")).toBeLessThan(
      server.commandOrder.indexOf("environments.switch")
    )
  })
})

describe("when the dimension's own query cannot be read", () => {
  /**
   * The regression this pair exists for. `!read.data` was treated as "still
   * loading", so a query that had FAILED produced a spinner that never
   * resolved: the whole scope became a permanent Loading row with an empty
   * sidebar, which looks exactly like the plugin never having loaded.
   *
   * It matters because a server can plausibly not answer this at all. The
   * intent is recent, and a deployment whose dashboard extension predates it,
   * or a principal without permission, gets an error rather than data.
   */
  it("shows the page with a warning rather than spinning forever", async () => {
    queryStore.clear()
    const server = fixtureServer()
    server.failContext()

    renderAt(routedAuthPlugin(), server.fetchImpl, "/@auth/platform/users")

    // The page is still there. A dashboard that works unscoped beats one that
    // shows nothing at all, and every handler falls back to the server's own
    // default app anyway.
    await waitFor(() => expect(screen.getByText("users page")).toBeTruthy())
    expect(screen.getByText(/cannot read the current app/i)).toBeTruthy()
    expect(screen.queryByText("Loading…")).toBeNull()
  })

  it("says so at the namespace root instead of a spinner", async () => {
    queryStore.clear()
    const server = fixtureServer()
    server.failContext()

    renderAt(routedAuthPlugin(), server.fetchImpl, "/@auth")

    await waitFor(() =>
      expect(screen.getByText(/cannot read the current app/i)).toBeTruthy()
    )
    expect(screen.queryByText("Loading…")).toBeNull()
  })
})

describe("a server that accepts a switch and ignores it", () => {
  /**
   * Authsome's real behaviour, and the reason this test exists.
   *
   * `apps.switch` writes an `authsome_app` cookie that nothing reads back.
   * `AppIDFromPrincipal` resolves from `Principal.Claims`, and nothing on the
   * dashboard path populates claims, so `apps.context` answers with the
   * default app whatever was switched to. The command succeeds. The re-read
   * says the same thing it said before. The URL and the server then disagree
   * permanently, and every page answers for an app the address does not name.
   *
   * The fixture server used by every other test in this file holds its own
   * state, so it switches correctly and hides this completely. That is how
   * the behaviour reached a browser and passed.
   */
  it("says so rather than showing the default app under the URL's name", async () => {
    queryStore.clear()
    const server = fixtureServer()
    server.setCurrentApp("app_platform")
    // Accept the command, change nothing. No cookie is read on the way back.
    server.ignoreAppSwitch()

    renderAt(routedAuthPlugin(), server.fetchImpl, "/@auth/demo-app/users")

    await waitFor(() => expect(screen.getByText(/did not take/i)).toBeTruthy())
    // The page still renders. The operator is looking at platform's data and
    // now knows it, which is the whole difference.
    expect(screen.getByText("users page")).toBeTruthy()
    expect(screen.getByText(/still reports Platform/i)).toBeTruthy()
  })

  it("stays quiet when the server does accept it", async () => {
    queryStore.clear()
    const server = fixtureServer()
    server.setCurrentApp("app_platform")

    renderAt(routedAuthPlugin(), server.fetchImpl, "/@auth/demo-app/users")

    await waitFor(() => expect(screen.getByText("users page")).toBeTruthy())
    expect(screen.queryByText(/did not take/i)).toBeNull()
  })
})

describe("ContextControl", () => {
  function renderControl(
    fetchImpl: typeof fetch,
    dimensions = [appDimension, envDimension]
  ) {
    // The fixture answers the contract POST at any base and matches only the
    // "/csrf" suffix, so the base PluginHost would derive from this file's
    // config is used as is.
    const client = createScopedClient(
      "/dashboard/api/dashboard/v1",
      "auth",
      fetchImpl
    )
    return render(
      <MemoryRouter initialEntries={["/@auth/platform/users"]}>
        <PluginProvider client={client}>
          <ContextControl dimensions={dimensions} plugin={routedAuthPlugin()} />
        </PluginProvider>
      </MemoryRouter>
    )
  }

  it("names itself with every dimension's current value, joined", async () => {
    queryStore.clear()
    const server = fixtureServer()
    server.setCurrentApp("app_platform")
    renderControl(server.fetchImpl)
    expect(
      await screen.findByRole("button", { name: /^Platform \/ / })
    ).toBeTruthy()
  })

  it("opens a popover holding the App and Environment selects", async () => {
    queryStore.clear()
    const server = fixtureServer()
    server.setCurrentApp("app_platform")
    renderControl(server.fetchImpl)
    fireEvent.click(
      await screen.findByRole("button", { name: /^Platform \/ / })
    )
    expect(await screen.findByLabelText("App")).toBeTruthy()
    expect(screen.getByLabelText("Environment")).toBeTruthy()
  })

  it("renders nothing for a scope with no dimensions", () => {
    queryStore.clear()
    const server = fixtureServer()
    const { container } = renderControl(server.fetchImpl, [])
    expect(container.textContent).toBe("")
  })
})
