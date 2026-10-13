import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import {
  PluginProvider,
  ContractError,
  queryStore,
  type ScopedClient,
} from "@forge-go/dashboard-plugin"
import { layoutViolations } from "@forge-go/dashboard-kit/lib/layout-check"
import {
  ConduitServicesPage,
  ConduitDeadLettersPage,
  ConduitHooksPage,
} from "../src/pages"
import { ConduitConsumersPage } from "../src/consumers"
import type {
  Backfill,
  ConsumerInfo,
  HookEvent,
  Letter,
  Snapshot,
} from "../src/types"

const identity = { namespace: "prod", serviceID: "billing", instanceID: "one" }
const subscription = {
  id: "work",
  stream: "orders",
  messageType: "orders.placed.v1",
  mode: "competing" as const,
  durable: true,
  concurrency: 4,
  maxInFlight: 16,
  timeout: 30000000000,
  maxAttempts: 5,
  retryDelay: 1000000000,
  startAt: "all",
}
const snapshot = {
  identity,
  running: true,
  startedAt: "2026-10-09T12:00:00Z",
  providers: [
    {
      name: "events",
      type: "nats-jetstream",
      healthy: true,
      capabilities: {
        rpc: true,
        consumerControls: true,
        backfill: true,
        durable: true,
        replay: true,
        deadLetters: true,
        keyOrdering: false,
      },
    },
  ],
  streams: [],
  subscriptions: [subscription],
} as unknown as Snapshot
const letter: Letter = {
  id: "dead-1",
  messageID: "order-1",
  messageType: "orders.placed.v1",
  delivery: {
    stream: "orders",
    consumerID: "consumer",
    subscriptionID: "work",
    destination: identity,
    mode: "competing",
    attempt: 5,
    sequence: 12,
  },
  failedAt: "2026-10-09T12:00:00Z",
  replayed: false,
}
const consumer: ConsumerInfo = {
  subscription,
  provider: "events",
  consumerID: "consumer",
  pending: 5,
  ackPending: 2,
  redelivered: 1,
  paused: false,
  processing: { count: 3, total: 6e6, average: 2e6, max: 3e6 },
  delivery: { count: 3, total: 9e6, average: 3e6, max: 5e6 },
}
const job: Backfill = {
  messageType: "orders.placed.v1",
  input: { id: "job-1", subscription: "work", start: 1, end: 5 },
  consumerID: "consumer",
  stream: "orders",
  provider: "events",
  state: "complete",
  next: 6,
  published: 5,
  skipped: 0,
  updatedAt: "2026-10-09T12:00:00Z",
  persisted: true,
}
const hook: HookEvent = {
  stage: "delivered",
  identity,
  at: "2026-10-09T12:00:00Z",
  duration: 2e6,
  message: { id: "order-1", type: "orders.placed.v1" },
  delivery: {
    stream: "orders",
    consumerID: "consumer",
    subscriptionID: "work",
    destination: identity,
    mode: "competing",
    attempt: 1,
    sequence: 12,
  },
}

function client(answers: Record<string, unknown>): ScopedClient {
  return {
    extension: "conduit",
    query: async (intent: string) => {
      if (!(intent in answers)) throw new ContractError("NOT_FOUND", intent)
      return answers[intent]
    },
    command: async () => ({}),
  } as ScopedClient
}

beforeEach(() => queryStore.clear())
afterEach(cleanup)

describe("Conduit pages follow the shared layout", () => {
  it("ConduitServicesPage follows the shared layout", async () => {
    const { container } = render(
      <PluginProvider
        client={client({
          "services.list": {
            instances: [{ identity, ready: true, version: "1", endpoints: [] }],
          },
        })}
      >
        <ConduitServicesPage />
      </PluginProvider>
    )
    await screen.findByText("one")
    expect(layoutViolations(container)).toEqual([])
  })

  it("ConduitDeadLettersPage follows the shared layout", async () => {
    const { container } = render(
      <PluginProvider
        client={client({
          overview: snapshot,
          "deadletters.list": { letters: [letter], nextCursor: "more" },
        })}
      >
        <ConduitDeadLettersPage />
      </PluginProvider>
    )
    await screen.findByText("order-1")
    expect(layoutViolations(container)).toEqual([])
  })

  it("ConduitHooksPage follows the shared layout", async () => {
    const { container } = render(
      <PluginProvider client={client({ "hooks.list": { events: [hook] } })}>
        <ConduitHooksPage />
      </PluginProvider>
    )
    await screen.findByText("delivered")
    expect(layoutViolations(container)).toEqual([])
  })

  it("ConduitConsumersPage follows the shared layout", async () => {
    const { container } = render(
      <PluginProvider
        client={client({
          "consumers.list": { consumers: [consumer] },
          "backfills.list": { jobs: [job], nextCursor: "more" },
        })}
      >
        <ConduitConsumersPage />
      </PluginProvider>
    )
    await screen.findByText("job-1")
    expect(layoutViolations(container)).toEqual([])
  })
})
