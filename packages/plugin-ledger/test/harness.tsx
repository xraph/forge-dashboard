import type { ComponentType } from "react"
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
 * outlives that test and the next read is served from cache rather than
 * reaching the stub. Every file importing this harness gets the reset.
 */
beforeEach(() => {
  queryStore.clear()
})

/**
 * A client that answers exactly the intents it was given and refuses every
 * other one.
 *
 * The refusal is the point. A page that asks for an intent this map does not
 * hold gets a ContractError, so the page renders its error card instead of its
 * data and the assertions below fail. That is what turns a typo in an intent
 * name - "roles.list" against "roles" - into a red test rather than a silently
 * empty page. That was checked by breaking it and watching the run go red, not
 * assumed.
 */
export function stubClient(
  answers: Record<string, unknown>,
  commands: Record<string, unknown> = {},
): ScopedClient {
  return {
    extension: "ledger",
    query: async (intent: string) => {
      if (!(intent in answers)) {
        throw new ContractError("NOT_FOUND", `no handler for intent "${intent}"`)
      }
      return answers[intent]
    },
    // Same refusal as `query`, for the same reason: a command this map does not
    // hold is a typo in an intent name, and it should turn red rather than
    // resolve to undefined and look like a success.
    command: async (intent: string) => {
      if (!(intent in commands)) {
        throw new ContractError("NOT_FOUND", `no handler for command "${intent}"`)
      }
      return commands[intent]
    },
  } as ScopedClient
}

/** Records every command a page sends, with its payload, in order. */
export function recordingCommandClient(
  answers: Record<string, unknown>,
  commands: Record<string, unknown> = {},
): { client: ScopedClient; sent: { intent: string; payload: unknown }[] } {
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

/** A client whose every read fails, for exercising the error branch. */
export function failingClient(error: ContractError): ScopedClient {
  return {
    extension: "ledger",
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
    extension: "ledger",
    query: () => new Promise<never>(() => {}),
    command: () => new Promise<never>(() => {}),
  } as ScopedClient
}

/**
 * Records every query a page sends, with its params, in order.
 *
 * `recordingClient` below only keeps the intent name, not the params, so it
 * cannot answer "what did this query actually send". This mirrors
 * `recordingCommandClient`'s `{intent, payload}` shape for queries instead of
 * commands: it exists specifically so a test can assert a query's param
 * object, such as confirming that "all namespaces" sends no `namespacePath`
 * field at all rather than an empty string.
 */
export function recordingQueryClient(answers: Record<string, unknown>): {
  client: ScopedClient
  sent: { intent: string; params?: unknown }[]
} {
  const sent: { intent: string; params?: unknown }[] = []
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

/** Records every intent a page asks for, in order. */
export function recordingClient(answers: Record<string, unknown>): {
  client: ScopedClient
  intents: string[]
} {
  const intents: string[] = []
  const inner = stubClient(answers)
  return {
    intents,
    client: {
      extension: inner.extension,
      query: (intent: string, params?: Record<string, unknown>) => {
        intents.push(intent)
        return inner.query(intent, params)
      },
      command: inner.command,
    } as ScopedClient,
  }
}

/** Renders one plugin page the way the host does: inside a PluginProvider. */
export function renderPage(
  Page: ComponentType<PluginPageProps>,
  client: ScopedClient,
  params: PluginPageProps["params"] = {},
) {
  return render(
    <PluginProvider client={client}>
      <Page params={params} />
    </PluginProvider>
  )
}

/**
 * Renders a page inside a NavigationProvider whose navigate is a spy, for
 * pages that move somewhere after a write (every create page, and detail
 * pages whose record a delete removes).
 */
export function renderWithNavigation(
  Page: ComponentType<PluginPageProps>,
  client: ScopedClient,
  params: PluginPageProps["params"] = {},
) {
  const navigate = vi.fn()
  const view = render(
    <PluginProvider client={client}>
      <NavigationProvider
        value={{
          Link: ({ to, children, className, ...rest }) => (
            <a href={to} className={className} {...rest}>
              {children}
            </a>
          ),
          navigate,
        }}
      >
        <Page params={params} />
      </NavigationProvider>
    </PluginProvider>,
  )
  return { ...view, navigate }
}
