import { act, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import {
  ContractError,
  PluginProvider,
  queryStore,
} from "@forge-go/dashboard-plugin"
import { DurableExecutionsPage } from "../src/pages/durable-executions"
import { DurableExecutionPage } from "../src/pages/durable-execution"
import { runPath, encodeRunPart } from "../src/durable-types"
import { clientFor, renderWithClient } from "./harness"
import wire from "./durable-wire.json"

const detailProps = {
  params: {
    namespace: encodeRunPart("production"),
    workflow: encodeRunPart("invoice-42"),
    run: encodeRunPart("run-2"),
  },
}
const queries = {
  "durable.execution": () => wire.detail.data,
  "durable.history": () => wire.history.data,
  "durable.tasks": () => wire.tasks.data,
  "durable.chain": () => wire.chain_partial.data,
  "durable.children": () => wire.children_restricted.data,
  "durable.audit": () => wire.deliveries_blocked.data,
  "durable.hooks": () => wire.deliveries_blocked.data,
}
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})
it("keeps exact three-part identity, including escaped slashes and percent", () => {
  expect(runPath({ namespace: "a/b", workflow_id: "%2F", run_id: "☃/r" })).toBe(
    "/durable/v1.YS9i/v1.JTJG/v1.4piDL3I"
  )
})
it("continues empty incomplete discovery and requires explicit namespace access", async () => {
  const executions = vi.fn((params?: unknown) => {
    void params
    return wire.executions.data
  })
  const namespaces = vi.fn((params: unknown) =>
    (params as { cursor: string }).cursor
      ? wire.discovery_complete.data
      : wire.discovery_incomplete_empty.data
  )
  renderWithClient(
    <DurableExecutionsPage />,
    clientFor({
      "durable.namespaces": namespaces,
      "durable.executions": executions,
    })
  )
  await screen.findByText("No results in this portion")
  expect(executions).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole("button", { name: "Continue search" }))
  fireEvent.click(await screen.findByRole("button", { name: "production" }))
  await screen.findByText(/9007199254740993/)
  expect(executions.mock.calls[0][0]).toMatchObject({
    namespace: "production",
    cursor: "",
  })
  expect(screen.getAllByText(/Total unavailable/).length).toBeGreaterThan(0)
})
it("resets execution cursors when filters change and isolates late old-scope responses", async () => {
  let resolveOld!: (data: unknown) => void
  const executions = vi.fn((params: unknown) => {
    const p = params as {
      namespace: string
      workflow_id: string
      cursor: string
    }
    if (p.namespace === "foreign")
      return new Promise((resolve) => {
        resolveOld = resolve
      })
    return { ...wire.executions.data, cursor: "next", complete: false }
  })
  renderWithClient(
    <DurableExecutionsPage />,
    clientFor({
      "durable.namespaces": () => wire.discovery_complete.data,
      "durable.executions": executions,
    })
  )
  fireEvent.click(await screen.findByRole("button", { name: "production" }))
  await screen.findByText(/9007199254740993/)
  fireEvent.click(screen.getAllByRole("button", { name: "Next" })[1])
  await waitFor(() =>
    expect(executions).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: "next" })
    )
  )
  fireEvent.change(screen.getByLabelText("Filter Workflow ID"), {
    target: { value: "changed" },
  })
  await waitFor(() =>
    expect(executions).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: "", workflow_id: "changed" })
    )
  )
  fireEvent.change(screen.getByLabelText("Namespace"), {
    target: { value: "foreign" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Inspect namespace" }))
  await waitFor(() => expect(resolveOld).toBeDefined())
  fireEvent.click(screen.getByRole("button", { name: "production" }))
  await act(async () =>
    resolveOld({
      ...wire.executions.data,
      items: [
        { ...wire.executions.data.items[0], workflow_id: "foreign-secret" },
      ],
    })
  )
  expect(screen.queryByText("foreign-secret")).toBeNull()
})
it("renders metadata, history strings, run links, tasks and restricted children without reveal", async () => {
  const payload = vi.fn(() => wire.payload_reveal.data)
  renderWithClient(
    <DurableExecutionPage {...detailProps} />,
    clientFor({ ...queries, "durable.payload": payload })
  )
  await screen.findByText("9007199254740995")
  expect(
    screen
      .getByRole("link", { name: "invoice-42 / run-1" })
      .getAttribute("href")
  ).toContain(
    runPath({
      namespace: "production",
      workflow_id: "invoice-42",
      run_id: "run-1",
    })
  )
  expect(screen.getAllByText(/9007199254740994/).length).toBeGreaterThan(0)
  expect(payload).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole("button", { name: "Tasks" }))
  await screen.findByText(/activity:payment/)
  expect(screen.getByText("9007199254740993 / 9007199254740994")).toBeTruthy()
  fireEvent.click(screen.getByRole("button", { name: "Children" }))
  await screen.findByText(/Some linked runs are restricted/)
  fireEvent.click(screen.getByRole("button", { name: "Hook delivery" }))
  await screen.findByText(/Webhook endpoint delivery: unavailable/)
  expect(screen.getByText(/includes blocked 1/)).toBeTruthy()
})
it("updates mounted tasks from active to historical deferral to ordinary null metadata", async () => {
  const tasks = vi.fn((): unknown => wire.tasks_deferred.data)
  renderWithClient(
    <DurableExecutionPage {...detailProps} />,
    clientFor({ ...queries, "durable.tasks": tasks })
  )
  fireEvent.click(await screen.findByRole("button", { name: "Tasks" }))
  await screen.findByText("Deferred: Target retiring")
  const row = screen.getByText("Pending").closest("tr")!
  expect(within(row).getByText("2 / 9007199254740996")).toBeTruthy()
  expect(within(row).getByText(/Deferral count/).textContent).toBe(
    "Deferral count 2"
  )
  expect(within(row).getByText("Retry").textContent).toContain(
    new Date(
      wire.tasks_deferred.data.items[0].deferral.retry_at
    ).toLocaleString()
  )
  fireEvent.click(within(row).getByText("Deferral source details"))
  for (const [term, value] of [
    ["Target build", "next-build"],
    ["Target retirement epoch", "9007199254740993"],
    ["Source epoch", "9007199254740994"],
    ["Source revision", "9007199254740995"],
    ["Recorded task version", "9007199254740996"],
    ["Reference kind", "child"],
    ["Command ID", "child:payment"],
    ["Policy version", "1"],
  ]) {
    expect(within(row).getByText(term).nextElementSibling?.textContent).toBe(
      value
    )
  }
  tasks.mockReturnValue(wire.tasks_deferral_retained.data)
  act(() => queryStore.invalidate("dispatch", ["durable.tasks"]))
  await screen.findByText("Previous deferral (inactive)")
  expect(screen.getByText("Leased")).toBeTruthy()
  expect(screen.getByText("3 / 9007199254740997")).toBeTruthy()
  expect(screen.queryByText("Deferred: Target retiring")).toBeNull()
  expect(screen.queryByText("Retry", { exact: true })).toBeNull()
  fireEvent.click(screen.getByText("Historical deferral details"))
  expect(
    screen.getByText("Previous reason").nextElementSibling?.textContent
  ).toBe("target_retiring")
  expect(screen.getByText("Recorded retry")).toBeTruthy()
  expect(
    screen.getByText("Recorded task version").nextElementSibling?.textContent
  ).toBe("9007199254740996")
  // The ordinary example has a different task identity and no deferral record.
  tasks.mockReturnValue(wire.tasks.data)
  act(() => queryStore.invalidate("dispatch", ["durable.tasks"]))
  await screen.findByText("Awaiting callback")
  expect(screen.getByText("9007199254740993 / 9007199254740994")).toBeTruthy()
  expect(screen.queryByText(/Deferral count/)).toBeNull()
  expect(screen.queryByText(/deferral details/)).toBeNull()
  expect(screen.queryByText("next-build")).toBeNull()
})
it("preserves continuation's empty command identity and decimal deferral counts", async () => {
  const child = wire.tasks_deferred.data.items[0]
  renderWithClient(
    <DurableExecutionPage {...detailProps} />,
    clientFor({
      ...queries,
      "durable.tasks": () => ({
        ...wire.tasks_deferred.data,
        items: [
          {
            ...child,
            deferral: {
              ...child.deferral,
              reason: "target_retired",
              target_state: "retired",
              reference_kind: "continuation",
              command_id: "",
              count: "9007199254740993123",
              policy_version: "9007199254740997",
            },
          },
        ],
      }),
    })
  )
  fireEvent.click(await screen.findByRole("button", { name: "Tasks" }))
  await screen.findByText("Deferred: Target retired")
  expect(screen.getByText("9007199254740993123")).toBeTruthy()
  expect(screen.getByText("2 / 9007199254740996")).toBeTruthy()
  fireEvent.click(screen.getByText("Deferral source details"))
  expect(
    screen.getByText("Reference kind").nextElementSibling?.textContent
  ).toBe("continuation")
  expect(
    screen
      .getByText("Command ID")
      .nextElementSibling?.querySelector('[aria-label="no command ID"]')
  ).toBeTruthy()
  expect(screen.queryByText("child:payment")).toBeNull()
  expect(
    screen.getByText("Policy version").nextElementSibling?.textContent
  ).toBe("9007199254740997")
})
it("marks failed deferral refresh stale, removes denied facts and recovers with filtered empty results", async () => {
  let failure = ""
  const tasks = vi.fn((params: unknown) => {
    if (failure) throw new ContractError(failure, "Task read refused")
    if ((params as { kind: string }).kind)
      return { ...wire.tasks.data, items: [] }
    return wire.tasks_deferred.data
  })
  renderWithClient(
    <DurableExecutionPage {...detailProps} />,
    clientFor({ ...queries, "durable.tasks": tasks })
  )
  fireEvent.click(await screen.findByRole("button", { name: "Tasks" }))
  await screen.findByText("Deferred: Target retiring")
  failure = "UNAVAILABLE"
  act(() => queryStore.invalidate("dispatch", ["durable.tasks"]))
  await screen.findByText(/Task read refused/)
  expect(screen.getByText("Deferred: Target retiring")).toBeTruthy()
  expect(screen.getByText(/stale/i)).toBeTruthy()
  failure = "PERMISSION_DENIED"
  act(() => queryStore.invalidate("dispatch", ["durable.tasks"]))
  await screen.findByText(/PERMISSION_DENIED/)
  expect(screen.queryByText("next-build")).toBeNull()
  expect(screen.queryByText(/Deferral count/)).toBeNull()
  failure = ""
  act(() => queryStore.invalidate("dispatch", ["durable.tasks"]))
  await screen.findByText("Deferred: Target retiring")
  fireEvent.change(screen.getByLabelText("Task kind"), {
    target: { value: "unmatched" },
  })
  await screen.findByText("No matching tasks")
  expect(screen.queryByText("next-build")).toBeNull()
  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }))
  await screen.findByText("Deferred: Target retiring")
  expect(tasks).toHaveBeenLastCalledWith(
    expect.objectContaining({ kind: "", cursor: "" })
  )
})
it.each([
  "UNAUTHENTICATED",
  "PERMISSION_DENIED",
  "UNAVAILABLE",
  "BAD_REQUEST",
  "NOT_FOUND",
])("shows %s separately from empty data", async (code) => {
  renderWithClient(
    <DurableExecutionPage {...detailProps} />,
    clientFor({
      "durable.execution": () => {
        throw new ContractError(code, "Fixture refusal")
      },
    })
  )
  if (code === "NOT_FOUND")
    await screen.findByText("Durable execution not found")
  else await screen.findByText(`${code}: Fixture refusal`)
  expect(screen.queryByText("No executions yet")).toBeNull()
  expect(screen.queryByRole("button", { name: "Reveal payload" })).toBeNull()
})
it("reveals only explicitly, preserves original JSON numbers, hides and stays outside queryStore", async () => {
  const payload = vi.fn(() => ({
    ...wire.payload_reveal.data,
    input: btoa('{"amount":9007199254740993123}'),
  }))
  renderWithClient(
    <DurableExecutionPage {...detailProps} />,
    clientFor({ ...queries, "durable.payload": payload })
  )
  fireEvent.click(await screen.findByRole("button", { name: "Reveal payload" }))
  await screen.findByText(/9007199254740993123/, {}, { timeout: 10_000 })
  expect(payload).toHaveBeenCalledOnce()
  expect(
    queryStore.snapshot(
      queryStore.keyOf("dispatch", "durable.payload", {
        namespace: "production",
        workflow_id: "invoice-42",
        run_id: "run-2",
      })
    ).data
  ).toBeUndefined()
  expect(location.search).toBe("")
  expect(localStorage.length).toBe(0)
  fireEvent.click(screen.getByRole("button", { name: "Hide payload" }))
  expect(screen.queryByText(/9007199254740993123/)).toBeNull()
})
it("keeps reveal denials visible without discarding metadata", async () => {
  renderWithClient(
    <DurableExecutionPage {...detailProps} />,
    clientFor({
      ...queries,
      "durable.payload": () => {
        throw new ContractError("PERMISSION_DENIED", "No reveal grant")
      },
    })
  )
  fireEvent.click(await screen.findByRole("button", { name: "Reveal payload" }))
  await screen.findByText("No reveal grant")
  expect(screen.getByText("9007199254740995")).toBeTruthy()
})
it("clears cached protected metadata on identity replacement, invalidates and pauses hidden reads", async () => {
  const first = clientFor(queries)
  const denied = clientFor({
    "durable.execution": () => {
      throw new ContractError("PERMISSION_DENIED", "Changed identity")
    },
  })
  const view = renderWithClient(
    <DurableExecutionPage {...detailProps} />,
    first
  )
  await screen.findByText("9007199254740995")
  view.rerender(
    <PluginProvider client={denied}>
      <DurableExecutionPage {...detailProps} />
    </PluginProvider>
  )
  expect(screen.queryByText("9007199254740995")).toBeNull()
  await screen.findByText(/Changed identity/)
})
