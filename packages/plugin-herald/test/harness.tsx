import type { ComponentType, ReactNode } from "react"
import { beforeEach, vi } from "vitest"
import { render } from "@testing-library/react"
import {
  ContractError,
  NavigationProvider,
  PluginProvider,
  queryStore,
} from "@forge-go/dashboard-plugin"
import type { PluginPageProps, ScopedClient } from "@forge-go/dashboard-plugin"

/**
 * `queryStore` is a module-level singleton, so an entry one test writes
 * outlives that test. Every file importing this harness gets the reset.
 */
beforeEach(() => {
  queryStore.clear()
})

/**
 * Answers exactly the intents it was given and refuses every other one, so a
 * typo in an intent name renders an error card and turns the test red.
 */
export function stubClient(
  answers: Record<string, unknown>,
  commands: Record<string, unknown> = {}
): ScopedClient {
  return {
    extension: "herald",
    query: async (intent: string) => {
      if (!(intent in answers))
        throw new ContractError(
          "NOT_FOUND",
          `no handler for intent "${intent}"`
        )
      return answers[intent]
    },
    command: async (intent: string) => {
      if (!(intent in commands))
        throw new ContractError(
          "NOT_FOUND",
          `no handler for command "${intent}"`
        )
      return commands[intent]
    },
  } as ScopedClient
}

/** Records every command a page sends, with its payload, in order. */
export function recordingCommandClient(
  answers: Record<string, unknown>,
  commands: Record<string, unknown> = {}
) {
  const sent: { intent: string; payload: unknown }[] = []
  const inner = stubClient(answers, commands)
  return {
    sent,
    client: {
      extension: inner.extension,
      query: inner.query,
      command: (intent: string, payload?: unknown) => {
        sent.push({ intent, payload })
        return inner.command(intent, payload)
      },
    } as ScopedClient,
  }
}

/** Records every query a page sends, with its params, in order. */
export function recordingQueryClient(answers: Record<string, unknown>) {
  const sent: { intent: string; params?: Record<string, unknown> }[] = []
  const inner = stubClient(answers)
  return {
    sent,
    client: {
      extension: inner.extension,
      query: (intent: string, params?: Record<string, unknown>) => {
        sent.push({ intent, params })
        return inner.query(intent, params)
      },
      command: inner.command,
    } as ScopedClient,
  }
}

/** Every read and write fails with this error. */
export function failingClient(error: ContractError): ScopedClient {
  return {
    extension: "herald",
    query: async () => {
      throw error
    },
    command: async () => {
      throw error
    },
  } as ScopedClient
}

/** Nothing ever settles. */
export function pendingClient(): ScopedClient {
  return {
    extension: "herald",
    query: () => new Promise<never>(() => {}),
    command: () => new Promise<never>(() => {}),
  } as ScopedClient
}

type Answer = ((input: Record<string, unknown>) => unknown) | object

/**
 * Queries and commands answered by intent, each a value or a function of the
 * input. An answer that is (or returns) a ContractError is thrown, the only
 * way a command's failure path runs. Copied from plugin-relay's harness.
 */
export function scriptedClient(
  queries: Record<string, Answer>,
  commands: Record<string, Answer> = {}
) {
  const queried: { intent: string; params: Record<string, unknown> }[] = []
  const sent: { intent: string; payload: unknown }[] = []
  const answer = (
    table: Record<string, Answer>,
    intent: string,
    input: Record<string, unknown>
  ) => {
    if (!(intent in table))
      throw new ContractError("NOT_FOUND", `no handler for "${intent}"`)
    const a = table[intent]
    const out =
      typeof a === "function"
        ? (a as (i: Record<string, unknown>) => unknown)(input)
        : a
    if (out instanceof ContractError) throw out
    return out
  }
  return {
    queried,
    sent,
    client: {
      extension: "herald",
      query: async (intent: string, params?: Record<string, unknown>) => {
        queried.push({ intent, params: params ?? {} })
        return answer(queries, intent, params ?? {})
      },
      command: async (intent: string, payload?: unknown) => {
        sent.push({ intent, payload })
        return answer(
          commands,
          intent,
          (payload ?? {}) as Record<string, unknown>
        )
      },
    } as ScopedClient,
  }
}

type InvalidatingAnswer =
  Answer | ((input: Record<string, unknown>, call: number) => unknown)
type CommandAnswer =
  InvalidatingAnswer | { answer: unknown; invalidates: string[] }

/**
 * As scriptedClient, but answering like the host. A command given as
 * `{ answer, invalidates }` reaches `queryStore.invalidate("herald", ...)` on
 * success, before its answer returns, which is what PluginHost's meta listener
 * does. A throw invalidates nothing. A query function also gets how many times
 * that intent was asked before (0 for the first), so a re-answer can differ.
 * Use it to pin what a page does while its own data refetches.
 */
export function invalidatingClient(
  queries: Record<string, InvalidatingAnswer>,
  commands: Record<string, CommandAnswer> = {}
) {
  const queried: { intent: string; params: Record<string, unknown> }[] = []
  const sent: { intent: string; payload: unknown }[] = []
  const run = (a: unknown, input: Record<string, unknown>, call: number) => {
    const out =
      typeof a === "function"
        ? (a as (i: Record<string, unknown>, c: number) => unknown)(input, call)
        : a
    if (out instanceof ContractError) throw out
    return out
  }
  return {
    queried,
    sent,
    client: {
      extension: "herald",
      query: async (intent: string, params?: Record<string, unknown>) => {
        if (!(intent in queries))
          throw new ContractError("NOT_FOUND", `no handler for "${intent}"`)
        const call = queried.filter((q) => q.intent === intent).length
        queried.push({ intent, params: params ?? {} })
        return run(queries[intent], params ?? {}, call)
      },
      command: async (intent: string, payload?: unknown) => {
        sent.push({ intent, payload })
        if (!(intent in commands))
          throw new ContractError("NOT_FOUND", `no handler for "${intent}"`)
        const a = commands[intent]
        const input = (payload ?? {}) as Record<string, unknown>
        if (
          typeof a === "object" &&
          a !== null &&
          "invalidates" in a &&
          "answer" in a
        ) {
          const out = run(a.answer, input, 0)
          queryStore.invalidate("herald", a.invalidates)
          return out
        }
        return run(a, input, 0)
      },
    } as ScopedClient,
  }
}

/** Renders one page the way the host does: inside a PluginProvider. */
export function renderPage(
  Page: ComponentType<PluginPageProps>,
  client: ScopedClient,
  params: PluginPageProps["params"] = {}
) {
  return render(
    <PluginProvider client={client}>
      <Page params={params} />
    </PluginProvider>
  )
}

/** As renderPage, with navigation captured so a test can assert where a page went. */
export function renderWithNavigate(
  Page: ComponentType<PluginPageProps>,
  client: ScopedClient,
  params: PluginPageProps["params"] = {}
) {
  const navigate = vi.fn()
  const result = render(
    <PluginProvider client={client}>
      <NavigationProvider
        value={{
          Link: ({
            to,
            children,
            className,
          }: {
            to: string
            children: ReactNode
            className?: string
          }) => (
            <a href={to} className={className}>
              {children}
            </a>
          ),
          navigate,
        }}
      >
        <Page params={params} />
      </NavigationProvider>
    </PluginProvider>
  )
  return { ...result, navigate }
}
