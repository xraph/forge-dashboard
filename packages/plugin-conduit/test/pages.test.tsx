import { beforeEach, describe, expect, it } from "vitest"
import {
  render,
  fireEvent,
  screen,
  within,
  waitFor,
} from "@testing-library/react"
import {
  PluginProvider,
  ContractError,
  queryStore,
  type ScopedClient,
} from "@forge-go/dashboard-plugin"
import {
  ConduitOverviewPage,
  ConduitServicesPage,
  ConduitDeadLettersPage,
  ConduitHooksPage,
} from "../src/pages"
import type { Letter, Snapshot } from "../src/types"

const identity = { namespace: "prod", serviceID: "billing", instanceID: "one" }
const snapshot: Snapshot = {
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
  subscriptions: [
    {
      id: "work",
      stream: "orders",
      messageType: "orders.placed.v1",
      mode: "competing",
      durable: true,
      concurrency: 4,
      maxInFlight: 16,
      timeout: 30000000000,
      maxAttempts: 5,
      retryDelay: 1000000000,
      startAt: "all",
    },
  ],
  published: 12,
  handled: 10,
  acknowledged: 9,
  failed: 3,
  retried: 2,
  deadLettered: 1,
  observerDrops: 0,
  rpcCalls: 0,
  rpcHandled: 0,
  rpcFailed: 0,
  rpcTimedOut: 0,
}
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
beforeEach(() => queryStore.clear())
function client(
  answers: Record<string, unknown>,
  command: (
    intent: string,
    payload: unknown
  ) => Promise<unknown> = async () => ({})
): ScopedClient {
  return {
    extension: "conduit",
    query: async (intent: string) => {
      if (!(intent in answers)) throw new ContractError("NOT_FOUND", intent)
      return answers[intent]
    },
    command,
  } as ScopedClient
}
describe("Conduit pages", () => {
  it("shows instance counters and competing delivery semantics", async () => {
    render(
      <PluginProvider client={client({ overview: snapshot })}>
        <ConduitOverviewPage />
      </PluginProvider>
    )
    expect(await screen.findByText("One instance")).toBeTruthy()
    expect(screen.getByText("Acknowledged")).toBeTruthy()
    expect(screen.getByText("4 / 16")).toBeTruthy()
    expect(screen.getAllByText("Durable")).toBeTruthy()
  })
  it("keeps service identity shared while showing separate replicas", async () => {
    render(
      <PluginProvider
        client={client({
          "services.list": {
            instances: ["one", "two"].map((instanceID) => ({
              identity: { ...identity, instanceID },
              ready: true,
              version: "1",
              endpoints: [],
            })),
          },
        })}
      >
        <ConduitServicesPage />
      </PluginProvider>
    )
    expect(await screen.findByText("one")).toBeTruthy()
    expect(screen.getAllByText("billing")).toHaveLength(2)
    expect(screen.getByText("two")).toBeTruthy()
  })
  it("uses the shared empty state for no registered instances", async () => {
    const { container } = render(
      <PluginProvider client={client({ "services.list": { instances: [] } })}>
        <ConduitServicesPage />
      </PluginProvider>
    )
    expect(
      await screen.findByText("No registered service instances.")
    ).toBeTruthy()
    expect(container.querySelector('[role="status"] svg')).toBeTruthy()
  })
  it("confirms replay with its original subscription and refreshes the result", async () => {
    const answers: Record<string, unknown> = {
      overview: snapshot,
      "deadletters.list": { letters: [letter], nextCursor: "" },
    }
    const sent: unknown[] = []
    render(
      <PluginProvider
        client={client(answers, async (intent, payload) => {
          sent.push({ intent, payload })
          answers["deadletters.list"] = {
            letters: [{ ...letter, replayed: true }],
            nextCursor: "",
          }
          return { messageID: "order-1", persisted: true }
        })}
      >
        <ConduitDeadLettersPage />
      </PluginProvider>
    )
    fireEvent.click(
      await screen.findByRole("button", { name: "Replay order-1" })
    )
    const dialog = screen.getByRole("alertdialog")
    expect(within(dialog).getByText(/original message ID/)).toBeTruthy()
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Replay event" })
    )
    await screen.findByText("Replayed")
    expect(sent).toEqual([
      {
        intent: "deadletters.replay",
        payload: { provider: "events", subscription: "work", id: "dead-1" },
      },
    ])
  })
  it("keeps a replay failure inside the open confirmation dialog", async () => {
    render(
      <PluginProvider
        client={client(
          {
            overview: snapshot,
            "deadletters.list": { letters: [letter], nextCursor: "" },
          },
          async () => {
            throw new ContractError("UNAVAILABLE", "Broker disconnected")
          }
        )}
      >
        <ConduitDeadLettersPage />
      </PluginProvider>
    )
    fireEvent.click(
      await screen.findByRole("button", { name: "Replay order-1" })
    )
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Replay event",
      })
    )
    await waitFor(() =>
      expect(
        within(screen.getByRole("alertdialog")).getByText("Broker disconnected")
      ).toBeTruthy()
    )
  })
  it("renders query failures as errors instead of empty results", async () => {
    const failing = {
      extension: "conduit",
      command: async () => ({}),
      query: async () => {
        throw new ContractError("PERMISSION_DENIED", "Scope denied")
      },
    } as ScopedClient
    render(
      <PluginProvider client={failing}>
        <ConduitHooksPage />
      </PluginProvider>
    )
    expect(await screen.findByText(/Scope denied/)).toBeTruthy()
    expect(
      screen.queryByText("No communication outcomes recorded yet.")
    ).toBeNull()
  })
})
