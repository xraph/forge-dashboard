import type { ComponentType } from "react"
import { render } from "@testing-library/react"
import { ContractError, PluginProvider } from "@forge-go/dashboard-plugin"
import type { ScopedClient } from "@forge-go/dashboard-plugin"

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
export function stubClient(answers: Record<string, unknown>): ScopedClient {
  return {
    extension: "streaming-contract",
    query: async (intent: string) => {
      if (!(intent in answers)) {
        throw new ContractError(
          "NOT_FOUND",
          `no handler for intent "${intent}"`
        )
      }
      return answers[intent]
    },
    command: async () => {
      throw new Error("the streaming plugin is read-only and sends no commands")
    },
  } as ScopedClient
}

/** A client whose every read fails, for exercising the error branch. */
export function failingClient(error: ContractError): ScopedClient {
  return {
    extension: "streaming-contract",
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
    extension: "streaming-contract",
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
export function renderPage(Page: ComponentType, client: ScopedClient) {
  return render(
    <PluginProvider client={client}>
      <Page />
    </PluginProvider>
  )
}
