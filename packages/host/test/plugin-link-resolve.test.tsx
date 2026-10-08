import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import {
  ForgeDashboardProvider,
  SessionProvider,
} from "@forge-go/dashboard-runtime"
import {
  PluginLink,
  definePlugin,
  queryStore,
} from "@forge-go/dashboard-plugin"
import type {
  ContextDimension,
  PluginPageProps,
} from "@forge-go/dashboard-plugin"
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

/**
 * `PluginLink`'s target for the two tests below: a list page linking to one
 * detail row, and the detail page reading the id off its route params. Every
 * detail page any plugin ships is this shape, which is exactly what
 * `navigation.resolve` has to turn a scope-relative link into a real one for.
 */
function RoomsList() {
  return <PluginLink to="/rooms/r1">Open r1</PluginLink>
}
function RoomDetail({ params }: PluginPageProps) {
  return <p>room detail {params.id}</p>
}

describe("PluginLink resolution for a plugin with no routed dimension", () => {
  it("does not double the route segment -- the regression that left every Details link dead", async () => {
    // queryStore is module scope, so a cached read from another test's
    // "streaming" client would otherwise answer this render before the
    // fetch stub below ever runs.
    queryStore.clear()

    const plugin = definePlugin({
      extension: "streaming",
      namespace: "streaming",
      label: "Streaming",
      nav: [{ label: "Rooms", to: "/rooms" }],
      routes: [
        { path: "/rooms", element: RoomsList },
        { path: "/rooms/:id", element: RoomDetail },
      ],
    })

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
            <PluginHost plugins={[plugin]} fetchImpl={fetchImpl} />
          </SessionProvider>
        </ForgeDashboardProvider>
      </MemoryRouter>
    )

    const link = await screen.findByRole("link", { name: "Open r1" })
    // "streaming" declares no routed path dimension, so segmentFromPath's
    // read of "rooms" (the first path component after "/@streaming") must
    // never reach mountPath. Before the fix this asserted
    // "/@streaming/rooms/rooms/r1", which matches no mounted route.
    expect(link.getAttribute("href")).toBe("/@streaming/rooms/r1")

    fireEvent.click(link)
    await waitFor(() => expect(screen.getByText("room detail r1")).toBeTruthy())
  })
})

describe("PluginLink resolution for a plugin with a path-routed dimension", () => {
  it("still inserts the segment -- the half that must not regress", async () => {
    queryStore.clear()

    const appDimension: ContextDimension = {
      id: "app",
      label: "App",
      query: "apps.context",
      switchCommand: "apps.switch",
      select: (data) => {
        const d = data as {
          currentApp?: { id: string; name: string; slug: string }
          availableApps: { id: string; name: string; slug: string }[]
        }
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
      routed: {
        placement: "path",
        param: "app",
        by: "slug",
        picker: () => <p>choose an app</p>,
      },
    }

    function UsersList() {
      return <PluginLink to="/users/u1">Open u1</PluginLink>
    }
    function UserDetail({ params }: PluginPageProps) {
      return <p>user detail {params.id}</p>
    }

    const plugin = definePlugin({
      extension: "auth",
      namespace: "auth",
      label: "Auth",
      nav: [{ label: "Users", to: "/users" }],
      routes: [
        { path: "/users", element: UsersList },
        { path: "/users/:id", element: UserDetail },
      ],
      context: [appDimension],
    })

    const fetchImpl = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
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
              { name: "auth", envelopes: ["v1"], configured: true },
            ],
          })
        }
        if (url.endsWith("/csrf")) return jsonOk({ token: "t" })

        const body = JSON.parse(String(init?.body ?? "{}")) as {
          intent?: string
        }
        if (body.intent === "apps.context") {
          // The server already agrees with the URL's "platform" segment, so
          // RoutedScope resolves without a redirect or a switch -- this test
          // is about `resolve`'s segment, not about reconciliation.
          return jsonOk({
            ok: true,
            data: {
              currentApp: {
                id: "app_platform",
                name: "Platform",
                slug: "platform",
              },
              availableApps: [
                { id: "app_platform", name: "Platform", slug: "platform" },
              ],
            },
          })
        }
        throw new Error(`unexpected intent "${body.intent}"`)
      }
    ) as unknown as typeof fetch

    render(
      <MemoryRouter initialEntries={["/@auth/platform/users"]}>
        <ForgeDashboardProvider config={config}>
          <SessionProvider fetchImpl={fetchImpl}>
            <PluginHost plugins={[plugin]} fetchImpl={fetchImpl} />
          </SessionProvider>
        </ForgeDashboardProvider>
      </MemoryRouter>
    )

    const link = await screen.findByRole("link", { name: "Open u1" })
    // "auth" DOES declare a routed path dimension, so the segment read off
    // the URL ("platform") is exactly what the page meant when it wrote
    // "/users/u1": the fix must not strip this out along with the streaming
    // case above, or it breaks authsome instead of fixing warden.
    expect(link.getAttribute("href")).toBe("/@auth/platform/users/u1")

    fireEvent.click(link)
    await waitFor(() => expect(screen.getByText("user detail u1")).toBeTruthy())
  })
})
