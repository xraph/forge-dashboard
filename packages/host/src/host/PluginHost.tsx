import { useEffect, useMemo, useRef, useState } from "react"
import type { ReactNode } from "react"
import type * as React from "react"
import {
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router"
import {
  FallbackAuthGate,
  PluginErrorBoundary,
  useDashboardConfig,
  useSession,
} from "@forge-go/dashboard-runtime"
import {
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
  SetupPanel,
  SubPluginProvider,
} from "@forge-go/dashboard-plugin"
import type {
  Capabilities,
  ForgePlugin,
  ForgeSubPlugin,
  PluginNavItem,
  PluginRoute,
  PluginState,
  Scope,
  ScopedClient,
} from "@forge-go/dashboard-plugin"
import { AppSidebar } from "@forge-go/dashboard-kit/components/app-sidebar"
import { ContextSwitchers } from "./ContextSwitchers"
import type {
  NavGroup,
  NavNode,
} from "@forge-go/dashboard-kit/components/nav-tree"
import type { ScopeOption } from "@forge-go/dashboard-kit/components/scope-switcher"
import { SiteHeader } from "@forge-go/dashboard-kit/components/site-header"
import {
  SidebarInset,
  SidebarProvider,
} from "@forge-go/dashboard-kit/components/sidebar"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@forge-go/dashboard-kit/components/alert"
import { Spinner } from "@forge-go/dashboard-kit/components/spinner"
import { TriangleAlertIcon } from "@forge-go/dashboard-kit/icons"

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

// One mapper for the host plugin's nav and every sub-plugin's nav together.
// Two copies of this would be two chances to forget mountPath and emit a link
// that resolves outside its plugin.
//
// A sub-plugin's `to` is relative to its HOST's namespace, not to a namespace
// of its own. That is the whole point of mounting inside: "/organizations" on
// a sub-plugin of "auth" serves at "/@auth/organizations", so `mountPath` is
// called with the host plugin in both cases.
function toNodes(plugin: ForgePlugin, items: PluginNavItem[]): NavNode[] {
  return items.map((item) => ({
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
  subPlugins: ForgeSubPlugin[]
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
    items: toNodes(plugin, sortByPriority(bucket.items)),
  }))
}

// Two sub-plugins of one host can both claim a path, and so can a sub-plugin
// and its host. Import-time validation cannot see it: those authors never met,
// and the collision exists only in this deployment's particular combination.
// React-router matches the first and leaves the rest unreachable in silence,
// so pick a winner deterministically and say what was dropped.
//
// The host's own route always wins. Between sub-plugins the lower priority
// wins, and ties break on extension name so the winner never depends on the
// order somebody happened to write the imports.
function dropCollidingRoutes(
  hostPlugin: ForgePlugin,
  subs: { subPlugin: ForgeSubPlugin; state: PluginState }[]
): { subPlugin: ForgeSubPlugin; state: PluginState; routes: PluginRoute[] }[] {
  const claimed = new Set(
    hostPlugin.routes.map((r) => mountPath(hostPlugin, r.path))
  )
  const ordered = [...subs].sort((a, b) =>
    a.subPlugin.extension < b.subPlugin.extension ? -1 : 1
  )

  return ordered.map((entry) => {
    const kept: PluginRoute[] = []
    for (const route of entry.subPlugin.routes) {
      const path = mountPath(hostPlugin, route.path)
      if (claimed.has(path)) {
        console.warn(
          `[forge-dashboard] "${entry.subPlugin.extension}" claims "${path}", which is already mounted. That page will not be reachable. Two installed extensions disagree about this path; one of them has to change it.`
        )
        continue
      }
      claimed.add(path)
      kept.push(route)
    }
    return { ...entry, routes: kept }
  })
}

export function PluginHost({
  plugins,
  subPlugins = [],
  fetchImpl,
}: PluginHostProps) {
  const { contractBase } = useDashboardConfig()
  const { loginPath } = useDashboardConfig()
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

  function readySubPluginsFor(hostExtension: string): ForgeSubPlugin[] {
    return subsMountedIn(hostExtension)
      .filter((entry) => entry.state.kind === "ready")
      .map((entry) => entry.subPlugin)
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
  }))

  // The way out of the active scope: the root plugin's own home.
  //
  // Offered only from inside a scope. At the root this row would point at the
  // page you are already on, and the root plugin's nav is reachable in the
  // body there anyway. Taking navNodes()[0] rather than plugin.nav[0] is
  // deliberate and matches `home` and `selectScope`: the sidebar sorts by
  // priority, so a root plugin whose nav is not already in priority order
  // must still send you to the item the sidebar shows first. A ready root
  // with no nav at all yields undefined here, so there is no row pointing
  // nowhere.
  const back: NavNode | undefined =
    activeScope && root && root.state.kind === "ready"
      ? navGroups(root.plugin, [])[0]?.items[0]
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
  // No group label: the switcher above already names the active scope by
  // label and by "@namespace", so a section heading repeating either is text
  // a screen reader (and a test) would find twice. That changes the day
  // sub-plugin groups arrive and there is more than one group to tell apart.
  const navOwner = activeScope ?? root
  const groups: NavGroup[] =
    navOwner && navOwner.state.kind === "ready"
      ? navGroups(
          navOwner.plugin,
          readySubPluginsFor(navOwner.plugin.extension)
        )
      : []

  // The header's title names the current page, not the product: the label of
  // whichever nav item's href matches the current pathname, checking children
  // too since a deep link can land straight on one. One nav to scan now: the
  // root plugin's own pages put the root's nav in `groups`, so there is no
  // separate pinned list to check first. Falls back to the owner's own label
  // when the pathname
  // matches nothing in either (its own root, or a route the plugin never
  // listed).
  const pageTitle: string | undefined = (() => {
    for (const group of groups) {
      for (const item of group.items) {
        if (item.href === pathname) return item.label
        for (const child of item.children ?? []) {
          if (child.href === pathname) return child.label
        }
      }
    }
    return (activeScope ?? root)?.label
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

  // Sign-out is the provider's command, sent through the provider's own
  // client, and this host never learns what it does. `signOutIntent` is a
  // string the plugin handed over; refreshing afterwards is what puts the
  // gate back up, because /principal is the only thing that decides that.
  const authProvider = resolveAuthProvider(plugins)
  const signOutIntent = authProvider?.auth?.signOutIntent
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
    back,
    scopes: scopeOptions,
    activeScopeId: activeScope?.id,
    onScopeSelect: selectScope,
    groups,
    currentPath: pathname,
    search,
    renderLink: (_node: NavNode, href: string) => <Link to={href} />,
    header:
      panelSource && panelSource.state.kind === "ready" ? (
        <PluginProvider client={clients.get(panelSource.plugin.extension)!}>
          <ContextSwitchers dimensions={panelSource.plugin.context} />
        </PluginProvider>
      ) : undefined,
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
  } satisfies React.ComponentProps<typeof AppSidebar>

  // The gate goes here, before anything builds a route table or a sidebar.
  // Rendering it as a route would leave the shell mounted underneath it,
  // naming every scope the visitor is not allowed to see.
  if (
    session.state.status === "signedOut" ||
    session.state.status === "denied"
  ) {
    const provider = resolveAuthProvider(plugins)
    const Gate = provider?.auth?.gate ?? FallbackAuthGate
    const gateLoginPath =
      session.state.status === "signedOut" ? session.state.loginPath : loginPath
    const requiredRoles =
      session.state.status === "denied"
        ? session.state.requiredRoles
        : undefined

    return (
      // A gate is third-party code like any other plugin component, and a
      // throw here would blank the only screen with a way in. The fallback
      // gate is the one thing that cannot be taken down by a plugin.
      <PluginErrorBoundary
        key={provider?.extension ?? "fallback-gate"}
        plugin={provider?.extension ?? "auth"}
        fallback={
          <FallbackAuthGate
            loginPath={gateLoginPath}
            requiredRoles={requiredRoles}
            onAuthenticated={session.refresh}
          />
        }
      >
        {/*
          The gate needs its plugin's scoped client, and it cannot inherit one:
          it renders outside the route table, and PluginProvider is normally
          applied per route. Without this the authsome gate throws the moment
          it calls useCommand("auth.login"), because usePlugin finds no
          client. The fallback gate needs none, since it only ever links.
        */}
        {provider ? (
          <PluginProvider client={clients.get(provider.extension)!}>
            <Gate
              loginPath={gateLoginPath}
              requiredRoles={requiredRoles}
              onAuthenticated={session.refresh}
            />
          </PluginProvider>
        ) : (
          <Gate
            loginPath={gateLoginPath}
            requiredRoles={requiredRoles}
            onAuthenticated={session.refresh}
          />
        )}
      </PluginErrorBoundary>
    )
  }

  // Neutral chrome, not the shell. HostShell's AppSidebar always renders a
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
      <HostShell sidebar={sidebar} title={pageTitle}>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner />
          Loading dashboard capabilities…
        </div>
      </HostShell>
    )
  }

  if (state.status === "error") {
    return (
      <HostShell sidebar={sidebar} title={pageTitle}>
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
    ? mountPath(
        landing.plugin,
        sortByPriority(landing.plugin.nav)[0]?.to ??
          landing.plugin.routes[0]?.path ??
          "/"
      )
    : // Nothing is ready. Falling back to undefined here is what used to
      // leave "/" stranded: no sigil, so resolveActiveScope reads it as "at
      // the root," panelSource has neither an activeScope nor a root to be,
      // and the page renders no panel at all -- on a server with no root
      // plugin and exactly one extension still in setup, the single most
      // common deployment there is. A scope that exists but is not ready
      // still has a namespace, so land there instead: resolveActiveScope
      // resolves "/@<namespace>" straight back to that scope, and its own
      // setup/mismatch panel renders exactly as it would from a real visit.
      scopes[0]
      ? mountPath(scopes[0].plugin, "/")
      : undefined

  return (
    <HostShell sidebar={sidebar} title={pageTitle}>
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
        <SubPluginProvider
          entries={
            panelSource
              ? subsMountedIn(panelSource.plugin.extension)
                  .filter((entry) => entry.state.kind === "ready")
                  .map((entry) => ({
                    subPlugin: entry.subPlugin,
                    client: clients.get(entry.subPlugin.extension)!,
                  }))
              : []
          }
        >
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
              })
            )}
            {ready.flatMap(({ plugin }) =>
              dropCollidingRoutes(
                plugin,
                subsMountedIn(plugin.extension)
              ).flatMap((entry) =>
                entry.routes.map((route) => {
                  const Page =
                    entry.state.kind === "ready"
                      ? route.element
                      : // Not ready but not hidden: its route still mounts, so
                        // somebody following a link or a bookmark lands on a
                        // panel explaining why rather than on a blank page.
                        (entry.subPlugin.setup ?? SetupPanel)
                  const client = clients.get(entry.subPlugin.extension)
                  const hostClient = clients.get(plugin.extension)
                  return (
                    <Route
                      key={`${entry.subPlugin.extension}:${route.path}`}
                      path={mountPath(plugin, route.path)}
                      element={
                        <PluginErrorBoundary
                          key={entry.subPlugin.extension}
                          plugin={entry.subPlugin.extension}
                        >
                          <PluginProvider client={client!}>
                            <HostAccessProvider
                              value={{
                                client: hostClient!,
                                allowed: entry.subPlugin.hostIntents,
                                subExtension: entry.subPlugin.extension,
                              }}
                            >
                              <Page />
                            </HostAccessProvider>
                          </PluginProvider>
                        </PluginErrorBoundary>
                      }
                    />
                  )
                })
              )
            )}
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
      )}
    </HostShell>
  )
}
