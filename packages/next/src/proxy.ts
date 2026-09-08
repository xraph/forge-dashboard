export interface ForgeProxyOptions {
  /** Base URL of the forge server. Server-side only; never sent to the browser. */
  target: string
  /** Headers added to every upstream request, e.g. a service token. */
  headers?: Record<string, string>
  /** Injected in tests. */
  fetchImpl?: typeof fetch
}

type RouteContext = { params: Promise<{ path: string[] }> }

/**
 * True for a segment the WHATWG URL Standard treats as a "single dot" or
 * "double dot" path segment during resolution: "." / "..", or one of their
 * percent-encoded aliases (".%2e", "%2e.", "%2e%2e", case-insensitively).
 * `new URL()` normalizes these away when it resolves a relative reference
 * against a base, so a literal `segment === ".."` check alone can be
 * bypassed by writing the dots as "%2e" - the segment fails that check, but
 * the URL constructor still collapses it and climbs out of the target
 * prefix. Collapsing "%2e" to "." before comparing catches every alias the
 * spec recognizes without a general (and riskier) percent-decode.
 */
function isDotSegment(segment: string): boolean {
  const collapsed = segment.replace(/%2e/gi, ".")
  return collapsed === "." || collapsed === ".."
}

/**
 * Builds the upstream URL, refusing any segment that could climb out of the
 * target prefix or hijack the upstream host. A caller controls these
 * segments through the request path, so anything resembling ".." (including
 * its percent-encoded aliases) is rejected rather than normalized: silently
 * normalizing a traversal attempt turns it into a request to some other
 * endpoint on the forge server.
 *
 * Segments are also rejected if they contain "/" or "\". Both are path
 * separators as far as the WHATWG URL Standard is concerned for special
 * schemes like https - a segment that is just "\" resolved against a base
 * can hand the *next* segment to the parser as a new authority, letting a
 * crafted path redirect the proxy's own fetch to an attacker-chosen host
 * entirely (e.g. segments ["\\", "evil.example.com"] resolving to
 * "https://evil.example.com/").
 */
function upstreamURL(target: string, segments: string[]): URL | null {
  if (
    segments.some((s) => s.includes("/") || s.includes("\\") || isDotSegment(s))
  ) {
    return null
  }

  const base = new URL(target.endsWith("/") ? target : `${target}/`)

  let url: URL
  try {
    // Re-encode each segment before joining so nothing already in it (stray
    // "%" sequences, reserved characters, etc.) is reinterpreted by the URL
    // parser during resolution.
    url = new URL(segments.map(encodeURIComponent).join("/"), base)
  } catch {
    return null
  }

  // Defense in depth: confirm the resolved URL is still under the target's
  // origin and path prefix. This is a belt-and-suspenders check against any
  // URL-parsing behavior the guards above did not anticipate - it does not
  // replace them, since the guards above are what produce a clean 400
  // instead of a request that merely turns out, after the fact, not to have
  // gone anywhere useful.
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) {
    return null
  }

  return url
}

function handler(method: "GET" | "POST", options: ForgeProxyOptions) {
  const doFetch = options.fetchImpl ?? fetch

  return async (req: Request, ctx: RouteContext): Promise<Response> => {
    const { path } = await ctx.params
    const url = upstreamURL(options.target, path ?? [])
    if (url === null) {
      return new Response("bad path", { status: 400 })
    }

    const headers = new Headers(req.headers)
    // Host belongs to the incoming request, not the upstream one.
    headers.delete("host")
    for (const [k, v] of Object.entries(options.headers ?? {})) {
      headers.set(k, v)
    }

    const upstream = await doFetch(
      new Request(url.toString(), {
        method,
        headers,
        body: method === "POST" ? await req.text() : undefined,
      })
    )

    // Rebuild the response so upstream hop-by-hop headers and anything
    // injected above cannot leak back to the browser.
    const out = new Headers()
    const contentType = upstream.headers.get("content-type")
    if (contentType) out.set("content-type", contentType)
    const setCookie = upstream.headers.get("set-cookie")
    if (setCookie) out.set("set-cookie", setCookie)

    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: out,
    })
  }
}

export function createForgeProxy(options: ForgeProxyOptions) {
  return {
    GET: handler("GET", options),
    POST: handler("POST", options),
  }
}
