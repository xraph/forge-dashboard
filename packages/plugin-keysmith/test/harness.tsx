import type { ComponentType } from "react"
import { beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import {
  ContractError,
  PluginProvider,
  queryStore,
} from "@forge-go/dashboard-plugin"
import type {
  CommandOptions,
  PluginPageProps,
  ScopedClient,
} from "@forge-go/dashboard-plugin"
import { FakeHost } from "./fake-host"
import type { Navigated } from "./fake-host"

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
    extension: "keysmith",
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

/** What forge v1.12.1's dispatcher answers to a replayed secret command. */
export const ALREADY_RAN_MESSAGE =
  "command already ran and its response held a secret that is not kept; send a new idempotency key to run it again"

/** What forge v1.12.2's dispatcher answers to a repeat while the first runs. */
export const STILL_RUNNING_MESSAGE =
  "the same command is still running under this idempotency key; retry once it finishes"

/**
 * Stands in for the dispatcher in front of a command whose answer holds a raw
 * key. It remembers every idempotency key it ran each intent under, and a
 * repeat answers CONFLICT without running anything, as forge v1.12.1 does.
 * `loseNextAnswer` makes the next command run and then lose its answer on the
 * way back, which reaches the page as TRANSPORT. `holdNextRun` keeps the next
 * command's claim on its key until `finishRuns`, as forge v1.12.2 does while
 * a command runs, so a repeat in between answers CONFLICT, still running.
 */
export function secretCommandClient(
  answers: Record<string, unknown>,
  commands: Record<string, unknown>,
): {
  client: ScopedClient
  sent: { intent: string; payload: unknown; idempotencyKey?: string }[]
  /** How many times each intent actually ran. */
  ran: Record<string, number>
  loseNextAnswer: () => void
  holdNextRun: () => void
  finishRuns: () => void
} {
  const sent: { intent: string; payload: unknown; idempotencyKey?: string }[] = []
  const ran: Record<string, number> = {}
  const seen = new Set<string>()
  let lose = 0
  let hold = false
  const claimed = new Set<string>()
  const inner = stubClient(answers, commands)
  return {
    sent,
    ran,
    loseNextAnswer: () => {
      lose += 1
    },
    holdNextRun: () => {
      hold = true
    },
    finishRuns: () => {
      for (const k of claimed) seen.add(k)
      claimed.clear()
    },
    client: {
      extension: inner.extension,
      query: inner.query,
      command: async (intent: string, payload?: unknown, opts?: CommandOptions) => {
        const key = opts?.idempotencyKey
        sent.push({ intent, payload, idempotencyKey: key })
        const at = `${key}:${intent}`
        if (key !== undefined && claimed.has(at)) {
          throw new ContractError("CONFLICT", STILL_RUNNING_MESSAGE)
        }
        if (key !== undefined && seen.has(at)) {
          throw new ContractError("CONFLICT", ALREADY_RAN_MESSAGE)
        }
        const answer = await inner.command(intent, payload)
        ran[intent] = (ran[intent] ?? 0) + 1
        if (key !== undefined && hold) {
          hold = false
          claimed.add(at)
        } else if (key !== undefined) {
          seen.add(at)
        }
        if (lose > 0) {
          lose -= 1
          throw new ContractError("TRANSPORT", "contract request failed with HTTP 502")
        }
        return answer
      },
    } as ScopedClient,
  }
}

/** A client whose every read fails, for exercising the error branch. */
export function failingClient(error: ContractError): ScopedClient {
  return {
    extension: "keysmith",
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
    extension: "keysmith",
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

/** What the stand-in router has been told, as the host would see it. */
export interface RouterState {
  /** Every navigate call, in order, and whether it replaced. */
  navigations: Navigated[]
  /** The router's own idea of the current search, "?keyId=..." or "". */
  search: string
}

/**
 * Renders one plugin page inside a stand-in router (test/fake-host.tsx), at
 * whatever address the test has already put in window.location. Returns what
 * the router has been told.
 */
export function renderRoutedPage(
  Page: ComponentType<PluginPageProps>,
  client: ScopedClient,
  params: PluginPageProps["params"] = {},
) {
  const router: RouterState = { navigations: [], search: "" }
  const result = render(
    <PluginProvider client={client}>
      <FakeHost
        onNavigate={(navigated) => router.navigations.push(navigated)}
        onSearch={(search) => {
          router.search = search
        }}
      >
        <Page params={params} />
      </FakeHost>
    </PluginProvider>,
  )
  return { ...result, router }
}

/**
 * Whether the Close button was already back when an error first reached the
 * page. It watches the DOM from before the press, so it sees the commit that
 * showed the error before anything else gets to run, an effect included.
 */
export function unlockedWithFirstError(): Promise<boolean> {
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      if (document.querySelector('[role="alert"]') === null) return
      observer.disconnect()
      resolve(screen.queryByRole("button", { name: "Close" }) !== null)
    })
    observer.observe(document.body, { childList: true, subtree: true })
  })
}
