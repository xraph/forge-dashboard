/** The wire request. Mirrors contract.Request in contract/envelope.go. */
export interface ContractEnvelopeRequest {
  envelope: "v1"
  kind: "query" | "command"
  contributor: string
  intent: string
  params?: Record<string, unknown>
  payload?: unknown
  context: { route?: string; correlationID?: string }
  /** Commands only. The server rejects a command envelope without one. */
  csrf?: string
  /** Commands only. The server rejects a command envelope without one. */
  idempotencyKey?: string
}

/**
 * A contract-level failure. `code` is the server's error code, or "TRANSPORT"
 * when the request never reached the contract layer. Callers need to tell those
 * apart: one means your request was wrong, the other means the network was.
 */
export class ContractError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = "ContractError"
    this.code = code
  }
}

/** Per-call options for {@link ScopedClient.command}. */
export interface CommandOptions {
  /**
   * Reuse an existing key instead of minting one. Pass this when the caller,
   * not the client, owns the notion of "the same command": a form that
   * survives a page reload, a retry driven from outside this client. Omit it
   * and every call to `command()` is a new logical command with a new key.
   */
  idempotencyKey?: string
}

export interface ScopedClient {
  readonly extension: string
  query<T = unknown>(intent: string, params?: Record<string, unknown>): Promise<T>
  /**
   * Sends one command (a write) to this plugin's own extension.
   *
   * Two fields separate a command from a query on the wire, and the server
   * rejects the envelope without either of them - a check it runs before it
   * looks at whether contract security is enabled at all, because a command
   * with no idempotency key is unsafe to retry either way:
   *
   * - `csrf`, fetched lazily from `{contractBase}/csrf` before the first
   *   command and then cached for the life of the client. The server's tokens
   *   have a 12h TTL; a fetch per command would be a wasted round trip on
   *   every write.
   * - `idempotencyKey`, minted here at the entry point and threaded unchanged
   *   through every HTTP attempt this one logical command takes. See the note
   *   on the retry inside `createScopedClient` for why that placement is the
   *   whole point.
   */
  command<T = unknown>(intent: string, payload?: unknown, opts?: CommandOptions): Promise<T>
}

type FetchLike = typeof fetch

/** What `send` needs to build any one attempt. */
interface SendInput {
  kind: "query" | "command"
  intent: string
  params?: Record<string, unknown>
  payload?: unknown
  /**
   * Resolved once, by `command()`, and read back here. Never generated in the
   * envelope build: that is the difference between one command retried and two
   * commands sent.
   */
  idempotencyKey?: string
}

/**
 * Bumped by every fallback key. Module scope, not client scope, so two clients
 * in the same document cannot mint the same key in the same millisecond.
 */
let fallbackSequence = 0

/**
 * Mints one idempotency key.
 *
 * `crypto.randomUUID` exists **only in a secure context**. A Forge dashboard
 * served over plain http to anything but localhost has no secure context, and
 * that is an ordinary internal-network deployment, not an exotic one - nothing
 * in the dashboard's config assumes TLS. Call `crypto.randomUUID()` directly
 * there and every command throws a TypeError naming nothing useful, before a
 * request ever leaves the browser.
 *
 * So the fallback below is not dead code and must not be deleted. It is what
 * makes commands work off TLS at all.
 *
 * The fallback is deliberately not cryptographic. This key is a deduplication
 * handle, not a secret: the server compares it for equality and nothing more,
 * and it travels in a body the caller composed anyway. `crypto.getRandomValues`
 * would work here (it is not secure-context gated) but buys nothing a
 * timestamp, a process-wide counter and a random suffix do not already give,
 * at the cost of a third branch nobody exercises. The counter is what makes
 * collision impossible within a page rather than merely unlikely.
 */
function newIdempotencyKey(): string {
  // Read through globalThis at call time rather than closing over it, so a
  // test (or a polyfill installed late) sees the environment it expects.
  const c: Crypto | undefined = globalThis.crypto
  if (typeof c?.randomUUID === "function") return c.randomUUID()

  fallbackSequence += 1
  // Prefixed, and deliberately not UUID-shaped, so nobody downstream parses it
  // as one.
  return `ik-${Date.now().toString(36)}-${fallbackSequence.toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 12)}`
}

/**
 * Builds a client permanently bound to one extension.
 *
 * The contributor field is closed over, never a parameter. A plugin therefore
 * cannot address another extension's handlers, which matters because those
 * handlers carry their own permissions and audit trail.
 */
export function createScopedClient(
  contractBase: string,
  extension: string,
  // Called as a method of globalThis, never passed bare. A browser's `fetch`
  // wants the global as its receiver, and `fetchImpl = fetch` hands it none:
  // that is the "Illegal invocation" shape. The host always passes a bound
  // fetch so nothing in this repo hits it, but this package is published and
  // callers who omit the argument will exist. Resolving through globalThis at
  // call time also means a fetch installed after the client was built (a
  // polyfill, a test stub) is the one that runs.
  fetchImpl: FetchLike = (...args) => globalThis.fetch(...args),
): ScopedClient {
  // Held for the life of the client, shared by every command it sends. `null`
  // means "not held", which is both the initial state and what a failed
  // refresh leaves behind.
  let csrfToken: string | null = null

  async function refreshCSRF(): Promise<void> {
    const res = await fetchImpl(`${contractBase}/csrf`, { credentials: "include" })
    if (!res.ok) {
      // Deliberately not a throw. The endpoint is only mounted when the
      // dashboard's contract security is enabled, so a 404 here is a
      // configuration answer, not a failure of the command the caller asked
      // for. Let the command go out tokenless and fail on the server's own
      // terms, with the server's own message, rather than replacing that with
      // an error about a token fetch the caller never made.
      csrfToken = null
      return
    }
    const body = (await res.json()) as { token?: string }
    csrfToken = body.token ?? null
  }

  /**
   * Is this rejection the one a stale CSRF token gets, and therefore worth one
   * retry with a fresh token?
   *
   * The handshake note this file absorbed said 401, copying the deleted shell.
   * Against this server that is incomplete: `contract/transport/http.go`
   * answers a token that will not validate with **403 and code
   * UNAUTHENTICATED**. 401 comes from the auth middleware one layer out, where
   * the session itself has expired and a fresh CSRF token will not help. Both
   * are retried here - 401 because the note asked for it and the cost is one
   * request, 403/UNAUTHENTICATED because it is the case the retry actually
   * exists for. A 403 carrying any other code (PERMISSION_DENIED, say) is a
   * real denial: retrying it just denies twice and logs a second attempt at
   * something the caller is not allowed to do.
   */
  async function isStaleTokenRejection(res: Response): Promise<boolean> {
    if (res.status === 401) return true
    if (res.status !== 403) return false
    const body = (await res.json().catch(() => null)) as {
      error?: { code?: string }
    } | null
    return body?.error?.code === "UNAUTHENTICATED"
  }

  async function send<T>(input: SendInput, mayRetry: boolean): Promise<T> {
    if (input.kind === "command" && !csrfToken) {
      await refreshCSRF()
    }

    const req: ContractEnvelopeRequest = {
      envelope: "v1",
      kind: input.kind,
      contributor: extension,
      intent: input.intent,
      params: input.params,
      payload: input.payload,
      context: {},
      // Both of these are commands-only. A query that carried them would not
      // be rejected, but it would be noise on every read in the dashboard.
      // JSON.stringify drops the undefined, so nothing reaches the wire.
      csrf: input.kind === "command" ? (csrfToken ?? undefined) : undefined,
      // Read back, never minted. See command().
      idempotencyKey: input.idempotencyKey,
    }

    const res = await fetchImpl(contractBase, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(req),
    })

    if (!res.ok) {
      if (input.kind === "command" && mayRetry && (await isStaleTokenRejection(res))) {
        // A cached token outlives its TTL silently otherwise: nothing tells
        // the client the token went stale until a command is rejected for it.
        await refreshCSRF()
        // `mayRetry: false` is the cap, and it is a parameter rather than a
        // counter so there is exactly one place it can be got wrong. The
        // *same* input goes back in, which is what keeps the idempotency key
        // identical across both attempts: the server sees one command that
        // took two tries, not two commands.
        return send<T>(input, false)
      }
      throw new ContractError("TRANSPORT", `contract request failed with HTTP ${res.status}`)
    }

    const envelope = (await res.json()) as {
      ok: boolean
      data?: T
      error?: { code: string; message: string }
    }

    if (!envelope.ok) {
      throw new ContractError(
        envelope.error?.code ?? "UNKNOWN",
        envelope.error?.message ?? "contract request failed",
      )
    }

    return envelope.data as T
  }

  return {
    extension,
    query: (intent, params) => send({ kind: "query", intent, params }, false),
    command: (intent, payload, opts = {}) =>
      send(
        {
          kind: "command",
          intent,
          payload,
          // Resolved here, once, and nowhere else. Everything downstream reads
          // this value back; the envelope build does not mint one of its own.
          //
          // Put the `?? newIdempotencyKey()` inside the per-attempt build
          // instead and the CSRF-refresh retry above mints a second, different
          // key for what the server has to see as one command. That is the
          // whole reason to carry a key at all, so this line is load-bearing
          // and it is load-bearing *here*.
          idempotencyKey: opts.idempotencyKey ?? newIdempotencyKey(),
        },
        true,
      ),
  }
}
