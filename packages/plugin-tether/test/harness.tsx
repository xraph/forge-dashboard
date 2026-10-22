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

type Answer = unknown | ((params?: unknown, payload?: unknown) => unknown)

function answer(value: Answer, arg?: unknown): unknown {
  return typeof value === "function"
    ? (value as (a?: unknown) => unknown)(arg)
    : value
}

/**
 * A client that answers exactly the intents it was given and refuses every
 * other one with a ContractError, so a typo in an intent name turns a test red
 * instead of rendering a silently empty page. A value may be a function of the
 * params (queries) or the payload (commands), which is how a test makes the
 * same intent answer differently on its second call.
 */
export function stubClient(
  given: Record<string, Answer>,
  commands: Record<string, Answer> = {}
): ScopedClient {
  // Pages ask session.info before anything else. Unless a test says
  // otherwise the caller is an operator, which is what the fixture server
  // answers by default too.
  const answers: Record<string, Answer> = {
    "session.info": { operator: true },
    ...given,
  }
  return {
    extension: "tether",
    query: async (intent: string, params?: unknown) => {
      if (!(intent in answers)) {
        throw new ContractError(
          "NOT_FOUND",
          `no handler for intent "${intent}"`
        )
      }
      return answer(answers[intent], params)
    },
    command: async (intent: string, payload?: unknown) => {
      if (!(intent in commands)) {
        throw new ContractError(
          "NOT_FOUND",
          `no handler for command "${intent}"`
        )
      }
      return answer(commands[intent], payload)
    },
  } as ScopedClient
}

export interface Recorded {
  client: ScopedClient
  queries: { intent: string; params?: unknown }[]
  commands: { intent: string; payload?: unknown }[]
}

/** Records every query (with its params) and command (with its payload). */
export function recordingClient(
  answers: Record<string, Answer>,
  commands: Record<string, Answer> = {}
): Recorded {
  const queries: Recorded["queries"] = []
  const sent: Recorded["commands"] = []
  const inner = stubClient(answers, commands)
  return {
    queries,
    commands: sent,
    client: {
      extension: inner.extension,
      query: (intent: string, params?: Record<string, unknown>) => {
        queries.push({ intent, params })
        return inner.query(intent, params)
      },
      command: (intent: string, payload?: unknown) => {
        sent.push({ intent, payload })
        return inner.command(intent, payload)
      },
    } as ScopedClient,
  }
}

/** A client whose every call fails with the given error. */
export function failingClient(error: ContractError): ScopedClient {
  return {
    extension: "tether",
    query: async () => {
      throw error
    },
    command: async () => {
      throw error
    },
  } as ScopedClient
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
