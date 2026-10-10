import { useState } from "react"
import { act, fireEvent, screen, waitFor } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { DurableInput, encodedInput } from "../src/durable-input"
import type { DurableInputValue } from "../src/durable-input"
import { DurableQueryPanel } from "../src/durable-query"
import { queryStore } from "@forge-go/dashboard-plugin"
import { clientFor, renderWithClient } from "./harness"

afterEach(() => {
  vi.unstubAllGlobals()
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  })
})
function Field() {
  const [value, setValue] = useState<DurableInputValue>({ text: "" })
  return (
    <>
      <DurableInput label="Input" value={value} onChange={setValue} />
      <output>
        {value.base64 !== undefined
          ? `file:${value.base64}`
          : `text:${value.text}`}
      </output>
    </>
  )
}
it("distinguishes an empty file and replaces its source when text is edited", async () => {
  renderWithClient(<Field />, clientFor({}))
  fireEvent.change(screen.getByLabelText("Input exact-byte file"), {
    target: { files: [new File([], "empty.bin")] },
  })
  await screen.findByText("file:")
  fireEvent.change(screen.getByLabelText("Input"), {
    target: { value: "text" },
  })
  expect(screen.getByText("text:text")).toBeTruthy()
  expect(screen.queryByText(/Exact file bytes loaded/)).toBeNull()
  expect(encodedInput({ text: "ignored", base64: "" })).toBe("")
})
it("rejects file size before reading", async () => {
  const read = vi.spyOn(FileReader.prototype, "readAsArrayBuffer")
  renderWithClient(<Field />, clientFor({}))
  fireEvent.change(screen.getByLabelText("Input exact-byte file"), {
    target: { files: [new File([new Uint8Array((1 << 20) + 1)], "large.bin")] },
  })
  await screen.findByText("Input file exceeds 1 MiB.")
  expect(read).not.toHaveBeenCalled()
  read.mockRestore()
})
it.each(["context", "hide", "clear", "unmount"])(
  "fences an abort-ignoring private file read after %s",
  async (boundary) => {
    class Reader {
      static LOADING = 1
      readyState = 1
      result = new TextEncoder().encode("private-file").buffer
      onload?: () => void
      onerror?: () => void
      abort = vi.fn()
      readAsArrayBuffer = vi.fn()
      constructor() {
        readers.push(this)
      }
    }
    const readers: Reader[] = []
    vi.stubGlobal("FileReader", Reader)
    const view = renderWithClient(
      <DurableQueryPanel
        target={{ namespace: "n", workflow_id: "w", run_id: "r" }}
        build="b"
        allowed
      />,
      clientFor({})
    )
    fireEvent.change(
      screen.getByLabelText("Query input text exact-byte file"),
      { target: { files: [new File(["bytes"], "private-name.bin")] } }
    )
    await waitFor(() => expect(readers).toHaveLength(1))
    if (boundary === "context") act(() => queryStore.clear())
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
    expect(readers[0].abort).toHaveBeenCalled()
    act(() => readers[0].onload?.())
    expect(screen.queryByText(/Exact file bytes loaded/)).toBeNull()
    expect(screen.queryByText(/private-file|private-name/)).toBeNull()
  }
)
it("aborts an input file at dialog close before an ignored late read can repopulate the draft", async () => {
  class Reader {
    static LOADING = 1
    readyState = 1
    result = new TextEncoder().encode("private-file").buffer
    onload?: () => void
    onerror?: () => void
    abort = vi.fn()
    readAsArrayBuffer = vi.fn()
    constructor() {
      readers.push(this)
    }
  }
  const readers: Reader[] = []
  vi.stubGlobal("FileReader", Reader)
  const { DurableStartControls } = await import("../src/durable-commands")
  renderWithClient(
    <DurableStartControls namespace="production" />,
    clientFor({})
  )
  fireEvent.click(screen.getByRole("button", { name: "Start workflow" }))
  fireEvent.change(screen.getByLabelText("Start input text exact-byte file"), {
    target: { files: [new File(["bytes"], "private-name.bin")] },
  })
  fireEvent.click(screen.getByRole("button", { name: "Close" }))
  expect(readers[0].abort).toHaveBeenCalled()
  act(() => readers[0].onload?.())
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
  fireEvent.click(screen.getByRole("button", { name: "Start workflow" }))
  expect(
    screen.queryByText(/Exact file bytes loaded|Reading input bytes/)
  ).toBeNull()
})
