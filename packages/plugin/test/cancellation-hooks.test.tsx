import { act, renderHook } from "@testing-library/react"
import type { ReactNode } from "react"
import { expect, it, vi } from "vitest"
import type { ScopedClient } from "../src/client"
import { PluginProvider } from "../src/context"
import { useQuery } from "../src/hooks"
import { queryStore } from "../src/store"

it("installs owner and cancellation when a pending ordinary hook opts in", async () => {
  let resolveOld!: (value: unknown) => void
  const query = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve
        })
    )
    .mockImplementationOnce(() => new Promise(() => {}))
  const client: ScopedClient = {
    extension: "dispatch",
    query,
    command: vi.fn(),
  }
  const wrapper = ({ children }: { children: ReactNode }) => (
    <PluginProvider client={client}>{children}</PluginProvider>
  )
  const { result, rerender, unmount } = renderHook(
    ({ cancelOnUnused }) =>
      useQuery("durable.option-transition", undefined, { cancelOnUnused }),
    { wrapper, initialProps: { cancelOnUnused: false } }
  )
  expect(query).toHaveBeenCalledOnce()
  rerender({ cancelOnUnused: true })
  expect(query).toHaveBeenCalledTimes(2)
  await act(async () => resolveOld("protected old"))
  expect(result.current.data).toBeUndefined()
  expect(result.current.error).toBeUndefined()
  const signal = query.mock.calls[1][2].signal as AbortSignal
  unmount()
  expect(signal.aborted).toBe(true)
  expect(
    queryStore.snapshot(
      queryStore.keyOf("dispatch", "durable.option-transition")
    )
  ).toEqual({ loading: false })
  queryStore.clear()
})
