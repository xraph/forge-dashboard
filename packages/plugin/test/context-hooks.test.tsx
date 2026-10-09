import { act, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { expect, it, vi } from "vitest"
import { PluginProvider } from "../src/context"
import { useQuery } from "../src/hooks"
import { queryStore } from "../src/store"
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
