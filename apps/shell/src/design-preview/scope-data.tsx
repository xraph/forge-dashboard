import {
  AppWindow,
  AudioLines,
  Clock3,
  Globe,
  House,
  KeyRound,
  LayoutGrid,
  Plug,
  Radio,
  Settings2,
  ShieldCheck,
  Smartphone,
  ToggleLeft,
  Users,
  Webhook,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
export interface ScopePageDefinition {
  id: string
  label: string
  group: string
  icon: LucideIcon
  description: string
}
const auth = [
  [
    "",
    "Overview",
    "System",
    LayoutGrid,
    "Authentication and access across your application.",
  ],
  [
    "users",
    "Users",
    "Identity",
    Users,
    "Manage people and their access to your application.",
  ],
  [
    "sessions",
    "Sessions",
    "Identity",
    Clock3,
    "Review active sessions and recent sign-ins.",
  ],
  [
    "devices",
    "Devices",
    "Identity",
    Smartphone,
    "Devices associated with your users.",
  ],
  [
    "roles",
    "Roles",
    "Identity",
    ShieldCheck,
    "Access roles and the people assigned to them.",
  ],
  [
    "apps",
    "Apps",
    "Configuration",
    AppWindow,
    "Applications managed by Authsome.",
  ],
  [
    "environments",
    "Environments",
    "Configuration",
    Globe,
    "Authentication environments for each application.",
  ],
  [
    "webhooks",
    "Webhooks",
    "Configuration",
    Webhook,
    "Send identity events to your application.",
  ],
  [
    "signup-forms",
    "Signup forms",
    "Configuration",
    LayoutGrid,
    "The forms used to create accounts.",
  ],
  [
    "settings",
    "Settings",
    "Configuration",
    Settings2,
    "Authentication preferences and session policies.",
  ],
  [
    "credentials",
    "Credentials",
    "Security",
    KeyRound,
    "Application credentials and access keys.",
  ],
  [
    "features",
    "Features",
    "Security",
    ToggleLeft,
    "Authentication capabilities enabled for your application.",
  ],
  [
    "plugins",
    "Plugins",
    "System",
    Plug,
    "Authsome sub-plugins installed in this workspace.",
  ],
] as const
const streaming = [
  [
    "",
    "Overview",
    "Streaming",
    LayoutGrid,
    "Connections and delivery across your realtime application.",
  ],
  [
    "rooms",
    "Rooms",
    "Streaming",
    House,
    "Rooms and their connected participants.",
  ],
  [
    "connections",
    "Connections",
    "Streaming",
    Plug,
    "Open transports and connected clients.",
  ],
  [
    "channels",
    "Channels",
    "Streaming",
    Radio,
    "Publish destinations and their subscribers.",
  ],
  [
    "presence",
    "Presence",
    "Streaming",
    Users,
    "People currently connected to your application.",
  ],
  [
    "config",
    "Configuration",
    "Manage",
    Settings2,
    "Transport and message delivery settings.",
  ],
] as const
export const scopePages: ScopePageDefinition[] = [
  ...auth.map(([path, label, group, icon, description]) => ({
    id: `/@auth/${path}`,
    label,
    group,
    icon,
    description,
  })),
  ...streaming.map(([path, label, group, icon, description]) => ({
    id: `/@streaming/${path}`,
    label,
    group,
    icon,
    description,
  })),
]
export const previewScopes = [
  { id: "auth", namespace: "auth", label: "Authsome", icon: <ShieldCheck /> },
  {
    id: "streaming",
    namespace: "streaming",
    label: "Streaming",
    icon: <AudioLines />,
  },
]
