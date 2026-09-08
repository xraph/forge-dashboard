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
})
