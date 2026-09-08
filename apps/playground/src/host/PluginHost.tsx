import { useEffect, useMemo, useState } from "react"
import type { ReactNode } from "react"
import type * as React from "react"
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router"
import {
  PluginErrorBoundary,
  useDashboardConfig,
} from "@forge-go/dashboard-runtime"
import {
  createScopedClient,
  labelOf,
  MismatchPanel,
  mountPath,
  namespaceOf,
  partitionScopes,
  PluginProvider,
  resolveActiveScope,
  resolvePluginState,
  SetupPanel,
} from "@forge-go/dashboard-plugin"
import type {
  Capabilities,
  ForgePlugin,
  Scope,
  ScopedClient,
} from "@forge-go/dashboard-plugin"
import { AppSidebar } from "@forge-go/dashboard-kit/components/app-sidebar"
import type { NavGroup, NavNode } from "@forge-go/dashboard-kit/components/nav-tree"
import type { ScopeOption } from "@forge-go/dashboard-kit/components/scope-switcher"
import { SiteHeader } from "@forge-go/dashboard-kit/components/site-header"
import {
  SidebarInset,
  SidebarProvider,
} from "@forge-go/dashboard-kit/components/sidebar"

/**
 * The chrome every host state renders inside: sidebar, header, and the content
 * container. Loading, error and the resolved plugins all go through here, so
 * none of them can produce a bare page.
 */
function HostShell({
  children,
  sidebar,
  title,
}: {
  children: ReactNode
  sidebar: React.ComponentProps<typeof AppSidebar>
  title?: string
}) {
  return (
    <SidebarProvider>
      <AppSidebar variant="inset" {...sidebar} />
      <SidebarInset>
        <SiteHeader title={title} />
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

// The order the sidebar actually shows a scope's nav in. `home` and
// `selectScope` both need "the item a scope displays first," and that is
// this order's [0], not declaration order -- a plugin whose nav is not
// already sorted must still land you on the item the sidebar shows first.
function sortByPriority<T extends { priority?: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
}

// One mapper for both the pinned root nav and the active scope's nav. Two
// copies of this would be two chances to forget mountPath and emit a link
// that resolves outside its plugin.
function navNodes(plugin: ForgePlugin): NavNode[] {
  return sortByPriority(plugin.nav).map((item) => ({
    label: item.label,
    href: mountPath(plugin, item.to),
    icon: item.icon,
    children: item.children?.map((child) => ({
      label: child.label,
      href: mountPath(plugin, child.to),
      icon: child.icon,
    })),
  }))
}

export function PluginHost({ plugins, fetchImpl }: PluginHostProps) {
  const { contractBase } = useDashboardConfig()
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
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

  // Every state renders the sidebar, so scopes are built before the early
  // returns. Before capabilities land there are none, and the switcher shows
  // its fallback rather than a half-built list.
  const resolved: Scope[] =
    state.status === "ready"
      ? plugins
          .map((plugin) => ({
            id: plugin.extension,
            namespace: namespaceOf(plugin),
            label: labelOf(plugin),
            icon: plugin.icon,
            plugin,
            state: resolvePluginState(plugin, state.capabilities),
          }))
          .filter((scope) => scope.state.kind !== "hidden")
      : []

  // The root plugin (if any) is not one scope among several: it is pinned
  // nav, not a switcher entry, so it is split out before anything downstream
  // ever sees it as a "scope".
  const { root, scopes } = partitionScopes(resolved)

  // `undefined` means "at the root" -- a real, expected answer, not an error
  // or an empty state. A pathname with no recognised "@namespace" segment
  // (including the root plugin's own pages) belongs to no scope at all.
  const activeScope = resolveActiveScope(pathname, scopes)

  const scopeOptions: ScopeOption[] = scopes.map((scope) => ({
    id: scope.id,
    label: scope.label,
    namespace: scope.namespace,
    icon: scope.icon,
    badge: scope.state.kind === "ready" ? undefined : scope.state.kind,
  }))

  // The root plugin's nav, pinned above the switcher and visible in every
  // scope -- it is not part of the switcher's rotation, so it does not wait
  // on activeScope at all.
  const pinned: NavGroup[] =
    root && root.state.kind === "ready" ? [{ items: navNodes(root.plugin) }] : []

  // Only the active scope's nav is shown here. priority orders a plugin's
  // items among its own and nothing more. No group label here: the switcher
  // above already names the active scope both by its label and its
  // "@namespace" caption, and repeating either one as a section heading only
  // duplicates text a screen reader (and a test) would otherwise find once.
  const groups: NavGroup[] =
    activeScope && activeScope.state.kind === "ready"
      ? [{ items: navNodes(activeScope.plugin) }]
      : []

  // The header's title names the current page, not the product: the label of
  // whichever nav item's href matches the current pathname, checking children
  // too since a deep link can land straight on one, and checking the pinned
  // nav first since the root plugin's own pages have no active scope to fall
  // back to. Falls back to the active scope's own label when the pathname
  // matches nothing in either (its own root, or a route the plugin never
  // listed).
  const pageTitle: string | undefined = (() => {
    for (const group of [...pinned, ...groups]) {
      for (const item of group.items) {
        if (item.href === pathname) return item.label
        for (const child of item.children ?? []) {
          if (child.href === pathname) return child.label
        }
      }
    }
    return activeScope?.label
  })()

  // Switching scope is a navigation, never a state write. A scope with no nav
  // (one that needs setup) goes to its bare namespace root, where its panel
  // renders. Search is carried over for now, but that is provisional: no
  // `ctx.` params exist yet, so there is nothing to drop and nothing to prove
  // this against. Per-scope context dimensions belong to the plugin that
  // declares them, so once `ctx.` params land, switching scope should DROP
  // any dimension the new scope never declared, not carry it over blind.
  const selectScope = (id: string) => {
    const target = scopes.find((scope) => scope.id === id)
    if (!target) return
    const first = sortByPriority(target.plugin.nav)[0]
    navigate(`${mountPath(target.plugin, first ? first.to : "/")}${search}`)
  }

  const sidebar = {
    pinned,
    scopes: scopeOptions,
    activeScopeId: activeScope?.id,
    onScopeSelect: selectScope,
    groups,
    currentPath: pathname,
    search,
    renderLink: (_node: NavNode, href: string) => <Link to={href} />,
    user: { name: "Dashboard user", email: "user@example.com" },
  } satisfies React.ComponentProps<typeof AppSidebar>

  if (state.status === "loading") {
    return (
      <HostShell sidebar={sidebar} title={pageTitle}>
        <p role="status" className="text-sm text-muted-foreground">
          Loading dashboard capabilities…
        </p>
      </HostShell>
    )
  }

  if (state.status === "error") {
    return (
      <HostShell sidebar={sidebar} title={pageTitle}>
        <div
          role="alert"
          className="rounded-md border border-destructive/50 px-3 py-2 text-sm text-destructive"
        >
          Could not reach the dashboard server: {state.message}
        </div>
      </HostShell>
    )
  }

  // root counts toward "ready" alongside the scopes: a root plugin that is
  // mismatched or needs setup contributes no routes here, same as any scope.
  const ready = [root, ...scopes].filter(
    (scope): scope is Scope => scope !== undefined && scope.state.kind === "ready",
  )

  // The root plugin owns "/" when there is one. Without it the first ready
  // scope's first item wins, which is what a shell built without core gets.
  const landing = root ?? ready[0]
  const home = landing
    ? mountPath(landing.plugin, sortByPriority(landing.plugin.nav)[0]?.to ?? "/")
    : undefined

  return (
    <HostShell sidebar={sidebar} title={pageTitle}>
      {activeScope && activeScope.state.kind === "mismatch" && (
        <MismatchPanel
          required={activeScope.state.required}
          reported={activeScope.state.reported}
        />
      )}
      {activeScope && activeScope.state.kind === "setup" && (
        <PluginErrorBoundary key={activeScope.id} plugin={activeScope.id}>
          {(() => {
            const Setup = activeScope.plugin.setup ?? SetupPanel
            return <Setup message={activeScope.state.message} />
          })()}
        </PluginErrorBoundary>
      )}

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
                  path={mountPath(plugin, route.path)}
                  element={
                    // The unit this isolates is one plugin: a third-party
                    // bundle throwing during render must take down its own
                    // page, not the dashboard.
                    //
                    // The key is load-bearing and is not the same key as the
                    // one on <Route>. <Routes> renders exactly one element
                    // here, so without a key React sees PluginErrorBoundary at
                    // the same position on every navigation and keeps the
                    // instance -- along with the latched failed:true a
                    // previous page put there. One plugin throwing then paints
                    // "failed to render" over every page you navigate to next,
                    // naming whichever plugin you just opened, until a full
                    // reload. That inverts the boundary: instead of one plugin
                    // taking down its own page, one plugin takes down the
                    // dashboard by a slower route. Keying per route makes each
                    // navigation a remount, which is the only way a class
                    // boundary clears itself.
                    //
                    // Keyed on the resolved pathname, not route.path. route.path
                    // is the pattern (`/users/:id`), and every id that pattern
                    // matches shares one <Route> element and therefore one
                    // boundary instance -- a throw on one id would latch the
                    // fallback for every other id served by the same route.
                    // The extension stays in the key too, as defense in depth:
                    // mountPath gives every non-root plugin its own
                    // "@namespace" and gives the one root plugin the bare
                    // path, so two plugins can no longer resolve to the same
                    // pathname at all, but the key does not depend on that
                    // guarantee holding to stay correct.
                    <PluginErrorBoundary
                      key={`${plugin.extension}:${pathname}`}
                      plugin={plugin.extension}
                    >
                      <PluginProvider client={clients.get(plugin.extension)!}>
                        <Page />
                      </PluginProvider>
                    </PluginErrorBoundary>
                  }
                />
              )
            }),
          )}
          {home && <Route path="/" element={<Navigate to={home} replace />} />}
        </Routes>
      )}
    </HostShell>
  )
}
