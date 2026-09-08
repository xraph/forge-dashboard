export interface ForgeProxyOptions {
  /** Base URL of the forge server. Server-side only; never sent to the browser. */
  target: string
  /** Headers added to every upstream request, e.g. a service token. */
  headers?: Record<string, string>
  /**
   * Maximum accepted request body size, in bytes. Next.js route handlers
   * impose no limit of their own, so an unbounded `await req.text()` is a
   * memory-exhaustion vector against the consumer's own app server - a
   * single large POST gets fully buffered regardless of what (or whether)
   * Content-Length claims. Defaults to 1 MiB; raise it if a forge command
   * legitimately needs a larger payload.
   */
  maxBodyBytes?: number
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

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024 // 1 MiB

function concatChunks(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

/**
 * Reads `req`'s body as text, rejecting it once more than `maxBytes` has
 * arrived rather than trusting Content-Length (which can be absent, or -
 * with chunked transfer-encoding - simply not describe the eventual size at
 * all) and buffering an unbounded amount into memory first.
 */
async function readBodyWithLimit(
  req: Request,
  maxBytes: number
): Promise<{ ok: true; body: string } | { ok: false }> {
  const reader = req.body?.getReader()
  if (!reader) {
    return { ok: true, body: "" }
  }

  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      return { ok: false }
    }
    chunks.push(value)
  }

  return {
    ok: true,
    body: new TextDecoder().decode(concatChunks(chunks, total)),
  }
}

/**
 * Statuses the Fetch/Response spec forbids pairing with a body at all - the
 * Response constructor throws "Invalid response status code" if it is given
 * one anyway. 204 and 304 in particular are ordinary, expected responses
 * (a write with no payload; a successful cache revalidation), not edge
 * cases, so this can't be left to the transport catch above.
 */
const NULL_BODY_STATUSES = new Set([204, 205, 304])

/**
 * Headers stripped from the inbound request before it is forwarded upstream.
 * Two different concerns share this list: connection-management headers -
 * the classic hop-by-hop set ("connection", "keep-alive",
 * "transfer-encoding", "te", "upgrade", "trailer", "proxy-authorization") -
 * are per-hop, not per-resource, and forwarding them can desync the
 * upstream connection or make the HTTP client reject the request outright
 * (undici throws on a "transfer-encoding" it doesn't expect, or on a
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
  "trailer",
  "proxy-authorization",
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
 *
 * "location" is deliberately excluded, even for a non-redirect response
 * like a 201 Created: `target` is a server-side secret, and an upstream
 * Location is typically absolute (e.g.
 * "https://forge.internal/dashboard/v1/items/123"), so forwarding it
 * verbatim would disclose the target host to the browser on exactly the
 * same class of path the redirect handling above closes off. A dashboard
 * client proxied through this route has no legitimate use for an absolute
 * upstream Location anyway.
 */
const FORWARDED_RESPONSE_HEADERS = [
  "content-type",
  "cache-control",
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

    let body: string | undefined
    if (method === "POST") {
      const read = await readBodyWithLimit(
        req,
        options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES
      )
      if (!read.ok) {
        return new Response("payload too large", { status: 413 })
      }
      body = read.body
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
          body,
        })
      )
    } catch {
      // A transport-level failure (connection refused, a client rejecting
      // a malformed Transfer-Encoding/Content-Length pairing, etc.) must
      // not surface as an unhandled exception - an uncaught throw here is
      // both a stack-trace information leak and a client-triggerable 500.
      return new Response("bad gateway", { status: 502 })
    }

    if (
      upstream.status >= 300 &&
      upstream.status < 400 &&
      upstream.status !== 304
    ) {
      // Redirects are never forwarded. Passing the Location through would
      // expose `target` - a server-side secret - to the browser; resolving
      // and following it here ourselves would extend the trust placed in
      // `target` (and the headers injected above) to whatever host the
      // Location names. `redirect: "manual"` above only stops fetch() from
      // chasing it invisibly; this is what stops the proxy from forwarding
      // it another way. 304 Not Modified is excluded: it is not a
      // redirect, it's a successful cache validation response.
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

    const text = await upstream.text()

    return new Response(NULL_BODY_STATUSES.has(upstream.status) ? null : text, {
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
