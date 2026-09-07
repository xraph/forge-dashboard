import { definePlugin } from "@forge-go/dashboard-plugin"
import { StreamingConnectionsPage } from "./pages/connections"
import { StreamingOverviewPage } from "./pages/overview"
import { StreamingRoomsPage } from "./pages/rooms"

export type { StreamingStats } from "./pages/overview"
export type { RoomInfo, RoomsList } from "./pages/rooms"
export type { ConnectionInfo, ConnectionsList } from "./pages/connections"
export { StreamingConnectionsPage, StreamingOverviewPage, StreamingRoomsPage }

/**
 * The first-party UI for the `streaming` extension.
 *
 * `extension` is "streaming-contract", not "streaming". It is the Go
 * contributor name from `extensions/streaming/contract/manifest.yaml`, and it
 * is the join key the host looks up in the capabilities response. Name it
 * "streaming" and `resolvePluginState` reports `hidden`: no routes are
 * mounted, no nav appears, and nothing is logged, because a contributor the
 * server never mentioned is a normal thing for a shell to encounter. The
 * dashboard just quietly has one fewer page than you wrote.
 *
 * No `requires` range. The extension does not report a version yet, and
 * `resolvePluginState` skips the range check entirely when the contributor
 * answers no version, so a range here would be a claim nothing ever verifies:
 * it would read as a guarantee and enforce nothing.
 *
 * Read-only, deliberately. The contract declares five commands
 * (`rooms.create`, `rooms.delete`, `rooms.send-message`, `presence.set`,
 * `connections.kick`) and this plugin implements none of them: the command
 * path, with its CSRF and idempotency handshake, is exercised once by the auth
 * plugin rather than twice across the wave.
 */
export const streamingPlugin = definePlugin({
  extension: "streaming-contract",
  nav: [
    { label: "Streaming", to: "/streaming", priority: 10 },
    { label: "Rooms", to: "/streaming/rooms", priority: 20 },
    { label: "Connections", to: "/streaming/connections", priority: 30 },
  ],
  routes: [
    { path: "/streaming", element: StreamingOverviewPage },
    { path: "/streaming/rooms", element: StreamingRoomsPage },
    { path: "/streaming/connections", element: StreamingConnectionsPage },
  ],
})

export default streamingPlugin
