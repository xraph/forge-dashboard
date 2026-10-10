import { StrictMode } from "react"
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { expect, it, vi } from "vitest"
import {
  ContractError,
  createScopedClient,
  PluginProvider,
  queryStore,
} from "@forge-go/dashboard-plugin"
import {
  DurableRunControls,
  DurableStartControls,
} from "../src/durable-commands"
import { inputBase64, outputText, validIdentifier } from "../src/durable-bytes"
import { clientFor, renderWithClient } from "./harness"

const target = { namespace: "production", workflow_id: "invoice", run_id: "r1" }
const result = {
  ...target,
  request_id: "req",
  revision: "9007199254740993",
  first_sequence: "9007199254740994",
  last_sequence: "9007199254740995",
  status: "accepted",
}
const capabilities = {
  runtime: "available",
  actions: Object.fromEntries(
    ["start", "signal_start", "signal", "cancel", "query"].map((name) => [
      `dispatch.workflow.${name}`,
      true,
    ])
  ),
}
const exact =
  '\uFEFF{ "large": 9007199254740993, "decimal": 1.2300, "unicode": "雪" }\r\n'
function setup(send = vi.fn(async (): Promise<unknown> => result)) {
  const client = clientFor({ "durable.capabilities": () => capabilities })
  client.command = send as typeof client.command
  return { client, send }
}
function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}
async function upload(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(`${label} exact-byte file`), {
    target: { files: [new File([value], "input.bin")] },
  })
  await waitFor(() =>
    expect(screen.queryByText("Reading input bytes…")).toBeNull()
  )
}
async function confirm(name: string) {
  const button = within(screen.getByRole("alertdialog")).getByRole("button", {
    name,
  })
  await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false))
  await act(async () => fireEvent.click(button))
}
async function signal() {
  fireEvent.click(await screen.findByRole("button", { name: "Send signal" }))
  fill("Signal name", "finish")
  await upload("Signal input text", exact)
  await confirm("Send signal")
}
it("retains original operation, exact bytes, target, build and both IDs through unknown response, close, refresh and denied retry", async () => {
  const send = vi
    .fn()
    .mockRejectedValueOnce(new TypeError("secret transport detail"))
    .mockRejectedValueOnce(
      new ContractError("PERMISSION_DENIED", "private policy detail")
    )
    .mockResolvedValue(result)
  const { client } = setup(send)
  const view = renderWithClient(
    <StrictMode>
      <DurableRunControls target={target} build="b1" />
    </StrictMode>,
    client
  )
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: "Send signal" })
        .hasAttribute("disabled")
    ).toBe(false)
  )
  await signal()
  await screen.findByText(
    "The earlier request may have committed. A later failed or denied attempt does not resolve it. Retry sends the original identity and bytes."
  )
  const first = send.mock.calls[0]
  expect(first[0]).toBe("durable.signal")
  expect(first[1]).toMatchObject({
    ...target,
    build_id: "b1",
    input: inputBase64(exact),
    name: "finish",
  })
  expect(first[1].request_id).toBeTruthy()
  expect(first[2].idempotencyKey).toBeTruthy()
  expect(screen.queryByText(/secret transport detail/)).toBeNull()
  fireEvent.click(screen.getByRole("button", { name: "Close" }))
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
  act(() =>
    queryStore.invalidate("dispatch", [
      "durable.capabilities",
      "durable.execution",
    ])
  )
  view.rerender(
    <PluginProvider client={client}>
      <StrictMode>
        <DurableRunControls target={target} build="new-build" />
      </StrictMode>
    </PluginProvider>
  )
  fireEvent.click(screen.getByRole("button", { name: "Review send signal" }))
  await confirm("Retry original request")
  await screen.findByText("Permission denied for this attempt.")
  expect(screen.getAllByText("Acceptance uncertain").length).toBeGreaterThan(0)
  expect(send.mock.calls[1]).toEqual(first)
  await confirm("Retry original request")
  await screen.findByText(/Revision/)
  expect(send.mock.calls[2]).toEqual(first)
  expect(screen.getByRole("alertdialog").textContent).toContain(
    "9007199254740995"
  )
  expect(screen.queryByText(/private policy detail/)).toBeNull()
})
it.each([
  ["malformed success envelope", {}],
  [
    "unrecognized failure code",
    { ok: false, error: { code: "FUTURE_FAILURE" } },
  ],
])(
  "keeps %s uncertain through a denied retry via the real scoped client",
  async (_label, firstResponse) => {
    const bodies: string[] = []
    const fetcher: typeof fetch = async (_url, options) => {
      if (options?.method !== "POST")
        return Response.json({ token: "fixture-csrf" })
      const body = String(options.body)
      const envelope = JSON.parse(body)
      if (envelope.kind === "query")
        return Response.json({ ok: true, data: capabilities })
      bodies.push(body)
      return bodies.length === 1
        ? Response.json(firstResponse)
        : Response.json(
            {
              ok: false,
              error: {
                code: "PERMISSION_DENIED",
                message: "private policy detail",
              },
            },
            { status: 403 }
          )
    }
    const client = createScopedClient("/contract", "dispatch", fetcher)
    renderWithClient(<DurableRunControls target={target} build="b1" />, client)
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "Send signal" })
          .hasAttribute("disabled")
      ).toBe(false)
    )
    await signal()
    await screen.findByText(/The earlier request may have committed/)
    expect(screen.getAllByText("Acceptance uncertain").length).toBeGreaterThan(
      0
    )
    expect(bodies).toHaveLength(1)
    const original = JSON.parse(bodies[0])
    expect(original).toMatchObject({
      kind: "command",
      intent: "durable.signal",
      contributor: "dispatch",
      payload: {
        ...target,
        build_id: "b1",
        name: "finish",
        input: inputBase64(exact),
      },
    })
    expect(original.payload.request_id).toBeTruthy()
    expect(original.idempotencyKey).toBeTruthy()
    await confirm("Retry original request")
    await screen.findByText("Permission denied for this attempt.")
    expect(screen.getAllByText("Acceptance uncertain").length).toBeGreaterThan(
      0
    )
    expect(
      screen.getByText(/The earlier request may have committed/)
    ).toBeTruthy()
    expect(bodies).toEqual([bodies[0], bodies[0]])
    expect(screen.queryByText(/private policy detail/)).toBeNull()
  }
)
it("keeps a definitive first permission refusal distinct from uncertainty", async () => {
  const fetcher: typeof fetch = async (_url, options) => {
    if (options?.method !== "POST")
      return Response.json({ token: "fixture-csrf" })
    return JSON.parse(String(options.body)).kind === "query"
      ? Response.json({ ok: true, data: capabilities })
      : Response.json(
          { ok: false, error: { code: "PERMISSION_DENIED" } },
          { status: 403 }
        )
  }
  renderWithClient(
    <DurableRunControls target={target} build="b1" />,
    createScopedClient("/contract", "dispatch", fetcher)
  )
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: "Send signal" })
        .hasAttribute("disabled")
    ).toBe(false)
  )
  await signal()
  await screen.findByText("Permission denied for this attempt.")
  expect(screen.queryByText("Acceptance uncertain")).toBeNull()
  expect(
    screen.queryByText(/The earlier request may have committed/)
  ).toBeNull()
  expect(screen.getAllByText("Request needs attention").length).toBeGreaterThan(
    0
  )
})
it.each(["Start workflow", "Signal with start"])(
  "preserves BOM identifiers and original start/signal bytes for %s",
  async (label) => {
    const { client, send } = setup()
    renderWithClient(
      <DurableStartControls namespace={"\uFEFFproduction"} />,
      client
    )
    fireEvent.click(screen.getByRole("button", { name: label }))
    for (const [name, value] of [
      ["Workflow ID", "\uFEFFworkflow"],
      ["Proposed run ID", "\uFEFFrun"],
      ["Workflow type", "\uFEFFtype"],
      ["Build ID", "\uFEFFbuild"],
      ["Queue", "queue"],
    ])
      fill(name, value)
    await upload("Start input text", exact)
    if (label === "Signal with start") {
      fill("Signal name", "finish")
      await upload("Signal input text", "\uFEFFsignal\r\n")
    }
    await confirm(label)
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    const payload = (send.mock.calls as unknown[][])[0][1] as Record<
      string,
      unknown
    >
    const start = (payload.start ?? payload) as Record<string, unknown>
    expect(start).toMatchObject({
      namespace: "\uFEFFproduction",
      workflow_id: "\uFEFFworkflow",
      run_id: "\uFEFFrun",
      workflow_type: "\uFEFFtype",
      build_id: "\uFEFFbuild",
      input: inputBase64(exact),
    })
    if (payload.start)
      expect(payload.input).toBe(inputBase64("\uFEFFsignal\r\n"))
  }
)
it("locks pending submits, clears sensitive state on same-client context change and fences an ignored late command reply", async () => {
  let finish!: (data: unknown) => void
  const send = vi.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const { client } = setup(send)
  renderWithClient(<DurableRunControls target={target} build="b1" />, client)
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: "Send signal" })
        .hasAttribute("disabled")
    ).toBe(false)
  )
  await signal()
  fireEvent.click(screen.getByRole("button", { name: "Working…" }))
  expect(send).toHaveBeenCalledTimes(1)
  act(() => queryStore.clear())
  expect(screen.queryByRole("alertdialog")).toBeNull()
  await act(async () => finish(result))
  expect(screen.queryByText("Open accepted run")).toBeNull()
  expect(screen.queryByText(/Review send signal/)).toBeNull()
})
it("fences a replaced client and drops retained retries on unmount", async () => {
  const first = setup(vi.fn().mockRejectedValue(new Error("lost"))),
    second = setup()
  const view = renderWithClient(
    <DurableRunControls target={target} build="b1" />,
    first.client
  )
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: "Send signal" })
        .hasAttribute("disabled")
    ).toBe(false)
  )
  await signal()
  await screen.findByText(/The earlier request may have committed/)
  view.rerender(
    <PluginProvider client={second.client}>
      <DurableRunControls target={target} build="b1" />
    </PluginProvider>
  )
  expect(screen.queryByRole("alertdialog")).toBeNull()
  expect(screen.queryByText(/Review send signal/)).toBeNull()
  expect(second.send).not.toHaveBeenCalled()
  view.unmount()
  renderWithClient(
    <DurableRunControls target={target} build="b1" />,
    first.client
  )
  expect(screen.queryByText(/Review send signal/)).toBeNull()
})
it("reports cancellation requested without claiming terminal cancellation", async () => {
  const { client } = setup(
    vi.fn().mockResolvedValue({ ...result, status: "cancellation_requested" })
  )
  renderWithClient(<DurableRunControls target={target} build="b1" />, client)
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: "Request cancellation" })
        .hasAttribute("disabled")
    ).toBe(false)
  )
  fireEvent.click(screen.getByRole("button", { name: "Request cancellation" }))
  fill("Cancellation reason", "Operator requested")
  await confirm("Request cancellation")
  await screen.findByText(/The workflow may still be running/)
  expect(screen.queryByText("Cancelled")).toBeNull()
})
it("distinguishes denied, unavailable and capability failure without exposing callback commands", async () => {
  const client = clientFor({
    "durable.capabilities": () => ({ runtime: "unavailable", actions: {} }),
  })
  const view = renderWithClient(
    <DurableRunControls target={target} build="b1" />,
    client
  )
  await screen.findByText("Exact build runtime unavailable.")
  expect(
    screen.getByRole("button", { name: "Send signal" }).hasAttribute("disabled")
  ).toBe(true)
  expect(screen.queryByText(/Complete activity/)).toBeNull()
  view.rerender(
    <PluginProvider
      client={clientFor({
        "durable.capabilities": () => ({ runtime: "available", actions: {} }),
      })}
    >
      <DurableRunControls target={target} build="b1" />
    </PluginProvider>
  )
  await screen.findByText("Permission denied for these commands.")
})
it("rejects malformed UTF-16 and over-limit bytes without normalizing valid Unicode", () => {
  expect(validIdentifier("\uFEFFid")).toBe(true)
  expect(validIdentifier(" id")).toBe(false)
  expect(validIdentifier("\ud800")).toBe(false)
  expect(() => inputBase64("\ud800")).toThrow()
  expect(() => inputBase64("雪".repeat(350000))).toThrow()
  expect(outputText(inputBase64(exact))).toBe(exact)
})
it("keeps the proposed signal-start snapshot when recovery accepts a different existing run", async () => {
  const send = vi
    .fn()
    .mockRejectedValueOnce(new Error("lost"))
    .mockResolvedValue({ ...result, run_id: "existing-run", started: false })
  const { client } = setup(send)
  renderWithClient(<DurableStartControls namespace="production" />, client)
  fireEvent.click(screen.getByRole("button", { name: "Signal with start" }))
  for (const [label, value] of [
    ["Workflow ID", "invoice"],
    ["Proposed run ID", "proposal"],
    ["Workflow type", "operator"],
    ["Build ID", "b1"],
    ["Queue", "q"],
    ["Signal name", "finish"],
  ])
    fill(label, value)
  await upload("Start input text", exact)
  await upload("Signal input text", "signal\r\n")
  await confirm("Signal with start")
  await screen.findByText(/The earlier request may have committed/)
  act(() => queryStore.invalidate("dispatch", ["durable.capabilities"]))
  await confirm("Retry original request")
  await screen.findByText(/Revision/)
  expect(send.mock.calls[1]).toEqual(send.mock.calls[0])
  expect(send.mock.calls[1][1].start.run_id).toBe("proposal")
  fireEvent.click(screen.getByRole("button", { name: "Close" }))
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
  expect(
    screen.getByRole("link", { name: "Open accepted run" }).getAttribute("href")
  ).toContain("v1.ZXhpc3RpbmctcnVu")
})
it("fails closed on malformed capability data without breaking the detail page", async () => {
  const { client, send } = setup()
  client.query = clientFor({ "durable.capabilities": () => ({}) }).query
  renderWithClient(<DurableRunControls target={target} build="b1" />, client)
  await screen.findByText("The server returned invalid action availability.")
  expect(
    screen.getByRole("button", { name: "Send signal" }).hasAttribute("disabled")
  ).toBe(true)
  expect(send).not.toHaveBeenCalled()
})
it("does not block start on an inactive signal input error when switching drafts", async () => {
  const { client, send } = setup()
  renderWithClient(<DurableStartControls namespace="production" />, client)
  fireEvent.click(screen.getByRole("button", { name: "Signal with start" }))
  for (const [label, value] of [
    ["Workflow ID", "invoice"],
    ["Proposed run ID", "proposal"],
    ["Workflow type", "operator"],
    ["Build ID", "b1"],
    ["Queue", "q"],
  ])
    fill(label, value)
  fireEvent.change(screen.getByLabelText("Signal input text exact-byte file"), {
    target: { files: [new File([new Uint8Array((1 << 20) + 1)], "large.bin")] },
  })
  await screen.findByText("Input file exceeds 1 MiB.")
  fireEvent.click(screen.getByRole("button", { name: "Close" }))
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
  fireEvent.click(screen.getByRole("button", { name: "Start workflow" }))
  await confirm("Start workflow")
  expect(send).toHaveBeenCalledTimes(1)
})
