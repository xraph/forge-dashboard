import { definePlugin } from "@forge-go/dashboard-plugin"
import {
  AudioWaveformIcon,
  HouseIcon,
  LayoutGridIcon,
  LinkIcon,
  RadioIcon,
  SettingsIcon,
  UsersIcon,
} from "@forge-go/dashboard-kit/icons"
import { StreamingChannelsPage } from "./pages/channels"
import { StreamingConfigPage } from "./pages/config"
import { StreamingConnectionsPage } from "./pages/connections"
import { StreamingOverviewPage } from "./pages/overview"
import { StreamingPresencePage } from "./pages/presence"
import { StreamingRoomDetailPage } from "./pages/room-detail"
import { StreamingRoomsPage } from "./pages/rooms"

export type { StreamingStats, PresenceInfo, PresenceList } from "./pages/overview"
export type { RoomInfo, RoomsList, CommandResult } from "./pages/rooms"
export type {
  MemberInfo,
  MembersList,
  ModerationEntry,
  ModerationLog,
} from "./pages/room-detail"
export type { ConnectionInfo, ConnectionsList } from "./pages/connections"
export type { ChannelInfo, ChannelsList } from "./pages/channels"
export type { ConfigSummary } from "./pages/config"
export {
  StreamingChannelsPage,
  StreamingConfigPage,
  StreamingConnectionsPage,
  StreamingOverviewPage,
  StreamingPresencePage,
  StreamingRoomDetailPage,
  StreamingRoomsPage,
}

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
 * All five commands the contract declares are wired up now: `rooms.create`
 * and `rooms.delete` on the rooms page, `rooms.send-message` on a room's
 * detail page, `connections.kick` on the connections page, and `presence.set`
 * here on the presence page. Every one of them goes through `useCommand`, so
 * the CSRF token and idempotency key are minted the same way regardless of
 * which page issues the write.
 */
export const streamingPlugin = definePlugin({
  extension: "streaming-contract",
  namespace: "streaming",
  label: "Streaming",
  icon: <AudioWaveformIcon />,
  nav: [
    { label: "Overview", to: "/", priority: 10, icon: <LayoutGridIcon /> },
    { label: "Rooms", to: "/rooms", priority: 20, icon: <HouseIcon /> },
    {
      label: "Connections",
      to: "/connections",
      priority: 30,
      icon: <LinkIcon />,
    },
    { label: "Channels", to: "/channels", priority: 40, icon: <RadioIcon /> },
    { label: "Presence", to: "/presence", priority: 50, icon: <UsersIcon /> },
    { label: "Configuration", to: "/config", priority: 60, icon: <SettingsIcon /> },
  ],
  routes: [
    { path: "/", element: StreamingOverviewPage },
    { path: "/rooms", element: StreamingRoomsPage },
    { path: "/rooms/:id", element: StreamingRoomDetailPage },
    { path: "/connections", element: StreamingConnectionsPage },
    { path: "/channels", element: StreamingChannelsPage },
    { path: "/presence", element: StreamingPresencePage },
    { path: "/config", element: StreamingConfigPage },
  ],
})

export default streamingPlugin
