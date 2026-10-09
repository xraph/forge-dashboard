import { beforeEach, expect, it, vi } from "vitest"
import {
  render,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import {
  PluginProvider,
  queryStore,
  type ScopedClient,
} from "@forge-go/dashboard-plugin"
import { ConduitConsumersPage } from "../src/consumers"
import type { ConsumerInfo } from "../src/types"
const row: ConsumerInfo = {
  subscription: {
    id: "work",
    stream: "orders",
    messageType: "orders.placed.v1",
    mode: "competing",
    durable: true,
    concurrency: 2,
    maxInFlight: 8,
    timeout: 1e9,
    maxAttempts: 3,
    retryDelay: 1e9,
    startAt: "all",
  },
  provider: "events",
  consumerID: "consumer",
  pending: 5,
  ackPending: 2,
  redelivered: 1,
  paused: false,
  processing: { count: 3, total: 6e6, average: 2e6, max: 3e6 },
  delivery: { count: 3, total: 9e6, average: 3e6, max: 5e6 },
}
beforeEach(() => queryStore.clear())
it("confirms broker pause and sends a bounded backfill with its retained operation ID", async () => {
  const command = vi.fn(async () => ({}))
  const client = {
    extension: "conduit",
    query: async (intent: string) =>
      intent === "consumers.list"
        ? { consumers: [row] }
        : { jobs: [], nextCursor: "" },
    command,
  } as unknown as ScopedClient
  render(
    <PluginProvider client={client}>
      <ConduitConsumersPage />
    </PluginProvider>
  )
  fireEvent.click(await screen.findByRole("button", { name: "Pause" }))
  fireEvent.click(screen.getByRole("button", { name: "Pause consumer" }))
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith(
      "consumers.pause",
      {
        subscription: "work",
      },
      undefined
    )
  )
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
  fireEvent.click(screen.getByRole("button", { name: "Backfill" }))
  const dialog = screen.getByRole("alertdialog")
  const id = (within(dialog).getByLabelText("Operation ID") as HTMLInputElement)
    .value
  fireEvent.change(within(dialog).getByLabelText("End sequence"), {
    target: { value: "101" },
  })
  expect(
    within(dialog)
      .getByRole("button", { name: "Run backfill" })
      .hasAttribute("disabled")
  ).toBe(true)
  fireEvent.change(within(dialog).getByLabelText("End sequence"), {
    target: { value: "5" },
  })
  fireEvent.click(within(dialog).getByRole("button", { name: "Run backfill" }))
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith(
      "backfills.run",
      {
        id,
        subscription: "work",
        start: 1,
        end: 5,
      },
      undefined
    )
  )
})
