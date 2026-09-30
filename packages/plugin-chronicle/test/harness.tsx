import type { ComponentType } from "react"
import { beforeEach } from "vitest"
import { render } from "@testing-library/react"
import {
  ContractError,
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
 * name - "rooms.list" against "rooms" - into a red test rather than a silently
 * empty page. That was checked by breaking it and watching the run go red, not
 * assumed.
 */
export function stubClient(
  answers: Record<string, unknown>,
  commands: Record<string, unknown> = {}
): ScopedClient {
  return {
    extension: "chronicle",
    query: async (intent: string) => {
      if (!(intent in answers)) {
        throw new ContractError(
          "NOT_FOUND",
          `no handler for intent "${intent}"`
        )
      }
      return answers[intent]
    },
    // Same refusal as `query`, for the same reason: a command this map does not
    // hold is a typo in an intent name, and it should turn red rather than
    // resolve to undefined and look like a success.
    command: async (intent: string) => {
      if (!(intent in commands)) {
        throw new ContractError(
          "NOT_FOUND",
          `no handler for command "${intent}"`
        )
      }
      return commands[intent]
    },
  } as ScopedClient
}

/** Records every command a page sends, with its payload, in order. */
export function recordingCommandClient(
  answers: Record<string, unknown>,
  commands: Record<string, unknown> = {}
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
    extension: "chronicle",
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
    extension: "chronicle",
    query: () => new Promise<never>(() => {}),
    command: () => new Promise<never>(() => {}),
  } as ScopedClient
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
  params: PluginPageProps["params"] = {}
) {
  return render(
    <PluginProvider client={client}>
      <Page params={params} />
    </PluginProvider>
  )
}

/**
 * Records every query a page makes, with its params, in order. A filter that
 * updates an input but never reaches the server looks fine on screen and is
 * wrong; this is how a test sees the params actually sent.
 */
export function paramsRecordingClient(answers: Record<string, unknown>): {
  client: ScopedClient
  calls: { intent: string; params?: Record<string, unknown> }[]
} {
  const calls: { intent: string; params?: Record<string, unknown> }[] = []
  const inner = stubClient(answers)
  return {
    calls,
    client: {
      extension: inner.extension,
      query: (intent: string, params?: Record<string, unknown>) => {
        calls.push({ intent, params })
        return inner.query(intent, params)
      },
      command: inner.command,
    } as ScopedClient,
  }
}

/**
 * Queries answer; every command THROWS the given ContractError. A stub that
 * answered { ok: false } would resolve normally and `execute` would treat it
 * as a success, so a failure test built on one never runs the failure path.
 */
export function commandFailingClient(
  answers: Record<string, unknown>,
  error: ContractError
): ScopedClient {
  const inner = stubClient(answers)
  return {
    extension: inner.extension,
    query: inner.query,
    command: async () => {
      throw error
    },
  } as ScopedClient
}

/** Queries answer; every command never settles, to observe the pending state. */
export function commandPendingClient(
  answers: Record<string, unknown>
): ScopedClient {
  const inner = stubClient(answers)
  return {
    extension: inner.extension,
    query: inner.query,
    command: () => new Promise<never>(() => {}),
  } as ScopedClient
}

type Answer = ((input: Record<string, unknown>) => unknown) | object

/**
 * Queries and commands both answered by intent, each answer either a value
 * or a function of the call's input. An answer that is (or returns) a
 * ContractError is thrown, which is the only way a command's failure path
 * runs: execute() resolves undefined on a throw, never on a resolved value.
 * Every call is recorded in order.
 */
export function scriptedClient(
  queries: Record<string, Answer>,
  commands: Record<string, Answer> = {}
): {
  client: ScopedClient
  queried: { intent: string; params: Record<string, unknown> }[]
  sent: { intent: string; payload: unknown }[]
} {
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
      extension: "chronicle",
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
