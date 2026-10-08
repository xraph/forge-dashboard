import type { ForgePlugin } from "@forge-go/dashboard-plugin"

/**
 * The search keys a plugin's context lives under: the `param` of every
 * dimension it routes into the query string (authsome's `env`).
 *
 * A `path`-routed dimension is not here because it already travels in the
 * path, and a cookie-only one never touches the URL at all.
 */
function contextKeys(plugin: ForgePlugin | undefined): Set<string> {
  const keys = new Set<string>()
  for (const dimension of plugin?.context ?? []) {
    if (dimension.routed?.placement === "query")
      keys.add(dimension.routed.param)
  }
  return keys
}

/**
 * The part of the current search that belongs to `plugin`'s context, ready to
 * carry to another of its pages. `""` when there is none.
 *
 * Everything else in the search belongs to the page you are leaving. A key
 * list filtered by `?keyId=` is one page's state, and carrying it into the
 * sidebar's every link handed that filter to pages that never asked for it.
 * Context is different: `?env=prod` is what the whole scope is being read
 * through, and dropping it on a click would quietly change the environment.
 */
export function contextSearch(
  search: string,
  plugin: ForgePlugin | undefined
): string {
  const keys = contextKeys(plugin)
  if (keys.size === 0) return ""
  const kept = new URLSearchParams()
  for (const [key, value] of new URLSearchParams(search)) {
    if (keys.has(key)) kept.append(key, value)
  }
  const query = kept.toString()
  return query ? `?${query}` : ""
}

/**
 * Adds carried context to a path that may already have a query of its own.
 *
 * `to`'s own params win: a link that names `?env=dev` means dev, whatever the
 * page it sits on is reading. Context only fills keys `to` leaves unset. The
 * merge appends rather than reserialising, so `to`'s own query and fragment
 * come out exactly as written.
 *
 * Plain concatenation is what this replaces, and it turned `/x?a=1` plus a
 * carried `?b=2` into `/x?a=1?b=2`, whose `a` reads as `1?b=2`.
 */
export function withContext(to: string, context: string): string {
  if (!context || context === "?") return to
  const hashAt = to.indexOf("#")
  const hash = hashAt === -1 ? "" : to.slice(hashAt)
  const beforeHash = hashAt === -1 ? to : to.slice(0, hashAt)
  const queryAt = beforeHash.indexOf("?")
  if (queryAt === -1) return `${beforeHash}${context}${hash}`

  const own = new URLSearchParams(beforeHash.slice(queryAt + 1))
  const extra = new URLSearchParams()
  for (const [key, value] of new URLSearchParams(context)) {
    if (!own.has(key)) extra.append(key, value)
  }
  const added = extra.toString()
  if (!added) return to
  const separator =
    beforeHash.endsWith("?") || beforeHash.endsWith("&") ? "" : "&"
  return `${beforeHash}${separator}${added}${hash}`
}
