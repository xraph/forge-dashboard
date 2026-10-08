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
 * name - "roles.list" against "roles" - into a red test rather than a silently
 * empty page. That was checked by breaking it and watching the run go red, not
 * assumed.
 */
export function stubClient(
  answers: Record<string, unknown>,
  commands: Record<string, unknown> = {}
): ScopedClient {
  return {
    extension: "warden",
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
    extension: "warden",
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
    extension: "warden",
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
  params: PluginPageProps["params"] = {}
) {
  return render(
    <PluginProvider client={client}>
      <Page params={params} />
    </PluginProvider>
  )
}

/**
 * The cell of `row` under the column headed `header`.
 *
 * ResourceTable renders one header cell per column, then Actions, and the
 * same count of cells per row, so the header's index is the cell's index.
 * Matching by header rather than by text is what lets a test tell the
 * Created column from the Updated one when both hold a date.
 */
export function cellUnder(row: HTMLElement, header: string): HTMLElement {
  const table = row.closest("table")
  if (!table) throw new Error("row is not inside a table")
  const headers = Array.from(table.querySelectorAll("thead th")).map(
    (th) => th.textContent
  )
  const index = headers.indexOf(header)
  if (index < 0)
    throw new Error(`no column headed "${header}", only ${headers.join(", ")}`)
  return row.querySelectorAll("td")[index] as HTMLElement
}

/** The value beside the term `term` in a DescriptionList. */
export function describedAs(term: string): HTMLElement {
  const dt = Array.from(document.querySelectorAll("dt")).find(
    (el) => el.textContent === term
  )
  if (!dt) throw new Error(`no term "${term}"`)
  return dt.nextElementSibling as HTMLElement
}

/**
 * What NoneCell draws for "none". Written as an escape so this source holds
 * no dash character, only the code point the kit renders.
 */
export const EMPTY_MARK = "\u2013"
