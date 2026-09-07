import type { ComponentType } from "react"
import { render } from "@testing-library/react"
import {
  ContractError,
  PluginProvider,
  createScopedClient,
} from "@forge-go/dashboard-plugin"
import type {
  ContractEnvelopeRequest,
  ScopedClient,
} from "@forge-go/dashboard-plugin"

/** The join key every stub in this file is scoped to. */
export const EXTENSION = "auth"

/**
 * An answer a stub can give: a plain value, or a function called with the
 * params or payload. The function form is what lets a stub change what it says
 * between two reads of the same intent, which is what makes "the list
 * refetched after the ban" observable rather than assumed.
 *
 * `unknown` rather than a union with the function type, because
 * `unknown | Fn` collapses back to `unknown` and the union only reads as if it
 * documented something. Callers annotate their own callback parameters.
 */
export type Answer = unknown

function resolveAnswer(answer: Answer, input?: unknown): unknown {
  return typeof answer === "function"
    ? (answer as (i?: unknown) => unknown)(input)
    : answer
}

/**
 * A client that answers exactly the intents it was given and refuses every
 * other one.
 *
 * The refusal is the point. A page that asks for an intent this map does not
 * hold gets a ContractError, so it renders its error card instead of its data
 * and the assertions fail. That is what turns a typo in an intent name -
 * "user.list" against "users.list" - into a red test rather than a silently
 * empty page.
 *
 * `intents` records every call in order, and `payloads` records what each
 * command was sent, so a test can assert on both what was asked and how often.
 */
export function stubClient(
  queries: Record<string, Answer>,
  commands: Record<string, Answer> = {}
): {
  client: ScopedClient
  intents: string[]
  payloads: { intent: string; payload: unknown }[]
} {
  const intents: string[] = []
  const payloads: { intent: string; payload: unknown }[] = []

  const client = {
    extension: EXTENSION,
    query: async (intent: string, params?: Record<string, unknown>) => {
      intents.push(intent)
      if (!(intent in queries)) {
        throw new ContractError(
          "NOT_FOUND",
          `no query handler for intent "${intent}"`
        )
      }
      return resolveAnswer(queries[intent], params)
    },
    command: async (intent: string, payload?: unknown) => {
      intents.push(intent)
      payloads.push({ intent, payload })
      if (!(intent in commands)) {
        throw new ContractError(
          "NOT_FOUND",
          `no command handler for intent "${intent}"`
        )
      }
      const answer = resolveAnswer(commands[intent], payload)
      if (answer instanceof ContractError) throw answer
      return answer
    },
  } as ScopedClient

  return { client, intents, payloads }
}

/** A client whose every call fails, for exercising the error branches. */
export function failingClient(error: ContractError): ScopedClient {
  return {
    extension: EXTENSION,
    query: async () => {
      throw error
    },
    command: async () => {
      throw error
    },
  } as ScopedClient
}

/** A client whose reads never settle, for exercising the loading branch. */
export function pendingClient(): ScopedClient {
  return {
    extension: EXTENSION,
    query: () => new Promise<never>(() => {}),
    command: () => new Promise<never>(() => {}),
  } as ScopedClient
}

export interface ContractHarness {
  /** A real scoped client, built over the fetch stub below. */
  client: ScopedClient
  /** Every envelope the client POSTed, in order, already parsed. */
  requests: ContractEnvelopeRequest[]
  /** How many times the client fetched `{base}/csrf`. */
  csrfFetches: number
}

/**
 * Builds a **real** `createScopedClient` over a stubbed `fetch`.
 *
 * The object stubs above replace the client, which makes them useless for the
 * one assertion this package owes: that a login sends `csrf` and
 * `idempotencyKey` on the wire. Those two fields are the client's job, not the
 * page's, so proving they arrive means driving the client the page actually
 * uses and reading the body the transport actually produced. Asserting that
 * `execute` was called would prove nothing about either field.
 *
 * `respond` sees each parsed envelope and returns `{ data }` for a success or
 * `{ error }` for the `ok: false` envelope a contract-level failure produces.
 */
export function contractHarness(
  respond: (
    req: ContractEnvelopeRequest
  ) => { data: unknown } | { error: { code: string; message: string } },
  opts: { csrfToken?: string; base?: string } = {}
): ContractHarness {
  const base = opts.base ?? "/dashboard/api/dashboard/v1"
  const token = opts.csrfToken ?? "csrf-token-fixture"
  const requests: ContractEnvelopeRequest[] = []
  const harness: ContractHarness = {
    client: undefined as unknown as ScopedClient,
    requests,
    csrfFetches: 0,
  }

  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    const url = String(input)

    if (url === `${base}/csrf`) {
      harness.csrfFetches += 1
      return {
        ok: true,
        status: 200,
        json: async () => ({
          token,
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        }),
      }
    }

    const req = JSON.parse(String(init?.body)) as ContractEnvelopeRequest
    requests.push(req)
    const result = respond(req)

    if ("error" in result) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: false,
          envelope: "v1",
          error: result.error,
        }),
      }
    }

    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        envelope: "v1",
        kind: req.kind,
        data: result.data,
      }),
    }
  }) as unknown as typeof fetch

  harness.client = createScopedClient(base, EXTENSION, fetchImpl)
  return harness
}

/** Renders one plugin page the way the host does: inside a PluginProvider. */
export function renderPage(Page: ComponentType, client: ScopedClient) {
  return render(
    <PluginProvider client={client}>
      <Page />
    </PluginProvider>
  )
}
