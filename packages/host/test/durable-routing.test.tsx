import { cleanup, render, waitFor } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { MemoryRouter, Route, Routes, useParams } from "react-router"
import { PluginProvider, queryStore } from "@forge-go/dashboard-plugin"
import { DurableExecutionPage } from "../../plugin-dispatch/src/pages/durable-execution"
import {
  runPath,
  encodeRunPart,
  decodeRunPart,
} from "../../plugin-dispatch/src/durable-types"
import wire from "../../plugin-dispatch/test/durable-wire.json"

afterEach(() => {
  cleanup()
  queryStore.clear()
})
function RoutedDetail() {
  return <DurableExecutionPage params={useParams()} />
}
for (const part of ["namespace", "workflow_id", "run_id"] as const) {
  it.each(["%2F", "/", "%", "雪☃"])(
    `round-trips ${part} %s through the installed router, page and client`,
    async (value) => {
      const target = {
        namespace: "production",
        workflow_id: "invoice",
        run_id: "run-2",
        [part]: value,
      }
      const query = vi.fn(
        async (intent: string, params?: Record<string, unknown>) => {
          void params
          return intent === "durable.execution"
            ? wire.detail.data
            : wire.history.data
        }
      )
      render(
        <MemoryRouter initialEntries={["/@dispatch" + runPath(target)]}>
          <PluginProvider
            client={{
              extension: "dispatch",
              query: query as never,
              command: vi.fn(),
            }}
          >
            <Routes>
              <Route
                path="/@dispatch/durable/:namespace/:workflow/:run"
                element={<RoutedDetail />}
              />
            </Routes>
          </PluginProvider>
        </MemoryRouter>
      )
      await waitFor(() =>
        expect(
          query.mock.calls.some((call) => call[0] === "durable.execution")
        ).toBe(true)
      )
      expect(
        query.mock.calls.find((call) => call[0] === "durable.execution")?.[1]
      ).toEqual(target)
    }
  )
}

it.each([
  "production/invoice/run-2",
  "v1.Lx/v1.aW52b2ljZQ/v1.cnVuLTI",
  "v1._w/v1.aW52b2ljZQ/v1.cnVuLTI",
  "v2.Lw/v1.aW52b2ljZQ/v1.cnVuLTI",
])(
  "rejects legacy or malformed identity %s without issuing a query",
  async (path) => {
    const query = vi.fn()
    const view = render(
      <MemoryRouter initialEntries={["/@dispatch/durable/" + path]}>
        <PluginProvider
          client={{ extension: "dispatch", query, command: vi.fn() }}
        >
          <Routes>
            <Route
              path="/@dispatch/durable/:namespace/:workflow/:run"
              element={<RoutedDetail />}
            />
          </Routes>
        </PluginProvider>
      </MemoryRouter>
    )
    expect(view.getByText("Execution link needs regeneration")).toBeTruthy()
    expect(
      view
        .getByRole("link", { name: "Return to executions" })
        .getAttribute("href")
    ).toBe("/durable")
    expect(query).not.toHaveBeenCalled()
  }
)

it("refuses empty and malformed UTF-16 identities without normalization", () => {
  expect(() => encodeRunPart("")).toThrow()
  expect(() => encodeRunPart("\uD800")).toThrow()
  expect(() => decodeRunPart("v1.Lx")).toThrow()
})
