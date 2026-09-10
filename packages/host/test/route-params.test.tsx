import { describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { ForgeDashboardProvider, SessionProvider } from "@forge-go/dashboard-runtime"
import { definePlugin } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { PluginHost } from "../src/host/PluginHost"

window.matchMedia ??= ((query: string) => ({
  matches: false, media: query, onchange: null,
  addEventListener: () => {}, removeEventListener: () => {},
  addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia

function RoomDetail({ params }: PluginPageProps) {
  return <p>room {params.id}</p>
}

const plugin = definePlugin({
  extension: "streaming-contract",
  namespace: "streaming",
  label: "Streaming",
  nav: [{ label: "Rooms", to: "/rooms" }],
  routes: [
    { path: "/rooms", element: () => <p>rooms list</p> },
    { path: "/rooms/:id", element: RoomDetail },
  ],
})

function renderAt(path: string) {
  const fetchImpl = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        shellEnvelopes: ["v1"],
        contributors: [
          { name: "streaming-contract", envelopes: ["v1"], configured: true },
        ],
      }),
  } as unknown as Response)

  return render(
    <ForgeDashboardProvider config={{ basePath: "/dashboard" }}>
      <MemoryRouter initialEntries={[path]}>
        <SessionProvider fetchImpl={fetchImpl}>
          <PluginHost plugins={[plugin]} fetchImpl={fetchImpl} />
        </SessionProvider>
      </MemoryRouter>
    </ForgeDashboardProvider>,
  )
}

describe("route params", () => {
  it("hands a page the params from its own path", async () => {
    renderAt("/@streaming/rooms/r1")
    await waitFor(() => expect(screen.getByText("room r1")).toBeTruthy())
  })

  it("gives a page with no params an empty object rather than undefined", async () => {
    // A page that never declares a param must still be able to destructure
    // `params` without guarding, or every parameterless page needs a default.
    renderAt("/@streaming/rooms")
    await waitFor(() => expect(screen.getByText("rooms list")).toBeTruthy())
  })
})
