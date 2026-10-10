import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, expect, it, vi } from "vitest"
import { PluginProvider } from "../src/context"
import { useQuery } from "../src/hooks"
import { queryStore } from "../src/store"
afterEach(() => {
  cleanup()
  queryStore.clear()
})

function pendingReader(intent: string, staleMs = 60_000) {
  const requests: { signal?: AbortSignal; resolve: (value: string) => void }[] =
    []
  const query = vi.fn(
    (_intent: string, _params: unknown, opts?: { signal?: AbortSignal }) =>
      new Promise<string>((resolve) =>
        requests.push({ signal: opts?.signal, resolve })
      )
  )
  const client = {
    extension: "dispatch",
    query: query as never,
    command: vi.fn(),
  }
  const wrapper = ({ children }: { children: ReactNode }) => (
    <PluginProvider client={client}>{children}</PluginProvider>
  )
  queryStore.noteStaleTime("dispatch", intent, staleMs)
  return { requests, query, wrapper }
}

it.each(["pending", "fresh"])(
  "removes context reset from a same-owner %s read without stranding it",
  async (state) => {
    const intent = "reset-removal-" + state
    const { requests, query, wrapper } = pendingReader(
      intent,
      state === "fresh" ? 60_000 : 0
    )
    const view = renderHook(
      ({ reset }) =>
        useQuery(intent, undefined, {
          resetOnContextChange: reset,
          cancelOnUnused: true,
        }),
      { wrapper, initialProps: { reset: true } }
    )
    if (state === "fresh") await act(async () => requests[0].resolve("old"))
    view.rerender({ reset: false })
    expect(query).toHaveBeenCalledOnce()
    act(() => {
      queryStore.clear()
      expect(query).toHaveBeenCalledTimes(2)
    })
    await waitFor(() => expect(query).toHaveBeenCalledTimes(2))
    expect(requests[0].signal?.aborted).toBe(true)
    await act(async () => requests[0].resolve("ignored old"))
    expect(view.result.current.data).toBeUndefined()
    await act(async () => requests[1].resolve("current"))
    expect(view.result.current.data).toBe("current")
    expect(view.result.current.loading).toBe(false)
  }
)

it.each(["pending", "fresh"])(
  "retains reset for another active reader of a %s key and resumes both after clear",
  async (state) => {
    const intent = "mixed-reset-" + state
    const { requests, query, wrapper } = pendingReader(
      intent,
      state === "fresh" ? 60_000 : 0
    )
    const opted = renderHook(
      () =>
        useQuery(intent, undefined, {
          resetOnContextChange: true,
          cancelOnUnused: true,
        }),
      { wrapper }
    )
    const ordinary = renderHook(
      ({ reset }) =>
        useQuery(intent, undefined, {
          resetOnContextChange: reset,
          cancelOnUnused: true,
        }),
      { wrapper, initialProps: { reset: true } }
    )
    if (state === "fresh") await act(async () => requests[0].resolve("old"))
    ordinary.rerender({ reset: false })
    expect(query).toHaveBeenCalledOnce()
    act(() => {
      queryStore.clear()
      // Preserve the hint to exclude an unrelated stale-time dependency change.
      queryStore.noteStaleTime(
        "dispatch",
        intent,
        state === "fresh" ? 60_000 : 0
      )
      // No captured request may run synchronously while an opted-in reader remains.
      expect(query).toHaveBeenCalledOnce()
    })
    await waitFor(() => expect(query).toHaveBeenCalledTimes(2))
    await act(async () => requests[0].resolve("ignored old"))
    expect(opted.result.current.data).toBeUndefined()
    expect(ordinary.result.current.data).toBeUndefined()
    await act(async () => requests[1].resolve("current"))
    expect(opted.result.current.data).toBe("current")
    expect(ordinary.result.current.data).toBe("current")
    opted.unmount()
    act(() => {
      queryStore.clear()
      expect(query).toHaveBeenCalledTimes(3)
    })
    await act(async () => requests[2].resolve("ordinary current"))
    expect(ordinary.result.current.data).toBe("ordinary current")
    ordinary.unmount()
    act(() => queryStore.clear())
    expect(query).toHaveBeenCalledTimes(3)
  }
)

it.each(["pending", "fresh"])(
  "keeps the remaining opted-in %s reader protected when the ordinary reader unmounts first",
  async (state) => {
    const intent = "ordinary-unmount-first-" + state
    const { requests, query, wrapper } = pendingReader(intent)
    const opted = renderHook(
      () =>
        useQuery(intent, undefined, {
          resetOnContextChange: true,
          cancelOnUnused: true,
        }),
      { wrapper }
    )
    const ordinary = renderHook(
      () => useQuery(intent, undefined, { cancelOnUnused: true }),
      { wrapper }
    )
    if (state === "fresh") await act(async () => requests[0].resolve("old"))
    ordinary.unmount()
    expect(requests[0].signal?.aborted).toBe(false)
    act(() => {
      queryStore.clear()
      expect(query).toHaveBeenCalledOnce()
    })
    await waitFor(() => expect(query).toHaveBeenCalledTimes(2))
    await act(async () => requests[0].resolve("ignored old"))
    expect(opted.result.current.data).toBeUndefined()
    await act(async () => requests[1].resolve("current"))
    expect(opted.result.current.data).toBe("current")
    opted.unmount()
    act(() => queryStore.clear())
    expect(query).toHaveBeenCalledTimes(2)
  }
)
it("keeps disabled context-aware reads idle, resumes with current context and releases on unmount", async () => {
  const query = vi.fn(async () => "current")
  const client = {
    extension: "dispatch",
    query: query as never,
    command: vi.fn(),
  }
  const wrapper = ({ children }: { children: ReactNode }) => (
    <PluginProvider client={client}>{children}</PluginProvider>
  )
  const { result, rerender, unmount } = renderHook(
    ({ enabled }) =>
      useQuery("durable.context-lifecycle", undefined, {
        enabled,
        resetOnContextChange: true,
        cancelOnUnused: true,
      }),
    { wrapper, initialProps: { enabled: false } }
  )
  act(() => queryStore.clear())
  expect(query).not.toHaveBeenCalled()
  rerender({ enabled: true })
  await waitFor(() => expect(result.current.data).toBe("current"))
  expect(query).toHaveBeenCalledOnce()
  act(() => queryStore.clear())
  await waitFor(() => expect(query).toHaveBeenCalledTimes(2))
  rerender({ enabled: false })
  act(() => queryStore.clear())
  expect(query).toHaveBeenCalledTimes(2)
  unmount()
  act(() => queryStore.clear())
  expect(query).toHaveBeenCalledTimes(2)
})
