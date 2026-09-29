import { Suspense, useEffect, useMemo, useRef, useState } from "react"
import type { ComponentType, ReactNode } from "react"
import type * as React from "react"
import {
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router"
import {
  FallbackAuthGate,
  PluginErrorBoundary,
  useDashboardConfig,
  useSession,
} from "@forge-go/dashboard-runtime"
import {
  NavigationProvider,
  createScopedClient,
  HostAccessProvider,
  labelOf,
  MismatchPanel,
  mountPath,
  namespaceOf,
  parseGoDuration,
  partitionScopes,
  PluginProvider,
  queryStore,
  resolveActiveScope,
  resolveAuthProvider,
  resolvePluginState,
  routedPathDimension,
  SCOPE_SIGIL,
  SetupPanel,
  SubPluginProvider,
} from "@forge-go/dashboard-plugin"
import type {
  Capabilities,
  ForgePlugin,
  ForgeSubPlugin,
  PluginLinkProps,
  PluginNavItem,
  PluginPageProps,
  PluginRoute,
  PluginState,
  Scope,
  ScopedClient,
} from "@forge-go/dashboard-plugin"
import { DashboardShell } from "@forge-go/dashboard-kit/components/dashboard-shell"
import { NavigationSearch } from "./NavigationSearch"
import { ContextSwitchers } from "./ContextSwitchers"
import { RoutedPage, RoutedPicker, routeSegmentPattern } from "./RoutedScope"
import { AuthRoutes, SignedInRedirect } from "../auth/AuthRoutes"
import { isAuthPath } from "../auth/routes"
import type { AuthScreens } from "../auth/routes"
import { DeniedScreen } from "../auth/screens"
import type {
  NavGroup,
  NavNode,
} from "@forge-go/dashboard-kit/components/nav-tree"
import type { ScopeOption } from "@forge-go/dashboard-kit/components/scope-entries"
import { useSidebar } from "@forge-go/dashboard-kit/components/sidebar"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@forge-go/dashboard-kit/components/alert"
import { Spinner } from "@forge-go/dashboard-kit/components/spinner"
import { TriangleAlertIcon } from "@forge-go/dashboard-kit/icons"

type HostSidebar = Omit<
  React.ComponentProps<typeof DashboardShell>,
  "children" | "title" | "scope" | "actions"
>

/**
 * The chrome every host state renders inside: sidebar, header, and the content
 * container. Loading, error and the resolved plugins all go through here, so
 * none of them can produce a bare page.
 */
function HostShell({
  children,
  sidebar,
  title,
  scope,
  actions,
}: {
  children: ReactNode
  sidebar: HostSidebar
  title?: string
  scope?: string
  actions?: ReactNode
}) {
  return (
    <DashboardShell {...sidebar} title={title} scope={scope} actions={actions}>
      {/* Renders nothing; it only needs the sidebar context the shell provides. */}
      <SidebarRouteSync />
      {children}
    </DashboardShell>
  )
}

function SidebarRouteSync() {
  const { pathname } = useLocation()
  const { setOpenMobile } = useSidebar()
  useEffect(() => setOpenMobile(false), [pathname, setOpenMobile])
  return null
}

export interface PluginHostProps {
  plugins: ForgePlugin[]
  headerActions?: ReactNode
  /**
   * Sub-plugins, each naming the plugin it mounts inside. Resolved against the
   * same capabilities document as plugins, so an absent Go contributor hides a
   * sub-plugin exactly as it hides a plugin: no nav, no route, no widget, no
   * log line.
   */
  subPlugins?: ForgeSubPlugin[]
  /**
   * Injected in tests. The host uses one fetch for both the capabilities
   * request and every scoped client it builds, so a single stub covers the
   * whole surface and no global has to be replaced and restored.
   */
  fetchImpl?: typeof fetch
  /**
   * The router's mount prefix, for building links inside the auth screens.
   * ForgeDashboard already takes this and hands it to BrowserRouter; the auth
   * screens need it too, so it has to come down here as well.
   */
  basename?: string
  /** Replaces any of the built-in auth screens. Supplied by the host app. */
  authScreens?: AuthScreens
}

type CapabilitiesState =
  | { status: "loading" }
  | { status: "ready"; capabilities: Capabilities }
  | { status: "error"; message: string }

// The order the sidebar actually shows a scope's nav in. `homePathFor`, the
// target of every link in the scope rail, needs "the item a scope displays
// first," and that is this order's [0], not declaration order -- a plugin whose nav is not
// already sorted must still land you on the item the sidebar shows first.
function sortByPriority<T extends { priority?: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
}

function foldClusters(items: PluginNavItem[]): PluginNavItem[] {
  const sorted = sortByPriority(items)
  const clusters = new Map<string, PluginNavItem[]>()
  for (const item of sorted) {
    if (!item.cluster || item.children?.length) continue
    const members = clusters.get(item.cluster.label) ?? []
    members.push(item)
    clusters.set(item.cluster.label, members)
  }

  const emitted = new Set<string>()
  return sorted.flatMap((item) => {
    const label = item.cluster?.label
    if (!label || item.children?.length) return [item]
    if (emitted.has(label)) return []
    emitted.add(label)
    const members = clusters.get(label) ?? [item]
    if (members.length < 2) return [item]
    return [{
      label,
      to: members[0].to,
      priority: members[0].priority,
      icon: item.cluster?.icon,
      children: members.map((member) => ({ ...member, cluster: undefined })),
    }]
  })
}

// One mapper for the host plugin's nav and every sub-plugin's nav together.
// Two copies of this would be two chances to forget mountPath and emit a link
// that resolves outside its plugin.
//
// A sub-plugin's `to` is relative to its HOST's namespace, not to a namespace
// of its own. That is the whole point of mounting inside: "/organizations" on
// a sub-plugin of "auth" serves at "/@auth/organizations", so `mountPath` is
// called with the host plugin in both cases.
//
// `segment` is the CURRENT app, read off the URL by the caller -- never the
// ":app" pattern the route table itself is mounted with. A link has to name
// a real app to be followable at all.
function toNodes(plugin: ForgePlugin, items: PluginNavItem[], segment?: string): NavNode[] {
  return items.map((item) => ({
    label: item.label,
    href: mountPath(plugin, item.to, segment),
    icon: item.icon,
    children: item.children?.map((child) => ({
      label: child.label,
      href: mountPath(plugin, child.to, segment),
      icon: child.icon,
    })),
  }))
}

const UNGROUPED = Symbol("ungrouped")

/**
 * The sidebar's groups for one scope: the plugin's own nav merged with every
 * ready sub-plugin's.
 *
 * Ungrouped items come first, in one unlabelled group. Every plugin shipping
 * today declares no groups, so this is what keeps `plugin-core` and
 * `plugin-streaming` rendering exactly as they do now.
 *
 * Named groups follow in first-appearance order, host nav scanned before
 * sub-plugin nav, with items sorted by priority inside each. First appearance
 * rather than alphabetical because the Go manifests already imply an order and
 * an admin reading "Identity, Security, Auth" should not get "Auth,
 * Compliance, Configuration".
 *
 * `contributed` marks a group holding at least one sub-plugin item, a field
 * kit's NavGroup already carries.
 */
export function navGroups(
  plugin: ForgePlugin,
  subPlugins: ForgeSubPlugin[],
  segment?: string,
): NavGroup[] {
  const buckets = new Map<
    string | typeof UNGROUPED,
    { items: PluginNavItem[]; contributed: boolean }
  >()

  function add(items: PluginNavItem[], contributed: boolean) {
    for (const item of items) {
      const key = item.group ?? UNGROUPED
      const bucket = buckets.get(key)
      if (bucket) {
        bucket.items.push(item)
        bucket.contributed ||= contributed
      } else {
        buckets.set(key, { items: [item], contributed })
      }
    }
  }

  add(plugin.nav, false)
  for (const sub of subPlugins) add(sub.nav, true)

  // The ungrouped bucket leads regardless of where it was inserted.
  const ordered = [...buckets.entries()].sort(([a], [b]) => {
    if (a === UNGROUPED) return -1
    if (b === UNGROUPED) return 1
    return 0
  })

  return ordered.map(([key, bucket]) => ({
    label: key === UNGROUPED ? undefined : key,
    contributed: bucket.contributed || undefined,
    items: toNodes(plugin, foldClusters(bucket.items), segment),
  }))
}

// Two sub-plugins of one host can both claim a path, and so can a sub-plugin
// and its host. Import-time validation cannot see it: those authors never met,
// and the collision exists only in this deployment's particular combination.
// React-router matches the first and leaves the rest unreachable in silence,
// so pick a winner deterministically and say what was dropped.
//
// The host's own route always wins. Between sub-plugins, the winner is
// decided purely by extension name (ascending), so the outcome never depends
// on the order somebody happened to write the imports. (ForgeSubPlugin has no
// priority field, so there is no "lower priority wins" step before that.)
// `segment` must be the SAME representation the caller used to build the
// actual mounted <Route path> values -- the ":app" pattern for the route
// table, never a real app slug -- or this compares paths that were never
// going to collide at runtime against paths that were, and calls it a match
// or a miss for the wrong reason.
function dropCollidingRoutes(
  hostPlugin: ForgePlugin,
  subs: { subPlugin: ForgeSubPlugin; state: PluginState }[],
  segment?: string
): {
  subPlugin: ForgeSubPlugin
  state: PluginState
  routes: PluginRoute[]
  /**
   * Mounted paths (already run through mountPath) this sub-plugin lost to a
   * collision. The nav side of this same decision needs it too: a nav item
   * whose route lost must not go on linking to a path that now serves
   * somebody else's page.
   */
  droppedPaths: Set<string>
}[] {
  const claimed = new Set(
    hostPlugin.routes.map((r) => mountPath(hostPlugin, r.path, segment))
  )
  const ordered = [...subs].sort((a, b) =>
    a.subPlugin.extension < b.subPlugin.extension ? -1 : 1
  )

  return ordered.map((entry) => {
    const kept: PluginRoute[] = []
    const droppedPaths = new Set<string>()
    for (const route of entry.subPlugin.routes) {
      const path = mountPath(hostPlugin, route.path, segment)
      if (claimed.has(path)) {
        console.warn(
          `[forge-dashboard] "${entry.subPlugin.extension}" claims "${path}", which is already mounted. That page will not be reachable. Two installed extensions disagree about this path; one of them has to change it.`
        )
        droppedPaths.add(path)
        continue
      }
      claimed.add(path)
      kept.push(route)
    }
    return { ...entry, routes: kept, droppedPaths }
  })
}

// Where "/" inside a plugin's own scope actually is: its first nav item (or
// first route, nav being optional), or -- for a plugin with a `path`-routed
// dimension -- the namespace root itself, because nothing at the site root
// can know which app to land on. That root is RoutedPicker's own path, and
// it redirects further once the server names a current app, or shows the
// dimension's picker when it does not.
function homePathFor(plugin: ForgePlugin): string {
  if (routedPathDimension(plugin)) return mountPath(plugin, "/", undefined)
  return mountPath(
    plugin,
    sortByPriority(plugin.nav)[0]?.to ?? plugin.routes[0]?.path ?? "/"
  )
}

/**
 * The real app segment a URL names, read directly off the pathname -- never
 * off react-router params, because the caller that needs this (building nav
 * hrefs) renders one level above any matched Route and has no params of its
 * own to read. `undefined` covers both "no segment at all" (the namespace
 * root, or a shorter path) and "this pathname belongs to a different scope
 * entirely," which is exactly the set of cases that should produce no nav.
 */
function segmentFromPath(pathname: string, namespace: string): string | undefined {
  const prefix = `/${SCOPE_SIGIL}${namespace}/`
  if (!pathname.startsWith(prefix)) return undefined
  return pathname.slice(prefix.length).split("/")[0] || undefined
}

// Module scope, not a default `= []` in PluginHostProps's destructure. A
// literal in the parameter list is a new array every render, and this value
// sits in the `clients` useMemo's dependency list below, so defaulting
// inline would hand every plugin a fresh ScopedClient on every render -- the
// exact thing that memo exists to prevent -- for every consumer that never
// passes sub-plugins at all: ForgeDashboard when its own prop is omitted,
// and every host test written before this one.
const NO_SUB_PLUGINS: ForgeSubPlugin[] = []

/**
 * Reads the route's params and hands them to a plugin page as a prop.
 *
 * A hook is the only way react-router exposes params, and a plugin page must
 * not call one, because no plugin package depends on react-router. So the host
 * calls it here, one level above the page, and the page stays a plain
 * component.
 */
function RouteParams({
  page: Page,
  stripParam,
}: {
  page: ComponentType<PluginPageProps>
  /**
   * A route param name to hide from the page, never the page's own. Set to
   * a routed dimension's param ("app", say) when the route it belongs to was
   * mounted under one, so react-router's own ":app" ends up in `useParams()`
   * without a plugin page ever seeing it. A page declares "/users" and the
   * host decides where that mounts; a page reading `params.app` would be the
   * host deciding not to keep that promise.
   */
  stripParam?: string
}) {
  const params = useParams()
  const visible = stripParam
    ? Object.fromEntries(
        Object.entries(params).filter(([key]) => key !== stripParam)
      )
    : params
  /*
    Suspense here, at the one place every plugin and sub-plugin page passes
    through, is what makes a lazy route legal.

    Without it `element: lazy(() => import("./pages/policy-editor"))` throws
    the moment the chunk is still in flight, so every page in the dashboard
    had to be a static import and the whole shell was one eager chunk. That is
    fine until a plugin wants a code editor or a graph canvas, at which point
    everybody pays for it on first paint whether they open that page or not.

    Per page rather than one boundary around the router: a page that suspends
    should show a spinner where the page goes, not blank the chrome around it.
  */
  return (
    <Suspense fallback={<PageLoading />}>
      <Page params={visible} />
    </Suspense>
  )
}

/** Shown while a lazily-loaded page's chunk is still arriving. */
function PageLoading() {
  return (
    <div
      role="status"
      className="flex items-center gap-2 p-4 text-sm text-muted-foreground"
    >
      <Spinner />
      Loading…
    </div>
  )
}

export function PluginHost({
  plugins,
  subPlugins = NO_SUB_PLUGINS,
  fetchImpl,
  basename,
  authScreens,
  headerActions,
}: PluginHostProps) {
  const { contractBase } = useDashboardConfig()
  const session = useSession()
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
    // Two things must both hold before capabilities are worth asking for.
    //
    // First, the session must have resolved at least once. This is deliberately
    // `!session.resolved`, not `session.state.status === "unknown"`: a page
    // whose principal was inlined by the Go handler starts its first render
    // already `signedIn` or `signedOut` (session.tsx's `seed()`), before the
    // real `/principal` fetch behind that seed has ever landed. Gating on the
    // status instead of on `resolved` would pass on that very first render,
    // fire capabilities once against the seed, then fire it again the instant
    // the real fetch confirms or downgrades it and `session.epoch` changes --
    // two requests on every load that carries an inlined principal, which no
    // jsdom-default test (none of them seed `window.__FORGE_DASHBOARD__`) is
    // in a position to notice.
    //
    // Second, the resolved state must not be one that blocks the whole page
    // behind the gate. `signedOut` and `denied` both mean nobody is about to
    // see a capabilities-driven page anyway, so a request here would be a
    // guaranteed-401 sent for no reader.
    if (
      !session.resolved ||
      session.state.status === "signedOut" ||
      session.state.status === "denied"
    ) {
      return
    }

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
  }, [
    contractBase,
    doFetch,
    session.epoch,
    session.resolved,
    session.state.status,
  ])

  // Drops the query cache when the signed-in identity changes.
  //
  // queryStore's cache key (extension, intent, params) carries no identity
  // component, and an entry younger than its server-supplied staleTime is
  // served without a round trip. Nothing else in this file, or in the
  // store, ever separates one visitor's cached rows from another's. Without
  // this, an admin who opens Users and then signs out through the footer
  // would hand the next person to sign in, within the stale window, their
  // cached rows: the key still matches, and the entry is still fresh.
  //
  // Gated on the *subject*, not on every session resolution. session.refresh
  // fires on ordinary events too -- a rejected request re-reading /principal,
  // a login that resolves back to the same person -- and clearing on all of
  // those would defeat the cache for no reason. Only a change in who is
  // signed in earns a clear.
  const identitySubject =
    session.state.status === "signedIn"
      ? session.state.principal.subject
      : undefined
  const lastIdentityRef = useRef<{ subject: string | undefined } | null>(null)

  useEffect(() => {
    if (!session.resolved) return
    // The first resolution sets the baseline rather than clearing: there is
    // no previous identity yet for this one to differ from, so nothing in
    // the store could have been cached for somebody else.
    if (
      lastIdentityRef.current !== null &&
      lastIdentityRef.current.subject !== identitySubject
    ) {
      queryStore.clear()
    }
    lastIdentityRef.current = { subject: identitySubject }
  }, [identitySubject, session.resolved])

  // One client per plugin, each permanently bound to that plugin's own
  // extension. Built here rather than inside the render of each route so a
  // re-render does not hand every plugin a fresh client identity.
  //
  // The meta listener is what joins the client to the store. A command's
  // `meta.invalidates` drops exactly the intents the server named, within the
  // sending extension only, and a query's `meta.cacheControl` teaches the
  // store how long that intent may be served stale. Both fields have been on
  // the wire since the envelope was written; this is the first thing to read
  // them.
  const clients = useMemo(() => {
    const byExtension = new Map<string, ScopedClient>()
    const build = (extension: string) => {
      if (byExtension.has(extension)) return
      byExtension.set(
        extension,
        createScopedClient(
          contractBase,
          extension,
          doFetch,
          (info) => {
            if (info.kind === "query") {
              queryStore.noteStaleTime(
                info.extension,
                info.intent,
                parseGoDuration(info.meta.cacheControl?.staleTime)
              )
              return
            }
            if (info.meta.invalidates?.length) {
              queryStore.invalidate(info.extension, info.meta.invalidates)
            }
          },
          session.refresh
        )
      )
    }
    for (const plugin of plugins) build(plugin.extension)
    for (const sub of subPlugins) build(sub.extension)
    return byExtension
  }, [plugins, subPlugins, contractBase, doFetch, session.refresh])

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

  // A sub-plugin gets the same four answers a plugin does, from the same
  // function against the same document. `hidden` is the common case and is not
  // an error: a deployment without the organization plugin has no
  // Organizations page, and that is correct.
  //
  // Only `ready` sub-plugins reach the slots. A sub-plugin in `setup` still
  // gets its own routes, so somebody can reach its setup screen, but
  // contributes nothing to anybody else's page: a widget reading "needs
  // configuring" on the auth overview is noise rather than information.
  const resolvedSubs =
    state.status === "ready"
      ? subPlugins
          .map((subPlugin) => ({
            subPlugin,
            state: resolvePluginState(
              // resolvePluginState reads `extension` and `requires` only, and
              // both interfaces carry them, so no second implementation is
              // needed and the two can never drift apart.
              subPlugin as unknown as ForgePlugin,
              state.capabilities
            ),
          }))
          .filter((entry) => entry.state.kind !== "hidden")
      : []

  // The root plugin (if any) is not one scope among several: it is pinned
  // nav, not a switcher entry, so it is split out before anything downstream
  // ever sees it as a "scope".
  // What `PluginLink` and `useNavigateTo` resolve to inside the shell.
  //
  // Same split the sidebar already uses through `renderLink`: the host owns a
  // router and no plugin package depends on one. Without this a "Details" link
  // on a table row is a plain anchor, which in a single-page app is a full
  // document load -- capabilities refetched, every plugin remounted, the query
  // store discarded.
  //
  // Memoised on `navigate` alone. A new object each render would remount every
  // link in the tree, which is the bug this is meant to avoid rather than cause.
  const navigation = useMemo(
    () => ({
      Link: ({ to, children, ...rest }: PluginLinkProps) => (
        <Link to={to} {...rest}>
          {children}
        </Link>
      ),
      navigate: (to: string) => navigate(to),
      // Turns a page's scope-relative path into a real one. The page writes
      // "/users/u1"; only this layer knows which scope is mounted, which app
      // the URL currently names, and what search to carry along.
      //
      // Reads the scope off the PATHNAME rather than off route params for the
      // same reason `segmentFromPath` does: this runs above any matched Route
      // and has no params to read. A path that belongs to no mounted scope
      // resolves to itself, which is the honest answer.
      resolve: (to: string) => {
        const scope = resolved.find((s) =>
          pathname.startsWith(`/${SCOPE_SIGIL}${namespaceOf(s.plugin)}`),
        )
        if (!scope) return to
        // A segment is only meaningful for a plugin that actually declares a
        // routed path dimension (an app-style switcher, like authsome's).
        // For every other plugin, the first path component after the scope
        // sigil is an ordinary route, not a context value, and threading it
        // through mountPath doubles it: "/roles" on "/@warden/roles" became
        // "/@warden/roles/roles". Same guard `ownerDimension` already uses
        // below for nav, applied here for links.
        const segment = routedPathDimension(scope.plugin)
          ? segmentFromPath(pathname, namespaceOf(scope.plugin))
          : undefined
        return `${mountPath(scope.plugin, to, segment)}${search}`
      },
    }),
    [navigate, resolved, pathname, search],
  )

  const { root, scopes } = partitionScopes(resolved)

  // A sub-plugin whose host is not ready renders nothing, whatever its own
  // state says. There is nowhere to put it.
  const readyHosts = new Set(
    resolved
      .filter((scope) => scope.state.kind === "ready")
      .map((scope) => scope.id)
  )

  function subsMountedIn(hostExtension: string) {
    if (!readyHosts.has(hostExtension)) return []
    return resolvedSubs.filter(
      (entry) => entry.subPlugin.host === hostExtension
    )
  }

  // Ready sub-plugins for one host, with nav filtered by the same collision
  // decision that decides routes. A losing sub-plugin's route never mounts
  // (dropCollidingRoutes above), so its nav item must not go on linking to a
  // path that now opens the winner's page instead -- that would trade a
  // missing page for a wrong one, which is worse. A nav item pointing at a
  // path this sub-plugin never declared a route for is untouched; only paths
  // actually lost to a collision are filtered.
  function readySubPluginsFor(hostPlugin: ForgePlugin): ForgeSubPlugin[] {
    // The ":app" pattern, not the real segment: this decision is structural
    // (which sub-plugin's route lost to which) and has to use the same
    // representation dropCollidingRoutes mounted its claims with, or a real
    // collision goes undetected because the two sides never compare equal.
    const dimension = routedPathDimension(hostPlugin)
    const pattern = dimension ? routeSegmentPattern(dimension) : undefined
    return dropCollidingRoutes(hostPlugin, subsMountedIn(hostPlugin.extension), pattern)
      .filter((entry) => entry.state.kind === "ready")
      .map((entry) => ({
        ...entry.subPlugin,
        nav: entry.subPlugin.nav.filter(
          (item) => !entry.droppedPaths.has(mountPath(hostPlugin, item.to, pattern))
        ),
      }))
  }

  // `undefined` means "at the root" -- a real, expected answer, not an error
  // or an empty state. A pathname with no recognised "@namespace" segment
  // (including the root plugin's own pages) belongs to no scope at all.
  const activeScope = resolveActiveScope(pathname, scopes)

  // A non-ready ROOT has no scope to render its panel in, so it renders here.
  // The rule for scopes extends without needing a new one: a non-ready scope
  // renders its panel inside its own scope, and the root's own scope is the
  // root. Without this, taking core out of the scope model turns W8's "your
  // server needs configuring" screen into a blank page, on the most common
  // deployment there is: a server with no extensions installed at all.
  const panelSource = activeScope ?? root

  const scopeOptions: ScopeOption[] = scopes.map((scope) => ({
    id: scope.id,
    label: scope.label,
    namespace: scope.namespace,
    icon: scope.icon,
    badge: scope.state.kind === "ready" ? undefined : scope.state.kind,
    // homePathFor, not a bare first-nav-item mountPath: a scope with a
    // `path`-routed dimension has no route at its unscoped first item, so
    // landing there would be a dead route. homePathFor sends that case to
    // the namespace root, where RoutedPicker resolves it the rest of the way.
    href: homePathFor(scope.plugin),
  }))

  // The rail's home entry. Not `home`: that name is taken further down by the
  // landing path the "/" redirect goes to, which is a different thing.
  const homeScope: ScopeOption | undefined = root
    ? {
        id: root.id,
        label: root.label,
        namespace: root.namespace,
        icon: root.icon,
        href: homePathFor(root.plugin),
      }
    : undefined

  // The body shows the nav of wherever you are, which is the same question
  // `panelSource` asks and therefore the same answer: the active scope, or
  // the root when no scope is active.
  //
  // The root's nav used to be pinned into the header in every scope, which
  // left the body empty on the root's own pages and put a second nav above
  // the switcher everywhere else. One nav, in the body, belonging to the
  // place you are.
  //
  // No group label: the pane heading above already names the active scope by
  // label and by "@namespace", so a section heading repeating either is text
  // a screen reader (and a test) would find twice. That changes the day
  // sub-plugin groups arrive and there is more than one group to tell apart.
  const navOwner = activeScope ?? root

  // The real value, read off the current URL -- never the ":app" pattern the
  // route table itself is mounted with. `undefined` when `navOwner` has no
  // routed dimension at all, which is what keeps every plugin without one
  // (core, streaming) producing exactly the nav it always has.
  const ownerDimension = navOwner ? routedPathDimension(navOwner.plugin) : undefined
  const ownerSegment =
    ownerDimension && navOwner
      ? segmentFromPath(pathname, navOwner.namespace)
      : undefined

  const groups: NavGroup[] =
    navOwner && navOwner.state.kind === "ready"
      ? // Rule: no segment means no nav items for that scope. Thirty-seven
        // links that would each answer about an app nobody picked is worse
        // than none; the picker is what the content area shows instead.
        ownerDimension && !ownerSegment
        ? []
        : navGroups(navOwner.plugin, readySubPluginsFor(navOwner.plugin), ownerSegment)
      : []

  // The pane's heading names the place you are. Namespace only for a scope:
  // the root is the dashboard's home, not "@core".
  const heading = navOwner
    ? {
        label: navOwner.label,
        namespace: activeScope ? activeScope.namespace : undefined,
        icon: navOwner.icon,
      }
    : undefined

  // The two cases that used to leave the pane silently blank. A ready scope
  // with a segment and no nav is a plugin with no nav, which is legal and
  // stays quiet.
  const empty = (() => {
    if (!navOwner) return undefined
    if (navOwner.state.kind === "setup") {
      return {
        message: navOwner.state.message ?? "This extension needs configuring.",
        href: homePathFor(navOwner.plugin),
        label: "Open setup",
      }
    }
    if (navOwner.state.kind === "mismatch") {
      return {
        message: "This extension needs a newer server.",
        href: homePathFor(navOwner.plugin),
        label: "Open setup",
      }
    }
    if (ownerDimension && !ownerSegment) {
      return { message: "Pick an app to see its pages." }
    }
    return undefined
  })()

  // The header's title names the current page, not the product: the label of
  // whichever nav item's href matches the current pathname, checking children
  // too since a deep link can land straight on one. One nav to scan now: the
  // root plugin's own pages put the root's nav in `groups`, so there is no
  // separate pinned list to check first. Falls back to the owner's own label
  // when the pathname
  // matches nothing in either (its own root, or a route the plugin never
  // listed).
  const pageTitle: string | undefined = (() => {
    const destinations = groups.flatMap((group) => group.items.flatMap((item) => [item, ...(item.children ?? [])]))
    const match = destinations
      .filter((item) => item.href === pathname || (item.href !== "/" && pathname.startsWith(`${item.href}/`)))
      .sort((a, b) => b.href.length - a.href.length)[0]
    return match?.label ?? (activeScope ?? root)?.label
  })()

  // Sign-out is the provider's command, sent through the provider's own
  // client, and this host never learns what it does. `signOutIntent` is a
  // string the plugin handed over; refreshing afterwards is what puts the
  // gate back up, because /principal is the only thing that decides that.
  const authProvider = resolveAuthProvider(plugins)
  const signOutIntent = authProvider?.auth?.intents.signOut
  const onSignOut =
    authProvider && signOutIntent
      ? () => {
          void clients
            .get(authProvider.extension)
            ?.command(signOutIntent)
            .catch(() => {
              // A failed sign-out still has to re-read the session: the
              // cookie may well be gone even though the response never
              // arrived, and leaving the old footer up would claim you are
              // still signed in.
            })
            .finally(() => session.refresh())
        }
      : undefined

  const sidebar = {
    home: homeScope,
    scopes: scopeOptions,
    activeScopeId: activeScope?.id,
    heading,
    empty,
    groups,
    currentPath: pathname,
    search,
    // aria-current only when true. The rail merges its own aria-current onto
    // this element through base-ui's render prop, and an explicit undefined
    // here would win over it and strip the active scope's marker.
    renderLink: (node: NavNode, href: string) => (
      <Link to={href} {...(node.href === pathname ? { "aria-current": "page" as const } : {})}>
        {node.icon}
        <span>{node.label}</span>
      </Link>
    ),
    header: <>
      {panelSource && panelSource.state.kind === "ready" && (
        <div className="group-data-[collapsible=icon]:hidden">
          <PluginErrorBoundary key={panelSource.id} plugin={panelSource.id}>
            <PluginProvider client={clients.get(panelSource.plugin.extension)!}>
              <ContextSwitchers dimensions={panelSource.plugin.context} plugin={panelSource.plugin} />
            </PluginProvider>
          </PluginErrorBoundary>
        </div>
      )}
      <NavigationSearch groups={groups} search={search} scopes={[
        ...(root ? [{ label: root.label, href: homePathFor(root.plugin) }] : []),
        ...scopes.map(scope => ({ label: scope.label, href: homePathFor(scope.plugin) })),
      ]} />
    </>,
    user:
      session.state.status === "signedIn"
        ? {
            name:
              session.state.principal.displayName ??
              session.state.principal.subject ??
              "Signed in",
            email: session.state.principal.email ?? "",
          }
        : { name: "Dashboard user", email: "" },
    onSignOut,
  } satisfies HostSidebar

  // Rule 3, and it has to come before the shell. `pathname` is the one
  // PluginHost already destructures from useLocation at the top of the
  // component, and inside a BrowserRouter it is already basename-relative,
  // which is why isAuthPath gets "" and not basename.
  if (session.state.status === "signedIn" && isAuthPath(pathname, "")) {
    return <SignedInRedirect basename={basename ?? ""} />
  }

  if (session.state.status === "signedOut") {
    const provider = resolveAuthProvider(plugins)

    // No provider at all is a wiring mistake, not a sign-in screen. Say so
    // plainly instead of rendering a form with nothing behind it.
    if (!provider?.auth) {
      return <FallbackAuthGate reason="no-provider" />
    }

    return (
      <PluginErrorBoundary
        fallback={<FallbackAuthGate reason="screen-failed" />}
        key={provider.extension}
        plugin={provider.extension}
      >
        <PluginProvider client={clients.get(provider.extension)!}>
          <AuthRoutes
            basename={basename ?? ""}
            intents={provider.auth.intents}
            onAuthenticated={session.refresh}
            screens={authScreens}
          />
        </PluginProvider>
      </PluginErrorBoundary>
    )
  }

  // Signed in as the wrong person. Not a sign-in flow and not a route: what
  // this visitor needs is a way out of the account they are already in.
  if (session.state.status === "denied") {
    const provider = resolveAuthProvider(plugins)
    const denied = (
      <DeniedScreen
        onSignedOut={session.refresh}
        requiredRoles={session.state.requiredRoles}
        signOutIntent={provider?.auth?.intents.signOut}
      />
    )

    // No provider means DeniedScreen renders with no signOutIntent, which
    // means its SignOutButton never mounts and never calls a hook that needs
    // a client. Nothing here to wrap a boundary or a client around.
    if (!provider) return denied

    return (
      <PluginErrorBoundary
        fallback={<FallbackAuthGate reason="screen-failed" />}
        key={provider.extension}
        plugin={provider.extension}
      >
        <PluginProvider client={clients.get(provider.extension)!}>
          {denied}
        </PluginProvider>
      </PluginErrorBoundary>
    )
  }

  // Neutral chrome, not the shell. HostShell's pane always renders a
  // sidebar-header div, gate or no gate, so putting the spinner inside
  // HostShell here would put sidebar chrome on screen before the session
  // says whether this visitor may see it at all.
  if (session.state.status === "unknown") {
    return (
      <div className="flex min-h-svh items-center justify-center gap-2 text-sm text-muted-foreground">
        <Spinner />
        Resolving your session…
      </div>
    )
  }

  // Bare, like `unknown` above and unlike the capabilities-error branch
  // below: this fires whenever /principal itself failed, which is not only
  // the dead-server case where /capabilities fails too. A 500 out of the
  // principal handler alone still lets capabilities answer fine, and
  // rendering this inside HostShell would build the full sidebar object
  // regardless -- every scope name and nav item reaching the DOM for a
  // visitor who may not be signed in at all. That is the disclosure the gate
  // above exists to prevent, and a route that paints over a mounted sidebar
  // is exactly the curtain this dashboard does not do.
  if (session.state.status === "unreachable") {
    return (
      <div className="flex min-h-svh items-center justify-center p-4">
        <Alert variant="destructive" className="max-w-md">
          <TriangleAlertIcon />
          <AlertTitle>Could not determine whether you are signed in</AlertTitle>
          <AlertDescription>{session.state.message}</AlertDescription>
        </Alert>
      </div>
    )
  }

  if (state.status === "loading") {
    return (
      <HostShell sidebar={sidebar} title={pageTitle} scope={navOwner?.label} actions={headerActions}>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner />
          Loading dashboard capabilities…
        </div>
      </HostShell>
    )
  }

  if (state.status === "error") {
    return (
      <HostShell sidebar={sidebar} title={pageTitle} scope={navOwner?.label} actions={headerActions}>
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>Could not reach the dashboard server</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      </HostShell>
    )
  }

  // root counts toward "ready" alongside the scopes: a root plugin that is
  // mismatched or needs setup contributes no routes here, same as any scope.
  const ready = [root, ...scopes].filter(
    (scope): scope is Scope =>
      scope !== undefined && scope.state.kind === "ready"
  )

  // ready is [root, ...scopes] filtered, so ready[0] is the root when the root
  // is ready and the first ready scope otherwise. Routes mount only for ready
  // plugins, so preferring the root unconditionally would redirect "/" to a
  // path that matches nothing.
  const landing = ready[0]
  const home = landing
    ? homePathFor(landing.plugin)
    : // Nothing is ready. Falling back to undefined here is what used to
      // leave "/" stranded: no sigil, so resolveActiveScope reads it as "at
      // the root," panelSource has neither an activeScope nor a root to be,
      // and the page renders no panel at all -- on a server with no root
      // plugin and exactly one extension still in setup, the single most
      // common deployment there is. A scope that exists but is not ready
      // still has a namespace, so land there instead: resolveActiveScope
      // resolves "/@<namespace>" straight back to that scope, and its own
      // setup/mismatch panel renders exactly as it would from a real visit.
      // homePathFor(scope.plugin) would work here too (it collapses to the
      // same mountPath(..., "/") for a plugin with no routed dimension) but
      // a not-ready scope's own dimension has nothing to answer with yet
      // anyway, so the bare namespace root is written out directly.
      scopes[0]
      ? mountPath(scopes[0].plugin, "/")
      : undefined

  return (
    <HostShell sidebar={sidebar} title={pageTitle} scope={navOwner?.label} actions={headerActions}>
      {panelSource && panelSource.state.kind === "mismatch" && (
        <MismatchPanel
          required={panelSource.state.required}
          reported={panelSource.state.reported}
        />
      )}
      {panelSource && panelSource.state.kind === "setup" && (
        <PluginErrorBoundary key={panelSource.id} plugin={panelSource.id}>
          {(() => {
            const Setup = panelSource.plugin.setup ?? SetupPanel
            return <Setup message={panelSource.state.message} />
          })()}
        </PluginErrorBoundary>
      )}

      {/*
        No route table at all when nothing is ready and there is no fallback
        home either, rather than an empty one. An empty <Routes> makes
        react-router warn that the location matched nothing, which is noise:
        a dashboard with nothing to route to has no pages by design, and that
        is already said by the panel above. `home` alone can still be truthy
        here with `ready` empty -- see its computation above -- so the
        redirect route below must not be gated on `ready.length > 0`, or the
        one case this exists for (nothing ready, landing on a not-ready
        scope's namespace root so its panel can render) never gets a route to
        land on.
      */}
      {(ready.length > 0 || home) && (
        <NavigationProvider value={navigation}>
        <SubPluginProvider
          entries={
            panelSource
              ? subsMountedIn(panelSource.plugin.extension)
                  .filter((entry) => entry.state.kind === "ready")
                  .map((entry) => ({
                    subPlugin: entry.subPlugin,
                    client: clients.get(entry.subPlugin.extension)!,
                    // The HOST plugin's client -- the same one the route-level
                    // HostAccessProvider below uses -- so a slot contribution
                    // reads host intents through its own provider rather than
                    // inheriting whichever route happens to be mounted above it.
                    hostClient: clients.get(panelSource.plugin.extension)!,
                  }))
              : []
          }
        >
          <Routes>
            {ready.flatMap(({ plugin }) => {
              // Static for the life of this plugin -- never the real app
              // currently open. ":app" is what lets ONE mounted <Route>
              // answer for every app slug; RoutedPage below is what decides,
              // per request, whether the segment react-router actually
              // matched names anything real.
              const dimension = routedPathDimension(plugin)
              const pattern = dimension ? routeSegmentPattern(dimension) : undefined

              const pageRoutes = plugin.routes.map((route) => {
                const Page = route.element
                return (
                  <Route
                    key={`${plugin.extension}:${route.path}`}
                    path={mountPath(plugin, route.path, pattern)}
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
                          {dimension ? (
                            <RoutedPage plugin={plugin} dimension={dimension}>
                              <RouteParams page={Page} stripParam={dimension.routed!.param} />
                            </RoutedPage>
                          ) : (
                            <RouteParams page={Page} />
                          )}
                        </PluginProvider>
                      </PluginErrorBoundary>
                    }
                  />
                )
              })

              if (!dimension) return pageRoutes

              // The picker's own route. "/@auth" exactly -- mountPath's "/"
              // handling already collapses that, never "/@auth/" -- so a
              // static parent and the ":app" pattern above never contend for
              // the same location: one is one path segment, the other two,
              // and react-router can only match a location to a pattern with
              // the same segment count.
              return [
                ...pageRoutes,
                <Route
                  key={`${plugin.extension}:picker`}
                  path={mountPath(plugin, "/", undefined)}
                  element={
                    <PluginErrorBoundary
                      key={`${plugin.extension}:picker:${pathname}`}
                      plugin={plugin.extension}
                    >
                      <PluginProvider client={clients.get(plugin.extension)!}>
                        <RoutedPicker plugin={plugin} dimension={dimension} />
                      </PluginProvider>
                    </PluginErrorBoundary>
                  }
                />,
              ]
            })}
            {ready.flatMap(({ plugin }) => {
              const dimension = routedPathDimension(plugin)
              const pattern = dimension ? routeSegmentPattern(dimension) : undefined

              return dropCollidingRoutes(
                plugin,
                subsMountedIn(plugin.extension),
                pattern
              ).flatMap((entry) =>
                entry.routes.map((route) => {
                  // Not ready but not hidden: its route still mounts, so
                  // somebody following a link or a bookmark lands on a panel
                  // explaining why rather than on a blank page. That fallback
                  // component takes `message`, not `params` -- it never reads
                  // route params, so it renders directly rather than through
                  // RouteParams, which exists only for a route's own page.
                  const page =
                    entry.state.kind === "ready" ? (
                      <RouteParams page={route.element} stripParam={dimension?.routed?.param} />
                    ) : (
                      (() => {
                        const Setup = entry.subPlugin.setup ?? SetupPanel
                        return (
                          <Setup
                            message={
                              entry.state.kind === "setup"
                                ? entry.state.message
                                : undefined
                            }
                          />
                        )
                      })()
                    )
                  const client = clients.get(entry.subPlugin.extension)
                  const hostClient = clients.get(plugin.extension)
                  const inner = (
                    <PluginProvider client={client!}>
                      <HostAccessProvider
                        value={{
                          client: hostClient!,
                          allowed: entry.subPlugin.hostIntents,
                          subExtension: entry.subPlugin.extension,
                        }}
                      >
                        {page}
                      </HostAccessProvider>
                    </PluginProvider>
                  )
                  return (
                    <Route
                      key={`${entry.subPlugin.extension}:${route.path}`}
                      path={mountPath(plugin, route.path, pattern)}
                      element={
                        // Same reasoning as the host route boundary above:
                        // keyed on the resolved pathname, not a constant, so
                        // one sub-plugin throwing does not latch a failed
                        // boundary instance that then paints over every
                        // subsequent sub-plugin page until a full reload.
                        <PluginErrorBoundary
                          key={`${entry.subPlugin.extension}:${pathname}`}
                          plugin={entry.subPlugin.extension}
                        >
                          {dimension ? (
                            // The HOST's client, not the sub-plugin's: a
                            // routed dimension's query and switch command are
                            // intents on the plugin that DECLARES it, and a
                            // sub-plugin mounts inside its host's namespace,
                            // never with a context of its own.
                            <PluginProvider client={clients.get(plugin.extension)!}>
                              <RoutedPage plugin={plugin} dimension={dimension}>
                                {inner}
                              </RoutedPage>
                            </PluginProvider>
                          ) : (
                            inner
                          )}
                        </PluginErrorBoundary>
                      }
                    />
                  )
                })
              )
            })}
            {/*
            home === "/" is reachable now that a root plugin's own paths pass
            through mountPath untouched: a root plugin whose priority-first
            nav item (or, with no nav, first route) is "/" resolves `home` to
            the literal root, and without this guard the route below would
            redirect "/" to the location it is already rendering. Guarded
            here rather than at the computation above so every caller of
            `home` -- this route and the panel fallback alike -- sees the
            same value; only the redirect itself needs to refuse to fire.
          */}
            {home && home !== "/" && (
              <Route path="/" element={<Navigate to={home} replace />} />
            )}
          </Routes>
        </SubPluginProvider>
        </NavigationProvider>
      )}
    </HostShell>
  )
}
