/** The wire request. Mirrors contract.Request in contract/envelope.go. */
export interface ContractEnvelopeRequest {
  envelope: "v1"
  kind: "query" | "command"
  contributor: string
  intent: string
  params?: Record<string, unknown>
  payload?: unknown
  context: { route?: string; correlationID?: string }
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

export interface ScopedClient {
  readonly extension: string
  query<T = unknown>(intent: string, params?: Record<string, unknown>): Promise<T>
  // No command() yet. The server rejects every command envelope that carries
  // no CSRF token and no idempotency key, and it does that check before it
  // looks at whether contract security is even enabled, so a command sent
  // without both fields cannot succeed against any Forge server.
  //
  // It lands with the first real consumer and not before. No wave number here
  // on purpose: the last one said W3, the plan moved, and the comment did not.
  // The rule is the consumer, not the calendar. Before you add it, read
  // ../docs/command-handshake.md, which has the whole handshake including the
  // one non-obvious part, that the idempotency key is minted once per logical
  // command and threaded unchanged through the CSRF-refresh retry.
}

type FetchLike = typeof fetch

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
  async function send<T>(
    kind: "query",
    intent: string,
    body: { params?: Record<string, unknown> },
  ): Promise<T> {
    const req: ContractEnvelopeRequest = {
      envelope: "v1",
      kind,
      contributor: extension,
      intent,
      context: {},
      ...body,
    }

    const res = await fetchImpl(contractBase, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(req),
    })

    if (!res.ok) {
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
    query: (intent, params) => send("query", intent, { params }),
  }
}
