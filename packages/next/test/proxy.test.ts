import { describe, expect, it, vi } from "vitest"
import { createForgeProxy } from "../src/proxy"

function ctx(path: string[]) {
  return { params: Promise.resolve({ path }) }
}

describe("createForgeProxy", () => {
  it("forwards the path segments to the target", async () => {
    const upstream = vi.fn<(req: Request) => Promise<Response>>(
      async () => new Response("{}", { status: 200 })
    )
    const { GET } = createForgeProxy({
      target: "https://forge.internal",
      fetchImpl: upstream as unknown as typeof fetch,
    })

    await GET(
      new Request("https://app.test/api/forge/dashboard/v1/csrf"),
      ctx(["dashboard", "v1", "csrf"])
    )

    const called = upstream.mock.calls[0][0]
    expect(called.url).toBe("https://forge.internal/dashboard/v1/csrf")
  })

  it("injects configured headers without exposing them downstream", async () => {
    const upstream = vi.fn<(req: Request) => Promise<Response>>(
      async () => new Response("{}", { status: 200 })
    )
    const { POST } = createForgeProxy({
      target: "https://forge.internal",
      headers: { Authorization: "Bearer secret-token" },
      fetchImpl: upstream as unknown as typeof fetch,
    })

    const res = await POST(
      new Request("https://app.test/api/forge/dashboard/v1", {
        method: "POST",
        body: "{}",
      }),
      ctx(["dashboard", "v1"])
    )

    const called = upstream.mock.calls[0][0]
    expect(called.headers.get("Authorization")).toBe("Bearer secret-token")
    expect(res.headers.get("Authorization")).toBeNull()
    expect(await res.text()).not.toContain("secret-token")
  })

  it("preserves the upstream status", async () => {
    const upstream = vi.fn<(req: Request) => Promise<Response>>(
      async () => new Response("nope", { status: 403 })
    )
    const { GET } = createForgeProxy({
      target: "https://forge.internal",
      fetchImpl: upstream as unknown as typeof fetch,
    })

    const res = await GET(
      new Request("https://app.test/api/forge/x"),
      ctx(["x"])
    )
    expect(res.status).toBe(403)
  })

  it("rejects a path that tries to escape the target prefix", async () => {
    const upstream = vi.fn<(req: Request) => Promise<Response>>(
      async () => new Response("{}", { status: 200 })
    )
    const { GET } = createForgeProxy({
      target: "https://forge.internal",
      fetchImpl: upstream as unknown as typeof fetch,
    })

    const res = await GET(
      new Request("https://app.test/api/forge/x"),
      ctx(["..", "..", "admin"])
    )
    expect(res.status).toBe(400)
    expect(upstream).not.toHaveBeenCalled()
  })

  it("rejects a backslash segment that could hijack the upstream host", async () => {
    // Resolving "\\/evil.example.com/steal" against a base URL lets the
    // WHATWG URL parser read "evil.example.com" as a new authority, not a
    // path segment - a literal "/" check alone does not catch this because
    // the malicious character is "\", not "/".
    const upstream = vi.fn<(req: Request) => Promise<Response>>(
      async () => new Response("{}", { status: 200 })
    )
    const { GET } = createForgeProxy({
      target: "https://forge.internal",
      fetchImpl: upstream as unknown as typeof fetch,
    })

    const res = await GET(
      new Request("https://app.test/api/forge/x"),
      ctx(["\\", "evil.example.com", "steal"])
    )
    expect(res.status).toBe(400)
    expect(upstream).not.toHaveBeenCalled()
  })

  it("rejects percent-encoded dot segments that would otherwise escape the target prefix", async () => {
    // "%2e%2e" is not the literal string "..", so a naive equality check
    // misses it - but the WHATWG URL Standard still recognizes it as a
    // double-dot path segment and collapses it during resolution, climbing
    // out of the target's path prefix exactly like a literal ".." would.
    const upstream = vi.fn<(req: Request) => Promise<Response>>(
      async () => new Response("{}", { status: 200 })
    )
    const { GET } = createForgeProxy({
      target: "https://forge.internal/proxy-base",
      fetchImpl: upstream as unknown as typeof fetch,
    })

    const res = await GET(
      new Request("https://app.test/api/forge/x"),
      ctx(["%2e%2e", "%2e%2e", "admin"])
    )
    expect(res.status).toBe(400)
    expect(upstream).not.toHaveBeenCalled()
  })

  it("does not forward an upstream redirect, so an injected header can't be exfiltrated to another host", async () => {
    // Real fetch() defaults to redirect: "follow", which would chase a 3xx
    // from upstream invisibly - carrying the injected header to whatever
    // host its Location points at. redirect: "manual" is what stops that;
    // this test asserts on the visible half of the fix (the response), and
    // the header-sanitization test below asserts the outgoing Request is
    // actually configured with redirect: "manual".
    const upstream = vi.fn<(req: Request) => Promise<Response>>(
      async () =>
        new Response(null, {
          status: 302,
          headers: { Location: "http://other-host.example/stolen" },
        })
    )
    const { GET } = createForgeProxy({
      target: "https://forge.internal",
      headers: { "X-Forge-Key": "CUSTOM-SECRET" },
      fetchImpl: upstream as unknown as typeof fetch,
    })

    const res = await GET(
      new Request("https://app.test/api/forge/x"),
      ctx(["x"])
    )

    expect(upstream).toHaveBeenCalledTimes(1)
    const called = upstream.mock.calls[0][0]
    expect(called.redirect).toBe("manual")
    expect(res.status).toBe(502)
    expect(res.headers.get("location")).toBeNull()
    expect(await res.text()).not.toContain("CUSTOM-SECRET")
  })

  it("strips hop-by-hop and forwarding-trust headers before contacting upstream", async () => {
    const upstream = vi.fn<(req: Request) => Promise<Response>>(
      async () => new Response("{}", { status: 200 })
    )
    const { GET } = createForgeProxy({
      target: "https://forge.internal",
      fetchImpl: upstream as unknown as typeof fetch,
    })

    await GET(
      new Request("https://app.test/api/forge/x", {
        headers: {
          Connection: "keep-alive",
          "Transfer-Encoding": "chunked",
          "Content-Length": "999",
          "X-Forwarded-For": "1.2.3.4",
          "X-Forwarded-Host": "evil.example",
          "X-Real-IP": "1.2.3.4",
          Trailer: "X-Checksum",
          "Proxy-Authorization": "Basic evil",
        },
      }),
      ctx(["x"])
    )

    const called = upstream.mock.calls[0][0]
    expect(called.headers.get("connection")).toBeNull()
    expect(called.headers.get("transfer-encoding")).toBeNull()
    expect(called.headers.get("content-length")).toBeNull()
    expect(called.headers.get("x-forwarded-for")).toBeNull()
    expect(called.headers.get("x-forwarded-host")).toBeNull()
    expect(called.headers.get("x-real-ip")).toBeNull()
    expect(called.headers.get("trailer")).toBeNull()
    expect(called.headers.get("proxy-authorization")).toBeNull()
  })

  it("returns a clean 502 instead of throwing when the upstream fetch rejects", async () => {
    // A real HTTP client (undici) throws for things like a malformed
    // Transfer-Encoding/Content-Length pairing. Uncaught, that becomes an
    // unhandled exception - a client-triggerable 500 with a stack trace.
    const upstream = vi.fn<(req: Request) => Promise<Response>>(async () => {
      throw new Error("RequestContentLengthMismatchError: boom")
    })
    const { GET } = createForgeProxy({
      target: "https://forge.internal",
      fetchImpl: upstream as unknown as typeof fetch,
    })

    const res = await GET(
      new Request("https://app.test/api/forge/x"),
      ctx(["x"])
    )
    expect(res.status).toBe(502)
    expect(await res.text()).not.toContain("RequestContentLengthMismatchError")
  })

  it("preserves multiple Set-Cookie headers instead of collapsing them into one", async () => {
    const upstream = vi.fn<(req: Request) => Promise<Response>>(async () => {
      const headers = new Headers()
      headers.append("Set-Cookie", "session=abc; Path=/; HttpOnly")
      headers.append("Set-Cookie", "csrf=def; Path=/")
      return new Response("{}", { status: 200, headers })
    })
    const { GET } = createForgeProxy({
      target: "https://forge.internal",
      fetchImpl: upstream as unknown as typeof fetch,
    })

    const res = await GET(
      new Request("https://app.test/api/forge/x"),
      ctx(["x"])
    )
    expect(res.headers.getSetCookie()).toEqual([
      "session=abc; Path=/; HttpOnly",
      "csrf=def; Path=/",
    ])
  })

  it("preserves Cache-Control so a token response can't become cacheable by a shared cache", async () => {
    const upstream = vi.fn<(req: Request) => Promise<Response>>(
      async () =>
        new Response("{}", {
          status: 200,
          headers: { "Cache-Control": "no-store" },
        })
    )
    const { GET } = createForgeProxy({
      target: "https://forge.internal",
      fetchImpl: upstream as unknown as typeof fetch,
    })

    const res = await GET(
      new Request("https://app.test/api/forge/x"),
      ctx(["x"])
    )
    expect(res.headers.get("cache-control")).toBe("no-store")
  })

  it("does not disclose the target host via an upstream Location header", async () => {
    // A 201 Created from a POST typically carries an absolute Location for
    // the new resource. Forwarding it verbatim would leak `target` - a
    // server-side secret - to the browser, the same class of disclosure the
    // redirect handling above closes off, just on a non-redirect status.
    const upstream = vi.fn<(req: Request) => Promise<Response>>(
      async () =>
        new Response("{}", {
          status: 201,
          headers: {
            Location: "https://forge.internal/dashboard/v1/items/123",
          },
        })
    )
    const { POST } = createForgeProxy({
      target: "https://forge.internal",
      fetchImpl: upstream as unknown as typeof fetch,
    })

    const res = await POST(
      new Request("https://app.test/api/forge/dashboard/v1/items", {
        method: "POST",
        body: "{}",
      }),
      ctx(["dashboard", "v1", "items"])
    )

    expect(res.status).toBe(201)
    expect(res.headers.get("location")).toBeNull()
    expect(await res.text()).not.toContain("forge.internal")
  })

  it("forwards the inbound query string to the upstream request", async () => {
    const upstream = vi.fn<(req: Request) => Promise<Response>>(
      async () => new Response("{}", { status: 200 })
    )
    const { GET } = createForgeProxy({
      target: "https://forge.internal",
      fetchImpl: upstream as unknown as typeof fetch,
    })

    await GET(
      new Request(
        "https://app.test/api/forge/dashboard/v1/list?limit=20&cursor=abc"
      ),
      ctx(["dashboard", "v1", "list"])
    )

    const called = upstream.mock.calls[0][0]
    expect(called.url).toBe(
      "https://forge.internal/dashboard/v1/list?limit=20&cursor=abc"
    )
  })

  it("validates the target URL once, at construction, rejecting non-http(s) schemes", () => {
    expect(() => createForgeProxy({ target: "not a url" })).toThrow()
    expect(() => createForgeProxy({ target: "file:///etc/passwd" })).toThrow()
  })
})
