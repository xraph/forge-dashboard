import { act, fireEvent, screen, waitFor } from "@testing-library/react"
import { expect, it, vi } from "vitest"
import { PluginProvider, queryStore } from "@forge-go/dashboard-plugin"
import { DurableQueryPanel } from "../src/durable-query"
import { inputBase64, outputText } from "../src/durable-bytes"
import { clientFor, renderWithClient } from "./harness"

const target = { namespace: "production", workflow_id: "invoice", run_id: "r1" }
const exact = '\uFEFF{ "n": 9007199254740993, "d": 1.2300 }\r\n'
const result = {
  ...target,
  revision: "9007199254740993",
  last_sequence: "9007199254740995",
  state: "running",
  encoding: "base64",
  output: inputBase64(exact),
}
function setup() {
  let finish!: (value: unknown) => void
  let reject!: (value: unknown) => void
  const calls = vi.fn(
    (_intent: string, _params: unknown, _options: unknown) => {
      void _intent
      void _params
      void _options
      return new Promise((resolve, fail) => {
        finish = resolve
        reject = fail
      })
    }
  )
  const client = clientFor({})
  client.query = calls as typeof client.query
  return {
    client,
    calls,
    finish: (value: unknown = result) => finish(value),
    reject: () => reject(new Error("private query output")),
  }
}
async function run() {
  fireEvent.change(screen.getByLabelText("Query name"), {
    target: { value: "status" },
  })
  fireEvent.change(screen.getByLabelText("Query input text exact-byte file"), {
    target: { files: [new File([exact], "input.bin")] },
  })
  await waitFor(() =>
    expect(screen.queryByText("Reading input bytes…")).toBeNull()
  )
  fireEvent.click(screen.getByRole("button", { name: "Run query" }))
}
it("queries only explicitly with exact bytes, never stores private output, and preserves string counters and BOM", async () => {
  const s = setup()
  renderWithClient(
    <DurableQueryPanel target={target} build="b1" allowed />,
    s.client
  )
  expect(s.calls).not.toHaveBeenCalled()
  await run()
  expect(s.calls.mock.calls[0][1]).toEqual({
    ...target,
    build_id: "b1",
    name: "status",
    input: inputBase64(exact),
  })
  await act(async () => s.finish())
  expect(screen.getByText("9007199254740993")).toBeTruthy()
  expect(screen.getByText("9007199254740995")).toBeTruthy()
  expect(outputText(result.output)).toBe(exact)
  await screen.findByText("Query output")
  expect(JSON.stringify(localStorage)).not.toContain("9007199254740993")
  expect(JSON.stringify(sessionStorage)).not.toContain("9007199254740993")
  expect(location.href).not.toContain("9007199254740993")
  act(() => queryStore.invalidate("dispatch", ["durable.query"]))
  expect(s.calls).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole("button", { name: "Clear query" }))
  expect(screen.queryByText("9007199254740993")).toBeNull()
})
it.each(["context", "client", "target", "build", "hide", "clear", "unmount"])(
  "aborts and fences ignored late output on %s",
  async (boundary) => {
    const s = setup()
    const view = renderWithClient(
      <DurableQueryPanel target={target} build="b1" allowed />,
      s.client
    )
    await run()
    const signal = (s.calls.mock.calls[0][2] as { signal: AbortSignal }).signal
    if (boundary === "context") act(() => queryStore.clear())
    if (boundary === "client")
      view.rerender(
        <PluginProvider client={clientFor({})}>
          <DurableQueryPanel target={target} build="b1" allowed />
        </PluginProvider>
      )
    if (boundary === "target" || boundary === "build")
      view.rerender(
        <PluginProvider client={s.client}>
          <DurableQueryPanel
            target={
              boundary === "target" ? { ...target, run_id: "r2" } : target
            }
            build={boundary === "build" ? "b2" : "b1"}
            allowed
          />
        </PluginProvider>
      )
    if (boundary === "hide") {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "hidden",
      })
      fireEvent(document, new Event("visibilitychange"))
    }
    if (boundary === "clear")
      fireEvent.click(screen.getByRole("button", { name: "Clear query" }))
    if (boundary === "unmount") view.unmount()
    expect(signal.aborted).toBe(true)
    await act(async () => s.finish())
    expect(screen.queryByText("9007199254740993")).toBeNull()
    if (boundary === "hide") {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "visible",
      })
      fireEvent(document, new Event("visibilitychange"))
      expect(s.calls).toHaveBeenCalledTimes(1)
    }
  }
)
it("discards a hidden late private error and never rediscloses automatically", async () => {
  const s = setup()
  renderWithClient(
    <DurableQueryPanel target={target} build="b1" allowed />,
    s.client
  )
  await run()
  fireEvent.click(screen.getByRole("button", { name: "Clear query" }))
  await act(async () => s.reject())
  expect(screen.queryByText(/private query output/)).toBeNull()
  expect(screen.queryByRole("alert")).toBeNull()
})
it.each([
  [null, "Empty query output"],
  ["", "Empty query output"],
  ["/w==", "Binary query output"],
  ["!!", "Invalid query output encoding"],
])("distinguishes output encoding %s", async (output, heading) => {
  const s = setup()
  renderWithClient(
    <DurableQueryPanel target={target} build="b1" allowed />,
    s.client
  )
  await run()
  await act(async () => s.finish({ ...result, output }))
  await waitFor(() => expect(screen.getByText(heading as string)).toBeTruthy())
})
