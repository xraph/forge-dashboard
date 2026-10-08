import { afterEach, expect, it, vi } from "vitest"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import {
  ContractError,
  PluginProvider,
  queryStore,
} from "@forge-go/dashboard-plugin"
import type { QueryState } from "@forge-go/dashboard-plugin"
import { Read, useDispatchQuery } from "../src/read"
import { clientFor, renderWithClient } from "./harness"

const snapshot = { asOf: "2026-10-08T18:00:00Z", name: "first job" }
function Probe({ id }: { id: string }) {
  const query = useDispatchQuery<typeof snapshot>("jobs.get", { id })
  return (
    <Read title="Job" query={query}>
      {(data) => <p>{data.name}</p>}
    </Read>
  )
}
afterEach(() => vi.useRealTimers())
it("discards retained data when the host clears identity or context caches", async () => {
  let calls = 0
  let reject!: (error: Error) => void
  const client = clientFor({
    "jobs.get": () => {
      calls++
      if (calls === 1) return snapshot
      return new Promise((_resolve, rejectRead) => {
        reject = rejectRead
      })
    },
  })
  renderWithClient(<Probe id="a" />, client)
  await screen.findByText("first job")
  act(() => queryStore.clear())
  expect(screen.queryByText("first job")).toBeNull()
  expect(screen.getByRole("status", { name: "Loading Job" })).toBeTruthy()
  await act(async () =>
    reject(new ContractError("UNAVAILABLE", "Store unavailable"))
  )
  expect(screen.queryByText("first job")).toBeNull()
  expect(screen.getByRole("alert").textContent).toContain("UNAVAILABLE")
})
it("keeps the stale warning visible while a failed refresh is retried", async () => {
  let calls = 0
  let finish!: (value: typeof snapshot) => void
  const client = clientFor({
    "jobs.get": () => {
      calls++
      if (calls === 1) return snapshot
      if (calls === 2)
        throw new ContractError("UNAVAILABLE", "Store unavailable")
      return new Promise<typeof snapshot>((resolve) => {
        finish = resolve
      })
    },
  })
  renderWithClient(<Probe id="a" />, client)
  await screen.findByText("first job")
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }))
  await screen.findByText(/Stale since/)
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }))
  expect(screen.getByText(/Stale since/)).toBeTruthy()
  await act(async () => finish({ ...snapshot, name: "refreshed job" }))
  await screen.findByText("refreshed job")
  expect(screen.queryByText(/Stale since/)).toBeNull()
})
it("retains the last successful snapshot on transient failure and recovers", async () => {
  let failure = false
  const client = clientFor({
    "jobs.get": () => {
      if (failure) throw new ContractError("UNAVAILABLE", "Store unavailable")
      return snapshot
    },
  })
  renderWithClient(<Probe id="a" />, client)
  await screen.findByText("first job")
  failure = true
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }))
  await screen.findByText("Refresh failed")
  expect(screen.getByText("first job")).toBeTruthy()
  expect(screen.getByText(/Stale since/)).toBeTruthy()
  failure = false
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }))
  await waitFor(() => expect(screen.queryByText("Refresh failed")).toBeNull())
  expect(screen.getByText(/As of/)).toBeTruthy()
})
it.each(["PERMISSION_DENIED", "UNAUTHENTICATED", "NOT_FOUND"])(
  "clears retained data after %s",
  async (code) => {
    let failure = false
    const client = clientFor({
      "jobs.get": () => {
        if (failure) throw new ContractError(code, "Read refused")
        return snapshot
      },
    })
    renderWithClient(<Probe id="a" />, client)
    await screen.findByText("first job")
    failure = true
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }))
    await waitFor(() => expect(screen.queryByText("first job")).toBeNull())
    if (code === "NOT_FOUND")
      expect(screen.getByText("Job not found")).toBeTruthy()
    else expect(screen.getByRole("alert").textContent).toContain(code)
  }
)
it("never retains data from another ID while that read is pending", async () => {
  const client = clientFor({
    "jobs.get": (params) =>
      (params as { id: string }).id === "a" ? snapshot : new Promise(() => {}),
  })
  const view = renderWithClient(<Probe id="a" />, client)
  await screen.findByText("first job")
  view.rerender(
    <PluginProvider client={client}>
      <Probe id="b" />
    </PluginProvider>
  )
  expect(screen.queryByText("first job")).toBeNull()
  expect(screen.getByRole("status", { name: "Loading Job" })).toBeTruthy()
})
it("polls only nonterminal snapshots and stops on hidden tabs", () => {
  vi.useFakeTimers()
  const refetch = vi.fn()
  type Data = { asOf: string; terminal: boolean }
  const query: QueryState<Data> = {
    data: { asOf: snapshot.asOf, terminal: false },
    loading: false,
    refetch,
  }
  const interval = (data: Data | undefined) => (data?.terminal ? null : 5_000)
  const view = render(
    <Read title="Job" query={query} intervalMs={interval}>
      {() => <p>loaded</p>}
    </Read>
  )
  act(() => vi.advanceTimersByTime(5_000))
  expect(refetch).toHaveBeenCalledTimes(1)
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "hidden",
  })
  fireEvent(document, new Event("visibilitychange"))
  act(() => vi.advanceTimersByTime(15_000))
  expect(refetch).toHaveBeenCalledTimes(1)
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  })
  fireEvent(document, new Event("visibilitychange"))
  expect(refetch).toHaveBeenCalledTimes(2)
  view.rerender(
    <Read
      title="Job"
      query={{ ...query, data: { ...query.data!, terminal: true } }}
      intervalMs={interval}
    >
      {() => <p>loaded</p>}
    </Read>
  )
  act(() => vi.advanceTimersByTime(30_000))
  expect(refetch).toHaveBeenCalledTimes(2)
})
