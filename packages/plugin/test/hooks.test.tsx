import { describe, expect, it, vi } from "vitest"
import { act, renderHook } from "@testing-library/react"
import type { ReactNode } from "react"
import { PluginProvider } from "../src/context"
import { useQuery } from "../src/hooks"
import type { ScopedClient } from "../src/client"

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe("useQuery", () => {
  // The automatic request fired on mount and a manual refetch() can overlap.
  // If the first one issued happens to be the last one to settle, its result
  // must not clobber the newer request's result: state has to reflect
  // whichever request was issued most recently, not whichever happened to
  // resolve most recently.
  it("keeps the later request's result when the earlier request resolves after it", async () => {
    const first = deferred<{ n: number }>()
    const second = deferred<{ n: number }>()
    const queryMock = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)

    const client: ScopedClient = {
      extension: "billing",
      query: queryMock,
      command: vi.fn(),
    }

    const wrapper = ({ children }: { children: ReactNode }) => (
      <PluginProvider client={client}>{children}</PluginProvider>
    )

    const { result } = renderHook(() => useQuery<{ n: number }>("x.y"), { wrapper })

    // A second, overlapping request: issued while the first is still in flight.
    await act(async () => {
      result.current.refetch()
    })

    expect(queryMock).toHaveBeenCalledTimes(2)

    // The later request (second) settles first...
    await act(async () => {
      second.resolve({ n: 2 })
    })

    // ...then the earlier request (first) settles after it.
    await act(async () => {
      first.resolve({ n: 1 })
    })

    expect(result.current.data).toEqual({ n: 2 })
    expect(result.current.loading).toBe(false)
  })
})
