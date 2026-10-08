import { useId } from "react"
import { useLocation, useNavigate } from "react-router"
import {
  useCommand,
  useQuery,
  mountPath,
  urlValueOf,
} from "@forge-go/dashboard-plugin"
import type { ContextDimension, ForgePlugin } from "@forge-go/dashboard-plugin"
import {
  NativeSelect,
  NativeSelectOption,
} from "@forge-go/dashboard-kit/components/native-select"
import { clearQueries } from "./query-sync"

/**
 * Where a routed dimension's own picker send you when you switch apps from
 * the dropdown rather than by following a link: the target app's first nav
 * item, the same destination `selectScope` in PluginHost lands you on when
 * switching scope. A small local copy rather than an import from PluginHost,
 * because that file already imports this one -- a cycle neither module needs
 * for three lines of sorting.
 */
function firstNavItem(plugin: ForgePlugin) {
  return [...plugin.nav].sort(
    (a, b) => (a.priority ?? 0) - (b.priority ?? 0)
  )[0]
}

function Dimension({
  dimension,
  plugin,
}: {
  dimension: ContextDimension
  plugin?: ForgePlugin
}) {
  const id = useId()
  const read = useQuery(dimension.query)
  const switchTo = useCommand(dimension.switchCommand)
  const navigate = useNavigate()
  const { pathname, search } = useLocation()

  // Nothing to switch between until the read lands. Rendering an empty select
  // in the meantime would let somebody pick "nothing" out of it.
  if (!read.data) return null

  const { current, options } = dimension.select(read.data)
  if (options.length === 0) return null

  async function select(optionId: string) {
    const routed = dimension.routed
    if (routed && plugin) {
      // A routed dimension stops sending the command from here. It
      // navigates, and the reconciliation mounted on the routed pages does
      // the rest -- one path in, so the URL and the server's cookie can
      // never disagree about who decided.
      const option = options.find((o) => o.id === optionId)
      if (!option) return
      const value = urlValueOf(dimension, option)

      if (routed.placement === "path") {
        const first = firstNavItem(plugin)
        navigate(mountPath(plugin, first ? first.to : "/", value))
        return
      }

      const next = new URLSearchParams(search)
      next.set(routed.param, value)
      navigate(`${pathname}?${next.toString()}`)
      return
    }

    const result = await switchTo.execute(dimension.payload(optionId))
    if (result === undefined) return

    // Everything, not just what meta.invalidates named. The cookie changed, so
    // every read in the dashboard is now a question about a different app, and
    // the server has no way to enumerate that. This is the one place the store
    // throws away more than it was told to. The other tabs of this origin
    // share the cookie, so clearQueries tells them as well.
    clearQueries()
  }

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs text-muted-foreground">
        {dimension.label}
      </label>
      <NativeSelect
        id={id}
        value={current?.id ?? ""}
        disabled={switchTo.loading}
        onChange={(event) => void select(event.target.value)}
        className="w-full"
      >
        {options.map((option) => (
          <NativeSelectOption key={option.id} value={option.id}>
            {option.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  )
}

/**
 * The scope-wide selectors, rendered into the sidebar under the scope
 * switcher.
 *
 * The host has no idea what an app or an environment is. It reads whatever
 * intent the plugin named, projects it through the plugin's own `select`, and
 * sends the plugin's own command. Authsome declares two dimensions; core and
 * streaming declare none and this renders nothing for them.
 *
 * Two dimensions sharing one query is the normal case, not an edge case: both
 * of authsome's read `apps.context`. The store collapses that to a single
 * request, which is the reason this component can be this naive.
 */
export function ContextSwitchers({
  dimensions,
  plugin,
}: {
  dimensions: ContextDimension[]
  /**
   * The plugin these dimensions belong to. Optional because a cookie-only
   * dimension (no `routed`) never needs it; a routed one does, to build the
   * app-switch destination. Every real caller has a plugin to hand; tests
   * exercising cookie-only dimensions do not need to invent one.
   */
  plugin?: ForgePlugin
}) {
  if (dimensions.length === 0) return null

  return (
    <div className="flex flex-col gap-2 px-2 py-1">
      {dimensions.map((dimension) => (
        <Dimension key={dimension.id} dimension={dimension} plugin={plugin} />
      ))}
    </div>
  )
}
