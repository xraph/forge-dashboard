"use client"

import dynamic from "next/dynamic"
import type { ComponentType, ReactNode } from "react"
import type { ForgeDashboard } from "./define"

/*
 * The host composes a BrowserRouter and Base UI portals that touch `document`
 * during render, not only in effects. Next still server-renders a "use client"
 * page on first load, which crashes on anything assuming a real DOM outside an
 * effect. `ssr: false` skips that pass and mounts the dashboard purely on the
 * client, which is what a browser-only SPA needs.
 *
 * This lives here rather than in every host app on purpose: it is the one
 * piece of the integration that is both mandatory and non-obvious, and getting
 * it wrong produces "document is not defined" from a package the app author
 * did not write.
 */
const Host = dynamic(
  () => import("@forge-go/dashboard-host").then((mod) => mod.ForgeDashboard),
  { ssr: false }
) as ComponentType<{
  basename?: string
  config: ForgeDashboard["config"]
  plugins: ForgeDashboard["plugins"]
  subPlugins?: ForgeDashboard["subPlugins"]
  fetchImpl?: typeof fetch
}>

export interface ForgeDashboardPageProps {
  /** The value from `defineForgeDashboard`, held at module scope. */
  forge: ForgeDashboard
  /** Injected in tests, and by a host that wraps its own fetch. */
  fetchImpl?: typeof fetch
}

/**
 * The whole page, for an app that wants the dashboard and not a construction
 * kit.
 *
 * The page that renders this has to be a client component. `forge` carries the
 * plugins, and a plugin is React components, which cannot cross a
 * server-to-client prop boundary. Without the directive the plugin modules land
 * in the server graph instead and the build fails on their `createContext`
 * calls, blaming a file the app author did not write.
 *
 * ```tsx
 * // app/forge/[[...slug]]/page.tsx
 * "use client"
 *
 * import { ForgeDashboardPage } from "@forge-go/dashboard-next"
 * import { forge } from "@/forge.config"
 *
 * export default function Page() {
 *   return <ForgeDashboardPage forge={forge} />
 * }
 * ```
 */
export function ForgeDashboardPage({
  forge,
  fetchImpl,
}: ForgeDashboardPageProps): ReactNode {
  return (
    <Host
      // The router's basename is the page's own mount, never the contract's.
      basename={forge.mountPath}
      config={forge.config}
      fetchImpl={fetchImpl}
      plugins={forge.plugins}
      subPlugins={forge.subPlugins}
    />
  )
}
