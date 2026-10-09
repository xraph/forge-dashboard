import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import type { ReactNode } from "react"
import {
  ContractError,
  createScopedClient,
  PluginProvider,
  queryStore,
} from "@forge-go/dashboard-plugin"
import type { ScopedClient } from "@forge-go/dashboard-plugin"
import { useDurableRead } from "../src/durable-read"
import { useLive } from "../src/read"
import { clientFor } from "./harness"
const originalVisibility = Object.getOwnPropertyDescriptor(
  document,
  "visibilityState"
)
function visible(state: string) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: state,
  })
  document.dispatchEvent(new Event("visibilitychange"))
}
afterEach(() => {
  vi.useRealTimers()
  if (originalVisibility)
    Object.defineProperty(document, "visibilityState", originalVisibility)
  else Reflect.deleteProperty(document, "visibilityState")
})
function wrapper(client: ScopedClient) {
  return ({ children }: { children: ReactNode }) => (
    <PluginProvider client={client}>{children}</PluginProvider>
  )
}
it("cancels hidden requests, ignores late abort results, and resumes bounded polling", async () => {
  let resolveOld!: (value: unknown) => void
  const signals: AbortSignal[] = []
  const query = vi.fn(
    (
      intent: string,
      params?: Record<string, unknown>,
      options?: { signal?: AbortSignal }
    ) => {
      void intent
      void params
      signals.push(options!.signal!)
      if (signals.length === 1)
        return new Promise((resolve) => {
          resolveOld = resolve
        })
      return Promise.resolve({
        as_of: "2026-10-09T12:00:00Z",
        revision: "current",
      })
    }
  )
  const client: ScopedClient = {
    extension: "dispatch",
    query: query as ScopedClient["query"],
    command: async () => undefined as never,
  }
  const { result } = renderHook(
    () => {
      const read = useDurableRead<{ as_of: string; revision: string }>(
        "durable.execution",
        { namespace: "production" }
      )
      useLive(read, 10_000)
      return read
    },
    { wrapper: wrapper(client) }
  )
  await waitFor(() => expect(query).toHaveBeenCalledOnce())
  act(() => visible("hidden"))
  expect(signals[0].aborted).toBe(true)
  await act(async () => resolveOld({ as_of: "old", revision: "protected old" }))
  expect(result.current.data).toBeUndefined()
  expect(result.current.error).toBeUndefined()
  act(() => visible("visible"))
  await waitFor(() => expect(result.current.data?.revision).toBe("current"))
  vi.useFakeTimers()
  act(() => visible("hidden"))
  await act(async () => vi.advanceTimersByTime(30_000))
  const before = query.mock.calls.length
  act(() => visible("visible"))
  await act(async () => Promise.resolve())
  expect(query.mock.calls.length).toBeGreaterThan(before)
  await act(async () => vi.advanceTimersByTime(10_000))
  expect(query.mock.calls.length).toBeGreaterThan(before + 1)
})
it("retains transient same-scope data and clears it immediately on host context reset or denial", async () => {
  let failure = ""
  const client = clientFor({
    "durable.execution": () => {
      if (failure) throw new ContractError(failure, "Fixture failure")
      return { as_of: "observed", revision: "7" }
    },
  })
  const { result } = renderHook(
    () =>
      useDurableRead<{ as_of: string; revision: string }>("durable.execution", {
        namespace: "production",
      }),
    { wrapper: wrapper(client) }
  )
  await waitFor(() => expect(result.current.data?.revision).toBe("7"))
  failure = "UNAVAILABLE"
  act(() => result.current.refetch())
  await waitFor(() => expect(result.current.error?.code).toBe("UNAVAILABLE"))
  expect(result.current.data?.asOf).toBe("observed")
  act(() => queryStore.clear())
  expect(result.current.data).toBeUndefined()
  await waitFor(() => expect(result.current.error?.code).toBe("UNAVAILABLE"))
  failure = "PERMISSION_DENIED"
  act(() => result.current.refetch())
  await waitFor(() =>
    expect(result.current.error?.code).toBe("PERMISSION_DENIED")
  )
  expect(result.current.data).toBeUndefined()
})
it("command metadata invalidates and refetches active durable reads through the shared store", async () => {
  let count = 0
  const fetcher = vi.fn(
    async (_url: string | URL | Request, init?: RequestInit) => {
      if (!init?.body)
        return {
          ok: true,
          json: async () => ({ token: "fixture-csrf" }),
        } as Response
      const input = JSON.parse(String(init.body))
      return {
        ok: true,
        json: async () =>
          input.kind === "command"
            ? {
                ok: true,
                data: {},
                meta: { invalidates: ["durable.execution"] },
              }
            : {
                ok: true,
                data: { as_of: "observed", revision: String(++count) },
              },
      } as Response
    }
  )
  const client = createScopedClient(
    "/contract",
    "dispatch",
    fetcher,
    (info) => {
      if (info.kind === "command")
        queryStore.invalidate(info.extension, info.meta.invalidates ?? [])
    }
  )
  const { result } = renderHook(
    () =>
      useDurableRead<{ as_of: string; revision: string }>("durable.execution", {
        namespace: "production",
      }),
    { wrapper: wrapper(client) }
  )
  await waitFor(() => expect(result.current.data?.revision).toBe("1"))
  await act(async () => {
    await client.command("test-only.invalidate")
  })
  await waitFor(() => expect(result.current.data?.revision).toBe("2"))
})
