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
 * Parses and validates `target` once, at `createForgeProxy()` time, instead
 * of on every request. Two things matter here: an invalid URL should fail
 * loudly at startup rather than as a per-request 500, and only http/https
 * are acceptable - without a scheme check, a misconfigured or attacker-
 * influenced `target` like "file:///etc" would resolve requests straight
 * off the network entirely.
 */
function parseTarget(target: string): URL {
  let base: URL
  try {
    base = new URL(target)
  } catch {
    throw new Error(`createForgeProxy: "target" is not a valid URL: ${target}`)
  }
  if (base.protocol !== "http:" && base.protocol !== "https:") {
    throw new Error(
      `createForgeProxy: "target" must use http or https, got "${base.protocol}"`
    )
  }
  if (!base.pathname.endsWith("/")) {
    base.pathname = `${base.pathname}/`
  }
  return base
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
 *
 * The inbound query string is forwarded deliberately: this handler fronts
 * the whole forge dashboard API, not one fixed endpoint, and several of its
 * routes (listing, pagination) are expected to take query parameters.
 */
function upstreamURL(
  base: URL,
  segments: string[],
  search: string
): URL | null {
  if (
    segments.some((s) => s.includes("/") || s.includes("\\") || isDotSegment(s))
  ) {
    return null
  }

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

  url.search = search
  return url
}

/**
 * Headers stripped from the inbound request before it is forwarded upstream.
 * Two different concerns share this list: connection-management headers are
 * per-hop, not per-resource, and forwarding them can desync the upstream
 * connection or make the HTTP client reject the request outright (undici
 * throws on a "transfer-encoding" it doesn't expect, or on a
 * "content-length" that no longer matches once the body has been re-read as
 * text) - and "x-forwarded-*" / "x-real-ip" are trust signals that must come
 * from this proxy's own network position, never from whatever a browser
 * client chose to send.
 */
const STRIPPED_REQUEST_HEADERS = new Set([
  "host",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "te",
  "upgrade",
  "content-length",
  "x-real-ip",
])

function sanitizeRequestHeaders(source: Headers): Headers {
  const out = new Headers(source)
  for (const name of Array.from(out.keys())) {
    if (STRIPPED_REQUEST_HEADERS.has(name) || name.startsWith("x-forwarded-")) {
      out.delete(name)
    }
  }
  return out
}

/**
 * Response headers preserved verbatim. Everything else - including anything
 * hop-by-hop, and anything this proxy itself injected into the upstream
 * request - is dropped, because the response is rebuilt from scratch below
 * rather than forwarding upstream's headers as-is. "cache-control" matters
 * so an upstream "no-store" on something like a CSRF token endpoint survives
 * the proxy instead of leaving the response heuristically cacheable.
 */
const FORWARDED_RESPONSE_HEADERS = [
  "content-type",
  "cache-control",
  "location",
  "www-authenticate",
  "retry-after",
  "content-disposition",
]

function handler(
  method: "GET" | "POST",
  base: URL,
  options: ForgeProxyOptions
) {
  const doFetch = options.fetchImpl ?? fetch

  return async (req: Request, ctx: RouteContext): Promise<Response> => {
    const { path } = await ctx.params
    const incoming = new URL(req.url)
    const url = upstreamURL(base, path ?? [], incoming.search)
    if (url === null) {
      return new Response("bad path", { status: 400 })
    }

    const headers = sanitizeRequestHeaders(req.headers)
    for (const [k, v] of Object.entries(options.headers ?? {})) {
      headers.set(k, v)
    }

    let upstream: Response
    try {
      upstream = await doFetch(
        new Request(url.toString(), {
          method,
          headers,
          // Never let fetch() auto-follow a redirect: doing so invisibly
          // re-sends this request - injected headers included - to
          // whatever host the upstream's Location points at. That is a
          // direct exfiltration path for a secret like a service token.
          redirect: "manual",
          body: method === "POST" ? await req.text() : undefined,
        })
      )
    } catch {
      // A transport-level failure (connection refused, a client rejecting
      // a malformed Transfer-Encoding/Content-Length pairing, etc.) must
      // not surface as an unhandled exception - an uncaught throw here is
      // both a stack-trace information leak and a client-triggerable 500.
      return new Response("bad gateway", { status: 502 })
    }

    if (upstream.status >= 300 && upstream.status < 400) {
      // Redirects are never forwarded. Passing the Location through would
      // expose `target` - a server-side secret - to the browser; resolving
      // and following it here ourselves would extend the trust placed in
      // `target` (and the headers injected above) to whatever host the
      // Location names. `redirect: "manual"` above only stops fetch() from
      // chasing it invisibly; this is what stops the proxy from forwarding
      // it another way.
      return new Response("bad gateway", { status: 502 })
    }

    // Rebuild the response so upstream hop-by-hop headers and anything
    // injected above cannot leak back to the browser.
    const out = new Headers()
    for (const name of FORWARDED_RESPONSE_HEADERS) {
      const value = upstream.headers.get(name)
      if (value) out.set(name, value)
    }
    // set-cookie is uniquely multi-valued: Headers.get() joins repeated
    // values with ", " which is not a valid Cookie serialization, so a
    // second upstream cookie silently disappears for the browser unless
    // each is read and re-appended individually.
    for (const cookie of upstream.headers.getSetCookie()) {
      out.append("set-cookie", cookie)
    }

    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: out,
    })
  }
}

export function createForgeProxy(options: ForgeProxyOptions) {
  const base = parseTarget(options.target)
  return {
    GET: handler("GET", base, options),
    POST: handler("POST", base, options),
  }
}
