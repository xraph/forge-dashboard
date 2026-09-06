import { useEffect, useMemo, useState } from "react"
import type { ReactNode } from "react"
import { Link, Navigate, Route, Routes } from "react-router"
import { PluginErrorBoundary, useDashboardConfig } from "@forge/dashboard-runtime"
import {
  createScopedClient,
  MismatchPanel,
  PluginProvider,
  resolvePluginState,
  SetupPanel,
} from "@forge/dashboard-plugin"
import type {
  Capabilities,
  ForgePlugin,
  PluginNavItem,
  PluginState,
  ScopedClient,
} from "@forge/dashboard-plugin"
import { AppSidebar } from "@forge/dashboard-kit/components/app-sidebar"
import { SiteHeader } from "@forge/dashboard-kit/components/site-header"
import {
  SidebarInset,
  SidebarProvider,
} from "@forge/dashboard-kit/components/sidebar"

/**
 * The chrome every host state renders inside: sidebar, header, and the content
 * container. Loading, error and the resolved plugins all go through here, so
 * none of them can produce a bare page.
 */
function HostShell({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider>
      <AppSidebar variant="inset" />
      <SidebarInset>
        <SiteHeader />
        {/*
          `@container/main` is load-bearing, not decoration. dashboard-01's
          SectionCards sizes itself with container queries scoped to a container
          named `main` (@xl/main:grid-cols-2, @5xl/main:grid-cols-4). Without
          this declaration those variants never match and the cards stack in a
          single column at every width.
        */}
        <div className="@container/main flex flex-1 flex-col gap-4 p-4">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

export interface PluginHostProps {
  plugins: ForgePlugin[]
  /**
   * Injected in tests. The host uses one fetch for both the capabilities
   * request and every scoped client it builds, so a single stub covers the
   * whole surface and no global has to be replaced and restored.
   */
  fetchImpl?: typeof fetch
}

type CapabilitiesState =
  | { status: "loading" }
  | { status: "ready"; capabilities: Capabilities }
  | { status: "error"; message: string }

export function PluginHost({ plugins, fetchImpl }: PluginHostProps) {
  const { contractBase } = useDashboardConfig()
  const [state, setState] = useState<CapabilitiesState>({ status: "loading" })

  // Bound on purpose: an unbound `fetch` called as a plain function throws
  // "Illegal invocation" in the browser, because it needs `window` as its
  // receiver.
  const doFetch = useMemo(
    () => fetchImpl ?? fetch.bind(globalThis),
    [fetchImpl]
  )

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const res = await doFetch(`${contractBase}/capabilities`, {
          credentials: "same-origin",
        })
        if (!res.ok) {
          throw new Error(`capabilities request failed with HTTP ${res.status}`)
        }
        const capabilities = (await res.json()) as Capabilities
        // A 200 whose body parses but is not a capabilities document would
        // otherwise reach resolvePluginState and throw during the host's own
        // render, which is outside every boundary and blanks the page. Fold
        // it into the same failure the transport errors take.
        if (!Array.isArray(capabilities?.contributors)) {
          throw new Error("capabilities response carried no contributors array")
        }
        if (!cancelled) setState({ status: "ready", capabilities })
      } catch (error) {
        if (!cancelled) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : String(error),
          })
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [contractBase, doFetch])

  // One client per plugin, each permanently bound to that plugin's own
  // extension. Built here rather than inside the render of each route so a
  // re-render does not hand every plugin a fresh client identity.
  const clients = useMemo(() => {
    const byExtension = new Map<string, ScopedClient>()
    for (const plugin of plugins) {
      byExtension.set(
        plugin.extension,
        createScopedClient(contractBase, plugin.extension, doFetch)
      )
    }
    return byExtension
  }, [plugins, contractBase, doFetch])

  if (state.status === "loading") {
    return (
      <HostShell>
        <p role="status" className="text-sm text-muted-foreground">
          Loading dashboard capabilities…
        </p>
      </HostShell>
    )
  }

  if (state.status === "error") {
    return (
      <HostShell>
        <div
          role="alert"
          className="rounded-md border border-destructive/50 px-3 py-2 text-sm text-destructive"
        >
          Could not reach the dashboard server: {state.message}
        </div>
      </HostShell>
    )
  }

  const resolved: { plugin: ForgePlugin; pluginState: PluginState }[] =
    plugins.map((plugin) => ({
      plugin,
      pluginState: resolvePluginState(plugin, state.capabilities),
    }))

  const ready = resolved.filter((r) => r.pluginState.kind === "ready")

  // priority orders a plugin's items among its own, and nothing more. Sorting
  // the flattened list instead would let one plugin's priority push another
  // plugin's entry around, which is not what the field means and not the
  // cross-plugin order we settled on: plugins keep installation order.
  const nav: { plugin: ForgePlugin; item: PluginNavItem }[] = ready.flatMap(
    ({ plugin }) =>
      [...plugin.nav]
        .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
        .map((item) => ({ plugin, item }))
  )

  const home = nav[0]?.item.to ?? ready[0]?.plugin.routes[0]?.path

  // A plugin is free to own the dashboard root, and when one does the host
  // must not also emit a redirect off it. Today that redirect loses anyway,
  // but only by accident: react-router breaks a tie between two routes of
  // equal specificity on declaration order, and the redirect happens to be
  // declared last. Turn the route table around and "/" starts bouncing. Say
  // it here instead of leaning on where the JSX happens to sit.
  const rootIsClaimed = ready.some(({ plugin }) =>
    plugin.routes.some((route) => route.path === "/")
  )

  return (
    <HostShell>
      {nav.length > 0 && (
        // Plugin nav lives here rather than in the sidebar because AppSidebar
        // is dashboard-01's fixed chrome: it hardcodes its own items and
        // offers no injection point. Contributed nav moving into the sidebar
        // proper is a kit change, not a host change.
        <nav aria-label="Plugin pages" className="flex flex-wrap gap-2">
          {nav.map(({ plugin, item }) => (
            <Link
              key={`${plugin.extension}:${item.to}`}
              to={item.to}
              className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      )}

      {resolved.map(({ plugin, pluginState }) => {
        if (pluginState.kind === "mismatch") {
          return (
            <MismatchPanel
              key={plugin.extension}
              required={pluginState.required}
              reported={pluginState.reported}
            />
          )
        }
        if (pluginState.kind === "setup") {
          const Setup = plugin.setup ?? SetupPanel
          return (
            // plugin.setup is third-party code exactly as a route element is,
            // so it gets the same containment. Without this a plugin whose
            // setup screen throws takes the whole dashboard down, which is
            // the one failure the boundary exists to prevent. The host-owned
            // SetupPanel does not need it, but this branch cannot tell which
            // of the two it is holding without pretending to know.
            <PluginErrorBoundary
              key={plugin.extension}
              plugin={plugin.extension}
            >
              <Setup message={pluginState.message} />
            </PluginErrorBoundary>
          )
        }
        return null
      })}

      {/*
        No route table at all when nothing is ready, rather than an empty one.
        An empty <Routes> makes react-router warn that the location matched
        nothing, which is noise: a dashboard whose only plugin needs setup has
        no pages by design, and that is already said by the panel above.
      */}
      {ready.length > 0 && (
        <Routes>
          {ready.flatMap(({ plugin }) =>
            plugin.routes.map((route) => {
              const Page = route.element
              return (
                <Route
                  key={`${plugin.extension}:${route.path}`}
                  path={route.path}
                  element={
                    // The unit this isolates is one plugin: a third-party
                    // bundle throwing during render must take down its own
                    // page, not the dashboard.
                    <PluginErrorBoundary plugin={plugin.extension}>
                      <PluginProvider client={clients.get(plugin.extension)!}>
                        <Page />
                      </PluginProvider>
                    </PluginErrorBoundary>
                  }
                />
              )
            })
          )}
          {home && !rootIsClaimed && (
            <Route path="/" element={<Navigate to={home} replace />} />
          )}
        </Routes>
      )}
    </HostShell>
  )
}
