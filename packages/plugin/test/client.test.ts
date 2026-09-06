import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ContractError, createScopedClient } from "../src/client"

const BASE = "/dashboard/api/dashboard/v1"

function mockFetch(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })
}

describe("createScopedClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("sends the contributor it was scoped to, not one the caller supplies", async () => {
    const fetchMock = mockFetch({ ok: true, envelope: "v1", kind: "query", data: { n: 1 } })
    const client = createScopedClient(BASE, "billing", fetchMock)

    await client.query("invoices.list", { page: 1 })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(BASE)
    const sent = JSON.parse(init.body)
    expect(sent.contributor).toBe("billing")
    expect(sent.kind).toBe("query")
    expect(sent.intent).toBe("invoices.list")
    expect(sent.params).toEqual({ page: 1 })
    expect(sent.envelope).toBe("v1")
  })

  it("returns the envelope's data, not the envelope", async () => {
    const fetchMock = mockFetch({ ok: true, envelope: "v1", kind: "query", data: { n: 7 } })
    const client = createScopedClient(BASE, "billing", fetchMock)

    await expect(client.query("x.y")).resolves.toEqual({ n: 7 })
  })

  it("throws a ContractError carrying the server's code", async () => {
    const fetchMock = mockFetch({
      ok: false,
      envelope: "v1",
      error: { code: "NOT_FOUND", message: "NOT_FOUND: nope" },
    })
    const client = createScopedClient(BASE, "billing", fetchMock)

    await expect(client.query("x.y")).rejects.toThrow(ContractError)
    await expect(client.query("x.y")).rejects.toMatchObject({ code: "NOT_FOUND" })
  })

  // What this pins is narrow and worth stating exactly: the default fetchImpl
  // invokes the global fetch *as a method of globalThis*, so it always has a
  // receiver. It does not prove a browser would have thrown without one -
  // neither jsdom nor undici enforces that, so the stub below does the
  // enforcing, and it is stricter than any real environment. The white-box
  // fact is the one the fix is about: `fetchImpl = fetch` calls with an
  // undefined receiver and fails here, the wrapper does not.
  it("calls the global fetch with a receiver when no fetchImpl is passed", async () => {
    const seen: unknown[] = []
    function receiverChecked(this: unknown, ...args: unknown[]) {
      if (this !== globalThis) {
        throw new TypeError("Illegal invocation")
      }
      seen.push(args[0])
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, envelope: "v1", data: { n: 3 } }),
      })
    }
    vi.stubGlobal("fetch", receiverChecked)

    const client = createScopedClient(BASE, "billing")

    await expect(client.query("x.y")).resolves.toEqual({ n: 3 })
    expect(seen).toEqual([BASE])
  })

  // A transport failure and a contract-level error are different things and the
  // caller has to be able to tell them apart.
  it("throws with a TRANSPORT code when the response is not ok", async () => {
    const fetchMock = mockFetch({}, 500)
    const client = createScopedClient(BASE, "billing", fetchMock)

    await expect(client.query("x.y")).rejects.toMatchObject({ code: "TRANSPORT" })
  })
})

// ---------------------------------------------------------------------------
// Commands
//
// A command is not a query with a different `kind`. The server rejects every
// command envelope missing a CSRF token or an idempotency key, and it runs
// that presence check before it looks at whether CSRF validation is even
// enabled. So these tests assert on the parsed request bodies, never on the
// mock's own shape: W2's version of this method passed a test that only
// checked `kind` and failed 100% of the time against a real server.
// ---------------------------------------------------------------------------

type SentEnvelope = Record<string, unknown>

interface StubResponse {
  status?: number
  body?: unknown
}

const OK_BODY = { ok: true, envelope: "v1", kind: "command", data: { done: true } }

function rejection(code: string, message = code) {
  return { ok: false, envelope: "v1", error: { code, message } }
}

function stub({ status = 200, body = {} }: StubResponse) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

/**
 * A fetch double that tells the CSRF endpoint apart from the contract endpoint,
 * hands out a different token on every refresh, and plays a scripted sequence
 * of contract responses (the last entry repeats). Handing out a fresh token per
 * refresh is what lets a test prove the retry carried a *new* token while
 * keeping the *same* idempotency key.
 */
function harness(options: { tokens?: string[]; contract?: StubResponse[] } = {}) {
  const tokens = options.tokens ?? ["tok-1", "tok-2", "tok-3"]
  const contract = options.contract ?? [{ body: OK_BODY }]
  const csrfInits: (RequestInit | undefined)[] = []
  const csrfURLs: string[] = []
  const sent: SentEnvelope[] = []
  let tokenIndex = 0
  let contractIndex = 0

  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).endsWith("/csrf")) {
      csrfURLs.push(String(url))
      csrfInits.push(init)
      const token = tokens[Math.min(tokenIndex, tokens.length - 1)]
      tokenIndex += 1
      return stub({ body: { token, expiresAt: "2026-09-06T12:00:00Z" } })
    }
    sent.push(JSON.parse(String(init?.body)) as SentEnvelope)
    const next = contract[Math.min(contractIndex, contract.length - 1)]
    contractIndex += 1
    return stub(next)
  })

  return {
    csrfInits,
    csrfURLs,
    sent,
    fetchMock,
    fetchImpl: fetchMock as unknown as typeof fetch,
  }
}

describe("ScopedClient.command", () => {
  it("sends kind command, the scoped contributor, an idempotency key and a csrf token", async () => {
    const h = harness()
    const client = createScopedClient(BASE, "billing", h.fetchImpl)

    await expect(client.command("session.login", { user: "rex" })).resolves.toEqual({
      done: true,
    })

    expect(h.sent).toHaveLength(1)
    const [envelope] = h.sent
    expect(envelope.envelope).toBe("v1")
    expect(envelope.kind).toBe("command")
    expect(envelope.contributor).toBe("billing")
    expect(envelope.intent).toBe("session.login")
    expect(envelope.payload).toEqual({ user: "rex" })
    expect(envelope.csrf).toBe("tok-1")
    expect(typeof envelope.idempotencyKey).toBe("string")
    expect(envelope.idempotencyKey).not.toBe("")
  })

  it("fetches the csrf token before the first command and caches it for the second", async () => {
    const h = harness()
    const client = createScopedClient(BASE, "billing", h.fetchImpl)

    await client.command("session.login")
    await client.command("session.logout")

    expect(h.csrfURLs).toEqual([`${BASE}/csrf`])
    expect(h.csrfInits[0]?.credentials).toBe("include")
    expect(h.sent.map((e) => e.csrf)).toEqual(["tok-1", "tok-1"])
  })

  it("sends no csrf and no idempotency key on a query, and fetches no token for one", async () => {
    const h = harness()
    const client = createScopedClient(BASE, "billing", h.fetchImpl)

    await client.query("invoices.list", { page: 1 })

    expect(h.csrfURLs).toEqual([])
    expect(h.sent).toHaveLength(1)
    expect(h.sent[0]).not.toHaveProperty("csrf")
    expect(h.sent[0]).not.toHaveProperty("idempotencyKey")
  })

  // The test this whole handshake note exists for. One logical command that
  // takes two HTTP attempts is still one command as far as the server's
  // deduplication is concerned, so the key minted for it must survive the
  // rebuild of the envelope. A second, different key on the retry would let
  // the server apply the same command twice.
  it("carries the identical idempotency key, and a refreshed token, into the retry", async () => {
    const h = harness({
      contract: [{ status: 401, body: rejection("UNAUTHENTICATED", "stale") }, { body: OK_BODY }],
    })
    const client = createScopedClient(BASE, "billing", h.fetchImpl)

    await expect(client.command("session.login", { user: "rex" })).resolves.toEqual({
      done: true,
    })

    expect(h.sent).toHaveLength(2)
    expect(h.sent[1].idempotencyKey).toBe(h.sent[0].idempotencyKey)
    expect(h.sent[0].csrf).toBe("tok-1")
    expect(h.sent[1].csrf).toBe("tok-2")
    expect(h.csrfURLs).toHaveLength(2)
  })

  it("retries exactly once: a second rejection is a real failure, not a loop", async () => {
    const h = harness({ contract: [{ status: 401, body: rejection("UNAUTHENTICATED") }] })
    const client = createScopedClient(BASE, "billing", h.fetchImpl)

    await expect(client.command("session.login")).rejects.toBeInstanceOf(ContractError)
    expect(h.sent).toHaveLength(2)
    expect(h.sent[1].idempotencyKey).toBe(h.sent[0].idempotencyKey)
  })

  it("uses a caller-supplied idempotency key, and keeps it across the retry", async () => {
    const h = harness({
      contract: [{ status: 401, body: rejection("UNAUTHENTICATED") }, { body: OK_BODY }],
    })
    const client = createScopedClient(BASE, "billing", h.fetchImpl)

    await client.command("session.login", { user: "rex" }, { idempotencyKey: "caller-key" })

    expect(h.sent.map((e) => e.idempotencyKey)).toEqual(["caller-key", "caller-key"])
  })

  // The response a stale token actually gets from this server. The Go
  // transport answers an unvalidatable CSRF token with 403 UNAUTHENTICATED
  // (contract/transport/http.go), not 401 - 401 comes from the auth
  // middleware, one layer out. A retry that only fires on 401 would therefore
  // never fire for the case the retry exists to handle.
  it("retries the 403 UNAUTHENTICATED that a stale token really gets", async () => {
    const h = harness({
      contract: [
        { status: 403, body: rejection("UNAUTHENTICATED", "csrf token invalid") },
        { body: OK_BODY },
      ],
    })
    const client = createScopedClient(BASE, "billing", h.fetchImpl)

    await expect(client.command("session.login")).resolves.toEqual({ done: true })
    expect(h.sent).toHaveLength(2)
    expect(h.sent[1].idempotencyKey).toBe(h.sent[0].idempotencyKey)
    expect(h.sent[1].csrf).toBe("tok-2")
  })

  // ...and the 403 that must not be retried. A denied permission is denied
  // twice just as hard, and re-sending the command is a second audit-logged
  // attempt at something the caller is not allowed to do.
  it("does not retry a 403 that denies permission rather than the token", async () => {
    const h = harness({ contract: [{ status: 403, body: rejection("PERMISSION_DENIED") }] })
    const client = createScopedClient(BASE, "billing", h.fetchImpl)

    await expect(client.command("session.login")).rejects.toBeInstanceOf(ContractError)
    expect(h.sent).toHaveLength(1)
    expect(h.csrfURLs).toHaveLength(1)
  })
})
