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
  it("throws with a TRANSPORT code when the response is not ok and carries no error code", async () => {
    const fetchMock = mockFetch({}, 500)
    const client = createScopedClient(BASE, "billing", fetchMock)

    await expect(client.query("x.y")).rejects.toMatchObject({ code: "TRANSPORT" })
  })

  // The defect this file was fixed for: the Go transport answers a
  // handler-level failure with a non-2xx status but the same error envelope a
  // 200 carries in its `!envelope.ok` branch. Discarding the body meant every
  // one of these came back as an undifferentiated "HTTP 500" instead of the
  // real code and message.
  it("throws with the server's code and message when a non-ok response carries an error envelope", async () => {
    const fetchMock = mockFetch(
      { ok: false, envelope: "v1", error: { code: "NOT_FOUND", message: "no such room" } },
      500,
    )
    const client = createScopedClient(BASE, "billing", fetchMock)

    await expect(client.query("rooms.delete", { id: "nope" })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "no such room",
    })
  })

  // A `Response` whose body is empty (no content at all) rejects `res.json()`
  // rather than resolving to something with no `error` field - this is the
  // bare 403 the auth middleware sends (Task 1), and any other endpoint that
  // answers non-ok with nothing readable as JSON.
  it("falls back to TRANSPORT when the non-ok response has no body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => {
        throw new SyntaxError("Unexpected end of JSON input")
      },
    })
    const client = createScopedClient(BASE, "billing", fetchMock)

    await expect(client.query("x.y")).rejects.toMatchObject({ code: "TRANSPORT" })
  })

  // A proxy's 502 with an HTML body must not turn into an exception about
  // JSON parsing - it should fall back to the same TRANSPORT error a status
  // with no body at all gets.
  it("falls back to TRANSPORT when the non-ok response body is not valid JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new SyntaxError("Unexpected token < in JSON at position 0")
      },
    })
    const client = createScopedClient(BASE, "billing", fetchMock)

    await expect(client.query("x.y")).rejects.toMatchObject({ code: "TRANSPORT" })
  })

  // The same hazard on the other branch of the same `if`. A reverse proxy or
  // an SSO interstitial can answer 200 with an HTML body, and an unguarded
  // `res.json()` on the success path throws a raw SyntaxError that `hooks.ts`
  // casts to a ContractError with no code - the page renders "undefined:
  // Unexpected token '<'", which reads as a crash.
  it("falls back to TRANSPORT when an ok response body is not valid JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token '<', \"<html>\"... is not valid JSON")
      },
    })
    const client = createScopedClient(BASE, "billing", fetchMock)

    const err = await client.query("x.y").catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ContractError)
    expect(err).not.toBeInstanceOf(SyntaxError)
    expect(err).toMatchObject({ code: "TRANSPORT" })
  })

  // `parseErrorBody` documents this case, so it has to hold: a response object
  // with no `json` at all must not throw a TypeError out of the call itself,
  // before the `.catch` is attached. The two tests above use stubs whose
  // `json` rejects, which is a different case and already worked.
  it("falls back to TRANSPORT when a non-ok response has no json method at all", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 502 })
    const client = createScopedClient(BASE, "billing", fetchMock)

    const err = await client.query("x.y").catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ContractError)
    expect(err).not.toBeInstanceOf(TypeError)
    expect(err).toMatchObject({ code: "TRANSPORT" })
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
function harness(
  options: { tokens?: string[]; contract?: StubResponse[]; csrf?: StubResponse[] } = {},
) {
  const tokens = options.tokens ?? ["tok-1", "tok-2", "tok-3"]
  const contract = options.contract ?? [{ body: OK_BODY }]
  // A client that retries without a cap loops forever against a stub that
  // keeps rejecting, and an unbounded async loop does not fail a test - it
  // eats the heap until the worker is killed, taking every other test in the
  // file with it and reporting nothing about which assertion was wrong. This
  // budget turns that into an ordinary assertion failure in the one test that
  // cares. Four is generous: no command should ever cost more than two.
  const budget = 4
  const csrfInits: (RequestInit | undefined)[] = []
  const csrfURLs: string[] = []
  const sent: SentEnvelope[] = []
  let tokenIndex = 0
  let csrfIndex = 0
  let contractIndex = 0

  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).endsWith("/csrf")) {
      csrfURLs.push(String(url))
      csrfInits.push(init)
      // `csrf` scripts the token endpoint itself, for the tests about what
      // happens when it is down or answers without a token. Left unset, it
      // just mints the next token in `tokens`.
      if (options.csrf) {
        const scripted = options.csrf[Math.min(csrfIndex, options.csrf.length - 1)]
        csrfIndex += 1
        return stub(scripted)
      }
      const token = tokens[Math.min(tokenIndex, tokens.length - 1)]
      tokenIndex += 1
      return stub({ body: { token, expiresAt: "2026-09-06T12:00:00Z" } })
    }
    if (sent.length >= budget) {
      throw new Error(`fetch budget of ${budget} contract calls exhausted: the client is looping`)
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
  // One test replaces globalThis.crypto to reach the no-secure-context path.
  afterEach(() => {
    vi.unstubAllGlobals()
  })

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

  // A dashboard served over plain http to any host but localhost has no secure
  // context, and `crypto.randomUUID` does not exist there. Calling it anyway
  // throws a TypeError before a request leaves the browser, which would make
  // every command fail totally on an ordinary internal-network deployment.
  // Stubbing the global away is exactly that environment.
  it("still mints a usable key where crypto.randomUUID does not exist", async () => {
    vi.stubGlobal("crypto", {})
    const h = harness({
      contract: [{ status: 401, body: rejection("UNAUTHENTICATED") }, { body: OK_BODY }],
    })
    const client = createScopedClient(BASE, "billing", h.fetchImpl)

    await expect(client.command("session.login")).resolves.toEqual({ done: true })

    const key = h.sent[0].idempotencyKey
    expect(typeof key).toBe("string")
    expect(String(key).length).toBeGreaterThan(16)
    // And it is still one key for one logical command, retry included.
    expect(h.sent[1].idempotencyKey).toBe(key)
  })

  it("mints a distinct fallback key per command, even within one millisecond", async () => {
    vi.stubGlobal("crypto", {})
    const h = harness()
    const client = createScopedClient(BASE, "billing", h.fetchImpl)

    await Promise.all([client.command("a"), client.command("b"), client.command("c")])

    const keys = h.sent.map((e) => e.idempotencyKey)
    expect(new Set(keys).size).toBe(3)
  })

  // The token endpoint being down is the one branch both the doc comment and
  // the retired note described at length and nothing verified. Two halves:
  // the failure is quiet, and it is not permanent.
  it("gives up quietly when /csrf fails, and fetches again on the next command", async () => {
    const h = harness({
      csrf: [{ status: 503, body: {} }, { body: { token: "tok-late" } }],
      contract: [
        { status: 400, body: rejection("BAD_REQUEST", "command requires csrf and idempotencyKey") },
        { body: OK_BODY },
      ],
    })
    const client = createScopedClient(BASE, "billing", h.fetchImpl)

    // Quiet: the command goes out tokenless and fails on the server's own
    // terms - its own code and message, not a transport error about a token
    // fetch the caller never made.
    await expect(client.command("session.login")).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "command requires csrf and idempotencyKey",
    })
    expect(h.csrfURLs).toHaveLength(1)
    expect(h.sent).toHaveLength(1)
    expect(h.sent[0]).not.toHaveProperty("csrf")

    // Not permanent: the null token means the next command tries the fetch
    // again rather than the client staying tokenless for its whole life.
    await expect(client.command("session.retry")).resolves.toEqual({ done: true })
    expect(h.csrfURLs).toHaveLength(2)
    expect(h.sent[1].csrf).toBe("tok-late")
  })

  it("treats a 200 from /csrf carrying no token as no token at all", async () => {
    const h = harness({
      csrf: [{ body: { expiresAt: "2026-09-06T12:00:00Z" } }, { body: { token: "tok-late" } }],
      contract: [{ status: 400, body: rejection("BAD_REQUEST") }, { body: OK_BODY }],
    })
    const client = createScopedClient(BASE, "billing", h.fetchImpl)

    await expect(client.command("session.login")).rejects.toMatchObject({ code: "BAD_REQUEST" })
    expect(h.sent[0]).not.toHaveProperty("csrf")

    await expect(client.command("session.retry")).resolves.toEqual({ done: true })
    expect(h.sent[1].csrf).toBe("tok-late")
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

function okResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  } as unknown as Response
}

describe("createScopedClient meta reporting", () => {
  it("reports a query's cacheControl to the listener", async () => {
    const onMeta = vi.fn()
    const fetchImpl = vi.fn().mockResolvedValue(
      okResponse({
        ok: true,
        data: { users: [] },
        meta: { cacheControl: { staleTime: "30s" } },
      }),
    )
    const client = createScopedClient("/dashboard/contract", "auth", fetchImpl, onMeta)

    await client.query("users.list")

    expect(onMeta).toHaveBeenCalledWith({
      kind: "query",
      extension: "auth",
      intent: "users.list",
      meta: { cacheControl: { staleTime: "30s" } },
    })
  })

  it("reports a command's invalidates to the listener", async () => {
    const onMeta = vi.fn()
    const fetchImpl = vi
      .fn()
      // The CSRF fetch the client makes before its first command.
      .mockResolvedValueOnce(okResponse({ token: "t" }))
      .mockResolvedValueOnce(
        okResponse({
          ok: true,
          data: { ok: true },
          meta: { invalidates: ["users.list", "users.detail"] },
        }),
      )
    const client = createScopedClient("/dashboard/contract", "auth", fetchImpl, onMeta)

    await client.command("users.ban", { id: "u1" })

    expect(onMeta).toHaveBeenCalledWith({
      kind: "command",
      extension: "auth",
      intent: "users.ban",
      meta: { invalidates: ["users.list", "users.detail"] },
    })
  })

  it("still resolves with data and no listener attached", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(okResponse({ ok: true, data: { users: [] }, meta: {} }))
    const client = createScopedClient("/dashboard/contract", "auth", fetchImpl)
    await expect(client.query("users.list")).resolves.toEqual({ users: [] })
  })

  it("does not call the listener when a request fails", async () => {
    const onMeta = vi.fn()
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: () => Promise.resolve({ error: { code: "PERMISSION_DENIED", message: "no" } }),
    } as unknown as Response)
    const client = createScopedClient("/dashboard/contract", "auth", fetchImpl, onMeta)

    await expect(client.query("users.list")).rejects.toThrow()
    expect(onMeta).not.toHaveBeenCalled()
  })

  it("survives a response that carries no meta at all", async () => {
    const onMeta = vi.fn()
    const fetchImpl = vi.fn().mockResolvedValue(okResponse({ ok: true, data: { users: [] } }))
    const client = createScopedClient("/dashboard/contract", "auth", fetchImpl, onMeta)

    await expect(client.query("users.list")).resolves.toEqual({ users: [] })
    expect(onMeta).toHaveBeenCalledWith({
      kind: "query",
      extension: "auth",
      intent: "users.list",
      meta: {},
    })
  })
})
