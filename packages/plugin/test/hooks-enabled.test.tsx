import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { PluginProvider } from "../src/context"
import { useQuery } from "../src/hooks"
import { queryStore } from "../src/store"
import type { ScopedClient } from "../src/client"

function clientWith(query: ScopedClient["query"]): ScopedClient {
  return { extension: "billing", query, command: vi.fn() }
}

function wrapperFor(client: ScopedClient) {
  return ({ children }: { children: ReactNode }) => (
    <PluginProvider client={client}>{children}</PluginProvider>
  )
}

beforeEach(() => queryStore.clear())
afterEach(() => queryStore.clear())

describe("useQuery enabled option", () => {
  it("issues no request while disabled, and says so in what it returns", async () => {
    const query = vi.fn(async () => ({ n: 1 }))
    const { result } = renderHook(
      () => useQuery<{ n: number }>("x.y", { a: 1 }, { enabled: false }),
      { wrapper: wrapperFor(clientWith(query as ScopedClient["query"])) }
    )
    await act(async () => {})
    expect(query).not.toHaveBeenCalled()
    expect(result.current.data).toBeUndefined()
    expect(result.current.error).toBeUndefined()
    expect(result.current.loading).toBe(false)
    expect(typeof result.current.refetch).toBe("function")
  })

  it("issues exactly one request when it turns from disabled to enabled", async () => {
    const query = vi.fn(async () => ({ n: 1 }))
    const client = clientWith(query as ScopedClient["query"])
    const { result, rerender } = renderHook(
      ({ enabled }) => useQuery<{ n: number }>("x.y", undefined, { enabled }),
      { wrapper: wrapperFor(client), initialProps: { enabled: false } }
    )
    await act(async () => {})
    expect(query).not.toHaveBeenCalled()

    rerender({ enabled: true })
    await waitFor(() => expect(result.current.data).toEqual({ n: 1 }))
    expect(query).toHaveBeenCalledTimes(1)
    expect(result.current.loading).toBe(false)
  })

  it("does not subscribe while disabled, so invalidating it issues nothing", async () => {
    const query = vi.fn(async () => ({ n: 1 }))
    const client = clientWith(query as ScopedClient["query"])
    // Another reader has put an entry in the store for the same key, so an
    // invalidation has something to reissue if this hook were listening.
    const key = queryStore.keyOf("billing", "x.y", undefined)
    queryStore.read(key, () => Promise.resolve({ n: 0 }), 0)
    await act(async () => {})

    const { result } = renderHook(
      () => useQuery<{ n: number }>("x.y", undefined, { enabled: false }),
      { wrapper: wrapperFor(client) }
    )
    act(() => queryStore.invalidate("billing", ["x.y"]))
    await act(async () => {})

    expect(query).not.toHaveBeenCalled()
    // It does not read the entry another reader left behind either.
    expect(result.current.data).toBeUndefined()
    expect(result.current.loading).toBe(false)
  })

  it("does nothing on refetch while disabled", async () => {
    const query = vi.fn(async () => ({ n: 1 }))
    const { result } = renderHook(
      () => useQuery<{ n: number }>("x.y", undefined, { enabled: false }),
      { wrapper: wrapperFor(clientWith(query as ScopedClient["query"])) }
    )
    act(() => result.current.refetch())
    await act(async () => {})
    expect(query).not.toHaveBeenCalled()
    expect(result.current.loading).toBe(false)
  })

  it("stops listening when it turns from enabled to disabled", async () => {
    const query = vi.fn(async () => ({ n: 1 }))
    const client = clientWith(query as ScopedClient["query"])
    const { result, rerender } = renderHook(
      ({ enabled }) => useQuery<{ n: number }>("x.y", undefined, { enabled }),
      { wrapper: wrapperFor(client), initialProps: { enabled: true } }
    )
    await waitFor(() => expect(result.current.data).toEqual({ n: 1 }))
    rerender({ enabled: false })
    expect(result.current.data).toBeUndefined()

    act(() => queryStore.invalidate("billing", ["x.y"]))
    await act(async () => {})
    expect(query).toHaveBeenCalledTimes(1)
  })

  it("keeps today's behaviour when the option is absent or true", async () => {
    const query = vi.fn(async () => ({ n: 1 }))
    const client = clientWith(query as ScopedClient["query"])
    const a = renderHook(() => useQuery<{ n: number }>("x.y"), {
      wrapper: wrapperFor(client),
    })
    await waitFor(() => expect(a.result.current.data).toEqual({ n: 1 }))
    const b = renderHook(
      () => useQuery<{ n: number }>("x.z", undefined, { enabled: true }),
      {
        wrapper: wrapperFor(client),
      }
    )
    await waitFor(() => expect(b.result.current.data).toEqual({ n: 1 }))
    expect(query).toHaveBeenCalledTimes(2)
  })
})
