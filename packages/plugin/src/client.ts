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
  command<T = unknown>(intent: string, payload?: unknown): Promise<T>
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
  fetchImpl: FetchLike = fetch,
): ScopedClient {
  async function send<T>(
    kind: "query" | "command",
    intent: string,
    body: { params?: Record<string, unknown>; payload?: unknown },
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
    command: (intent, payload) => send("command", intent, { payload }),
  }
}
