import { act, fireEvent, screen, waitFor } from "@testing-library/react"
import { expect, it, vi } from "vitest"
import {
  ContractError,
  PluginProvider,
  queryStore,
} from "@forge-go/dashboard-plugin"
import { DurableExecutionPage } from "../src/pages/durable-execution"
import { encodeRunPart } from "../src/durable-types"
import { DurableExecutionsPage } from "../src/pages/durable-executions"
import { clientFor, renderWithClient } from "./harness"
import wire from "./durable-wire.json"

function discovery() {
  const calls = vi.fn((params: unknown) => {
    void params
    return {
      ...wire.discovery_complete.data,
      cursor: "bound-cursor",
      complete: false,
    }
  })
  return { calls, client: clientFor({ "durable.namespaces": calls }) }
}
async function next() {
  await screen.findByRole("button", { name: "production" })
  fireEvent.click(screen.getByRole("button", { name: "Next" }))
}
it("does not send a retained cursor when a mounted reader changes client", async () => {
  const first = discovery(),
    second = discovery()
  const view = renderWithClient(<DurableExecutionsPage />, first.client)
  await next()
  await waitFor(() =>
    expect(first.calls).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: "bound-cursor" })
    )
  )
  view.rerender(
    <PluginProvider client={second.client}>
      <DurableExecutionsPage />
    </PluginProvider>
  )
  await waitFor(() => expect(second.calls).toHaveBeenCalled())
  expect(
    second.calls.mock.calls.every(
      ([p]) => (p as { cursor: string }).cursor === ""
    )
  ).toBe(true)
})
it("does not synchronously replay an old cursor on a same-client host context clear", async () => {
  const { calls, client } = discovery()
  renderWithClient(<DurableExecutionsPage />, client)
  await next()
  await waitFor(() =>
    expect(calls).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: "bound-cursor" })
    )
  )
  calls.mockClear()
  act(() => queryStore.clear())
  await waitFor(() => expect(calls).toHaveBeenCalled())
  expect(
    calls.mock.calls.every(([p]) => (p as { cursor: string }).cursor === "")
  ).toBe(true)
})
it("keeps ordinary invalidation and transient refresh on the current cursor", async () => {
  const { calls, client } = discovery()
  renderWithClient(<DurableExecutionsPage />, client)
  await next()
  await waitFor(() =>
    expect(calls).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: "bound-cursor" })
    )
  )
  calls.mockClear()
  act(() => queryStore.invalidate("dispatch", ["durable.namespaces"]))
  await waitFor(() => expect(calls).toHaveBeenCalled())
  expect(
    calls.mock.calls.every(
      ([p]) => (p as { cursor: string }).cursor === "bound-cursor"
    )
  ).toBe(true)
})
it.each(["BAD_REQUEST", "PERMISSION_DENIED", "UNAVAILABLE"])(
  "offers continuation restart after %s without losing first-page recovery",
  async (code) => {
    const calls = vi.fn((params: unknown) => {
      if ((params as { cursor: string }).cursor)
        throw new ContractError(code, "Continuation expired or refused")
      return {
        ...wire.discovery_complete.data,
        cursor: "expired",
        complete: false,
      }
    })
    renderWithClient(
      <DurableExecutionsPage />,
      clientFor({ "durable.namespaces": calls })
    )
    await next()
    await screen.findByText(/Continuation expired or refused/)
    fireEvent.click(screen.getByRole("button", { name: "Restart pagination" }))
    await waitFor(() =>
      expect(calls).toHaveBeenLastCalledWith(
        expect.objectContaining({ cursor: "" })
      )
    )
    await screen.findByRole("button", { name: "production" })
  }
)

const detailProps = {
  params: {
    namespace: encodeRunPart("production"),
    workflow: encodeRunPart("invoice-42"),
    run: encodeRunPart("run-2"),
  },
}
it.each([
  ["history", "History", wire.history.data],
  ["tasks", "Tasks", wire.tasks.data],
  ["chain", "Run chain", wire.chain_partial.data],
  ["children", "Children", wire.chain_partial.data],
  ["audit", "Source audit", wire.deliveries_blocked.data],
  ["hooks", "Hook delivery", wire.deliveries_blocked.data],
])(
  "resets %s continuation before the first request after host clear",
  async (kind, label, page) => {
    const calls = vi.fn((params: unknown) => {
      void params
      return { ...page, cursor: "scope-bound", complete: false }
    })
    const client = clientFor({
      "durable.execution": () => wire.detail.data,
      "durable.history": () => wire.history.data,
      ["durable." + kind]: calls,
    })
    renderWithClient(<DurableExecutionPage {...detailProps} />, client)
    fireEvent.click(await screen.findByRole("button", { name: label }))
    await waitFor(() => expect(calls).toHaveBeenCalled())
    fireEvent.click(await screen.findByRole("button", { name: "Next" }))
    await waitFor(() =>
      expect(calls).toHaveBeenLastCalledWith(
        expect.objectContaining({ cursor: "scope-bound" })
      )
    )
    calls.mockClear()
    act(() => queryStore.clear())
    await waitFor(() => expect(calls).toHaveBeenCalled())
    expect(
      calls.mock.calls.every(([p]) => (p as { cursor: string }).cursor === "")
    ).toBe(true)
  }
)
it("resets execution-list continuation before the first request after host clear", async () => {
  const calls = vi.fn((params: unknown) => {
    void params
    return { ...wire.executions.data, cursor: "scope-bound", complete: false }
  })
  renderWithClient(
    <DurableExecutionsPage />,
    clientFor({
      "durable.namespaces": () => wire.discovery_complete.data,
      "durable.executions": calls,
    })
  )
  fireEvent.click(await screen.findByRole("button", { name: "production" }))
  await waitFor(() => expect(calls).toHaveBeenCalled())
  fireEvent.click(screen.getAllByRole("button", { name: "Next" })[1])
  await waitFor(() =>
    expect(calls).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: "scope-bound" })
    )
  )
  calls.mockClear()
  act(() => queryStore.clear())
  await waitFor(() => expect(calls).toHaveBeenCalled())
  expect(
    calls.mock.calls.every(([p]) => (p as { cursor: string }).cursor === "")
  ).toBe(true)
})

it("fences an ignored-abort pending continuation when the mounted host clears context", async () => {
  let resolveOld!: (value: unknown) => void, oldSignal!: AbortSignal
  const calls = vi.fn(
    (
      intent: string,
      params?: Record<string, unknown>,
      options?: { signal?: AbortSignal }
    ) => {
      if (params?.cursor) {
        oldSignal = options!.signal!
        return new Promise((resolve) => {
          resolveOld = resolve
        })
      }
      return Promise.resolve({
        ...wire.discovery_complete.data,
        cursor: "old",
        complete: false,
      })
    }
  )
  renderWithClient(<DurableExecutionsPage />, {
    extension: "dispatch",
    query: calls as never,
    command: vi.fn(),
  })
  await next()
  await waitFor(() => expect(resolveOld).toBeDefined())
  calls.mockClear()
  act(() => queryStore.clear())
  await waitFor(() => expect(calls).toHaveBeenCalled())
  expect(calls.mock.calls.every(([, p]) => p?.cursor === "")).toBe(true)
  expect(oldSignal.aborted).toBe(true)
  await act(async () =>
    resolveOld({
      ...wire.discovery_complete.data,
      items: [
        {
          namespace: "protected old namespace",
          app_id: "old",
          tenant_id: "old",
        },
      ],
    })
  )
  expect(screen.queryByText("protected old namespace")).toBeNull()
  expect(screen.queryByRole("alert")).toBeNull()
})
