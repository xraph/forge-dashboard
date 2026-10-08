import { useEffect, useRef, useState } from "react"
import type { ComponentType, ReactNode } from "react"
import { Navigate, useLocation, useParams, useSearchParams } from "react-router"
import {
  mountPath,
  urlValueOf,
  useCommand,
  useQuery,
} from "@forge-go/dashboard-plugin"
import type {
  ContextDimension,
  ContextOption,
  ForgePlugin,
} from "@forge-go/dashboard-plugin"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@forge-go/dashboard-kit/components/alert"
import { Spinner } from "@forge-go/dashboard-kit/components/spinner"
import { TriangleAlertIcon } from "@forge-go/dashboard-kit/icons"
import { clearQueries } from "./query-sync"

/**
 * The route param name a `path`-routed dimension owns, e.g. "app". Callers
 * only reach these with a dimension that actually declares `routed`, so the
 * assertion mirrors what `routedPathDimension`/`plugin.context.find` already
 * guaranteed at the call site.
 */
function routeParam(dimension: ContextDimension): string {
  return dimension.routed!.param
}

/**
 * The scope-relative path RoutedPicker lands you on once it knows which app
 * to redirect to: the plugin's own first nav item, same destination
 * PluginHost's `homePathFor` and ContextSwitchers' own switch-by-dropdown
 * both use for "into this scope, no page named yet". Redirecting to the bare
 * segment root instead ("/@auth/acme" with nothing after it) would land on a
 * path nothing is mounted at, for any plugin that -- like every one shipped
 * today -- declares no route at literal "/".
 *
 * A local copy rather than a shared import, for the same reason
 * ContextSwitchers keeps its own: PluginHost already imports this file, and
 * importing back from it would be a cycle for three lines of sorting.
 */
function firstNavPath(plugin: ForgePlugin): string {
  const first = [...plugin.nav].sort(
    (a, b) => (a.priority ?? 0) - (b.priority ?? 0)
  )[0]
  return first ? first.to : "/"
}

/**
 * The react-router path segment for a `path`-routed plugin's real pages:
 * ":app" for a dimension whose param is "app". This is a literal pattern,
 * not a value -- it is what lets ONE mounted route answer for every app
 * slug, independent of whichever one is currently open.
 */
export function routeSegmentPattern(dimension: ContextDimension): string {
  return `:${routeParam(dimension)}`
}

interface Resolved {
  current?: ContextOption
  options: ContextOption[]
}

interface ReconcileState {
  status: "loading" | "resolved" | "unavailable"
  current?: ContextOption
  options: ContextOption[]
  matched?: ContextOption
  error?: { code: string; message: string }
  /** The switch succeeded and the server still reports a different value. */
  stale?: boolean
}

/**
 * Reads one routed dimension's current value against a URL value already
 * pulled out of the address -- a path param for `path`, a search param for
 * `query` -- and reconciles the two the way the whole plan turns on: the URL
 * wins.
 *
 * On load and on every change, a URL value that names an option the server
 * disagrees with sends the switch command and only then clears the whole
 * store. Never the other way round: a clear that lands before the switch
 * settles wipes the wrong generation of cache. `onSwitched` fires after that
 * succeeds, which is what lets `RoutedPage` below drop a query param the
 * server just invalidated as a side effect of the switch.
 *
 * A URL value that names nothing in `options` is left alone here. Deciding
 * what that means -- an error page, or a value to quietly ignore -- belongs
 * to the two callers below, not to this hook. Either way it is never sent to
 * the server as a guess.
 */
function useReconcile(
  dimension: ContextDimension,
  urlValue: string | undefined,
  onSwitched?: () => void
): ReconcileState {
  const read = useQuery<unknown>(dimension.query)
  const switchTo = useCommand(dimension.switchCommand)
  const requestedRef = useRef<string | undefined>(undefined)
  // State, not a ref, and the distinction matters. `stale` below is computed
  // during render from this value, and a ref render reads is a value React
  // cannot see changing -- the disagreement would sit there until something
  // unrelated re-rendered the page. Setting state is what schedules the
  // render that puts the alert on screen.
  const [switched, setSwitched] = useState<string | undefined>(undefined)
  const onSwitchedRef = useRef(onSwitched)
  // Kept current in an effect, not written during render: a ref is not a
  // value render is allowed to touch, only something an effect or an event
  // handler may update. The reconciliation effect below reads it back
  // through the ref rather than closing over `onSwitched` directly, which is
  // what lets that effect's own deps list stay short.
  useEffect(() => {
    onSwitchedRef.current = onSwitched
  }, [onSwitched])

  const resolved: Resolved | undefined = read.data
    ? dimension.select(read.data)
    : undefined
  const matched =
    resolved && urlValue !== undefined
      ? resolved.options.find(
          (option) => urlValueOf(dimension, option) === urlValue
        )
      : undefined

  useEffect(() => {
    if (!resolved) return
    // `query` placement: an absent value means "whatever the server has."
    // `path` placement never reaches this hook with an absent value at all
    // -- RoutedPicker owns that case with a redirect. Either way, nothing to
    // reconcile.
    if (urlValue === undefined) return
    // Names nothing real. The caller renders an error instead of guessing,
    // and there is nothing here worth sending to the server.
    if (!matched) return
    if (matched.id === resolved.current?.id) {
      requestedRef.current = undefined
      return
    }
    // Already asked for this option and still waiting on the answer.
    // Re-firing on every render would repeat the same switch for as long as
    // the server takes to answer.
    if (requestedRef.current === matched.id || switchTo.loading) return
    requestedRef.current = matched.id

    void switchTo.execute(dimension.payload(matched.id)).then((result) => {
      if (result === undefined) return
      // Remember that this option was successfully switched to. If the server
      // still reports something else after the re-read below, the switch did
      // not take, and that is a state worth surfacing rather than living with.
      setSwitched(matched.id)
      // Every cached answer is about the option that was current a moment
      // ago. See queryStore.clear's own docs for why invalidates alone is
      // not enough. clearQueries also tells this origin's other tabs.
      clearQueries()
      onSwitchedRef.current?.()
    })
    // switchTo is a fresh object every render (useCommand's own contract);
    // only the values that describe *what to reconcile* belong in this
    // effect's deps, or it would resubscribe on every render for no reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlValue, matched?.id, resolved?.current?.id])

  return {
    // "unavailable" is its own state and not a flavour of loading. The
    // difference is the whole of this fix: a query that has failed will never
    // produce data, so treating it as still-loading renders a spinner that
    // spins until the tab closes.
    status: resolved ? "resolved" : read.error ? "unavailable" : "loading",
    current: resolved?.current,
    options: resolved?.options ?? [],
    matched,
    error: read.error,
    // The switch was accepted and the server still reports something else.
    //
    // Not hypothetical. Authsome's `apps.switch` writes a cookie that nothing
    // reads back: `AppIDFromPrincipal` resolves from `Principal.Claims`, and
    // nothing on the dashboard path ever populates claims, so `apps.context`
    // answers with the default app whatever was switched to. The command
    // succeeds, the store clears, the re-read says the same thing as before,
    // and the URL and the server disagree permanently.
    //
    // A fixture server holding its own state hides this completely, which is
    // how it reached a browser and passed.
    stale:
      resolved !== undefined &&
      switched !== undefined &&
      matched !== undefined &&
      switched === matched.id &&
      resolved.current?.id !== matched.id,
  }
}

/**
 * Shown when the dimension's own query cannot be read at all.
 *
 * Not an error page. The dashboard is still usable in this state: every
 * handler falls back to the server's default app, so the pages work, they are
 * simply not scoped by anything this shell can confirm. Blocking all of them
 * because a switcher query failed trades a degraded dashboard for no
 * dashboard, which is what the first version of this did -- a permanent
 * spinner and an empty sidebar, indistinguishable from the plugin never
 * having loaded.
 */
function ContextUnavailable({
  dimension,
  error,
}: {
  dimension: ContextDimension
  error?: { code: string; message: string }
}) {
  const noun = dimension.label.toLowerCase()
  return (
    <Alert>
      <TriangleAlertIcon />
      <AlertTitle>Cannot read the current {noun}</AlertTitle>
      <AlertDescription>
        {`${dimension.query} failed${error?.message ? `: ${error.message}` : ""}. `}
        Pages below are whatever the server scopes them to by default, and the
        {` ${noun} `}
        in the address is not being applied.
      </AlertDescription>
    </Alert>
  )
}

function LoadingRow() {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Spinner />
      Loading…
    </div>
  )
}

/**
 * Rendered in place of the page a URL value should have named, when it
 * names nothing real instead.
 *
 * Never a redirect to some default. Falling back to another option would
 * answer the URL you were given with somebody else's data under it, which
 * is the one outcome the whole reconciliation exists to rule out.
 */
function UnknownContextPanel({
  dimension,
  slug,
  Picker,
}: {
  dimension: ContextDimension
  slug?: string
  Picker?: ComponentType
}) {
  const noun = dimension.label.toLowerCase()
  return (
    <div className="flex flex-col gap-4">
      <Alert variant="destructive">
        <TriangleAlertIcon />
        <AlertTitle>Unknown {noun}</AlertTitle>
        <AlertDescription>
          {/*
            Phrased to need no article. The noun comes from whatever the
            plugin called its dimension, so "a {noun}" produces "a app" for
            App and "a environment" for Environment, and no amount of
            guessing at the first letter survives a dimension called "Org"
            or one named in another language.
          */}
          No {noun.toLowerCase()} matching {slug ? `"${slug}"` : "this URL"} is
          available to you.
        </AlertDescription>
      </Alert>
      {Picker && <Picker />}
    </div>
  )
}

/**
 * Guards a `query`-placed dimension's own value -- "?env=", say -- once the
 * page itself is already known to be about a real app.
 *
 * An absent value is not an error here, unlike the path gate below: it
 * means "whatever the server already has." A present value that names
 * nothing the current app has IS an error: the server rejects a switch to
 * an environment outside the current app, and guessing which one the
 * operator meant would be worse than saying so.
 */
function QueryContextGate({
  dimension,
  children,
}: {
  dimension: ContextDimension
  children: ReactNode
}) {
  const [params] = useSearchParams()
  const urlValue = params.get(routeParam(dimension)) ?? undefined
  const state = useReconcile(dimension, urlValue)

  if (urlValue !== undefined && state.status === "resolved" && !state.matched) {
    return <UnknownContextPanel dimension={dimension} slug={urlValue} />
  }

  return <>{children}</>
}

/**
 * Wraps the page a `path`-routed plugin mounted under its segment.
 *
 * Renders a loading row while the dimension's own query is still in flight,
 * the error panel above when the segment names nothing real, and otherwise
 * the page itself -- gated one level further by `QueryContextGate` for
 * whichever `query`-routed dimension this same plugin declares, "?env="
 * being the one this plan actually ships.
 *
 * Also owns dropping this plugin's own query-routed params off the URL the
 * moment a switch actually fires. The server clears the environment cookie
 * the instant the app cookie changes -- a different app has a different
 * environment list -- so carrying the old "?env=" value forward would leave
 * a slug from the app you just left sitting in the address bar of the app
 * you are now on.
 */
export function RoutedPage({
  plugin,
  dimension,
  children,
}: {
  plugin: ForgePlugin
  dimension: ContextDimension
  children: ReactNode
}) {
  const params = useParams()
  const segment = params[routeParam(dimension)]
  const location = useLocation()
  const locationRef = useRef(location)
  // Same reasoning as onSwitchedRef above: kept current in an effect so the
  // callback passed to useReconcile can read the latest location without
  // needing it in that hook's own dependency list.
  useEffect(() => {
    locationRef.current = location
  }, [location])

  /*
    No query params are stripped on a switch, and that is a deliberate
    reversal.

    Stripping them looked right: the server clears the environment cookie as a
    side effect of switching app, so an environment left in the URL would name
    something the server had just forgotten. But the query dimension has its
    own gate below, and it reconciles in both directions. An environment the
    new app HAS gets sent straight back, so the server ends up holding exactly
    what the URL asked for and the strip only robbed the address of it. An
    environment the new app does NOT have renders an error, which is what
    should happen to a URL naming something unavailable.

    So the strip was wrong whenever the operator had asked for that
    environment, and unnecessary whenever they had not. It cost the thing this
    whole change exists to provide: paste "/@auth/platform/users?env=staging"
    and the page was right, but the address bar had quietly dropped the
    environment, so passing that link on handed the next person a different
    one.
  */
  const state = useReconcile(dimension, segment)

  if (state.status === "loading") return <LoadingRow />
  if (state.stale) {
    // Show the page, with the disagreement named. The operator is looking at
    // the default scope's data under a URL that names a different one, and
    // saying nothing is the one option that leaves them believing the URL.
    return (
      <div className="flex flex-col gap-4">
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>
            This {dimension.label.toLowerCase()} did not take
          </AlertTitle>
          <AlertDescription>
            The switch was accepted and the server still reports
            {` ${state.current?.label ?? "something else"}`}. What is below is
            that one, not the {dimension.label.toLowerCase()} named in the
            address.
          </AlertDescription>
        </Alert>
        {children}
      </div>
    )
  }
  if (state.status === "unavailable") {
    // Warn and carry on. See ContextUnavailable for why this does not block.
    return (
      <div className="flex flex-col gap-4">
        <ContextUnavailable dimension={dimension} error={state.error} />
        {children}
      </div>
    )
  }
  if (!state.matched) {
    return (
      <UnknownContextPanel
        dimension={dimension}
        slug={segment}
        Picker={dimension.routed?.picker}
      />
    )
  }

  const envDimension = plugin.context.find(
    (d) => d.routed?.placement === "query"
  )

  return envDimension ? (
    <QueryContextGate dimension={envDimension}>{children}</QueryContextGate>
  ) : (
    <>{children}</>
  )
}

/**
 * Mounted at the namespace root -- "/@auth" exactly, never "/@auth/" -- for
 * a `path`-routed plugin.
 *
 * An account the server already has a current app for is sent straight to
 * it, so a bare "/@auth" does not sit there unscoped. An account with no
 * current app at all sees the dimension's own picker instead.
 */
/** The dimension's own picker, with nothing else around it. */
function PickerOnly({ dimension }: { dimension: ContextDimension }) {
  const Picker = dimension.routed?.picker
  return Picker ? <Picker /> : null
}

export function RoutedPicker({
  plugin,
  dimension,
}: {
  plugin: ForgePlugin
  dimension: ContextDimension
}) {
  const read = useQuery<unknown>(dimension.query)
  const { search } = useLocation()

  // Failed, not pending. `!read.data` alone cannot tell those apart, and
  // treating a failure as pending is what turned an unreadable app context
  // into a spinner nobody could get past.
  if (read.error && !read.data) {
    return (
      <div className="flex flex-col gap-4">
        <ContextUnavailable dimension={dimension} error={read.error} />
        {dimension.routed?.picker ? <PickerOnly dimension={dimension} /> : null}
      </div>
    )
  }
  if (!read.data) return <LoadingRow />

  const { current } = dimension.select(read.data)
  if (current) {
    const to = `${mountPath(plugin, firstNavPath(plugin), urlValueOf(dimension, current))}${search}`
    return <Navigate replace to={to} />
  }

  const Picker = dimension.routed?.picker
  return Picker ? <Picker /> : null
}
