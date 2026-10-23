import { afterEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import {
  PluginProvider,
  ContractError,
  queryStore,
  type ScopedClient,
} from "@forge-go/dashboard-plugin"
import { ProtectedResult } from "../src/result"

const result = (content = "Checked answer") => ({
  schema_version: 1,
  run_id: "arun_one",
  result_id: "vresult_one",
  run_revision: "9007199254740993",
  content,
  publication_status: "redacted",
  content_changed: true,
  verification_status: "passed",
  verified_at: "2026-10-23T12:00:00Z",
  checked_at: "2026-10-23T12:01:00Z",
})
function clientFor(query: ScopedClient["query"]): ScopedClient {
  return { extension: "cortex", query, command: vi.fn() }
}

describe("protected result", () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })
  it("removes displayed bytes on hide and requires another read on return", async () => {
    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("visible")
    const query = vi
      .fn()
      .mockResolvedValueOnce(result())
      .mockRejectedValue(
        new ContractError("PERMISSION_DENIED", "", { code: "result_denied" })
      )
    render(
      <PluginProvider client={clientFor(query)}>
        <ProtectedResult runId="arun_one" resultId="vresult_one" />
      </PluginProvider>
    )
    await screen.findByText("Checked answer")
    visibility.mockReturnValue("hidden")
    fireEvent(document, new Event("visibilitychange"))
    expect(screen.queryByText("Checked answer")).toBeNull()
    visibility.mockReturnValue("visible")
    fireEvent(document, new Event("visibilitychange"))
    await screen.findByText("You no longer have access to this result.")
    expect(query).toHaveBeenCalledTimes(2)
  })
  it("bounds display retention and clears bytes before the next check", async () => {
    vi.useFakeTimers()
    const query = vi
      .fn()
      .mockResolvedValueOnce(result())
      .mockImplementation(() => new Promise(() => {}))
    render(
      <PluginProvider client={clientFor(query)}>
        <ProtectedResult runId="arun_one" resultId="vresult_one" />
      </PluginProvider>
    )
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByText("Checked answer")).toBeTruthy()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
    })
    expect(screen.queryByText("Checked answer")).toBeNull()
    expect(query).toHaveBeenCalledTimes(2)
  })
  it("aborts a timed out read and discards its late response", async () => {
    vi.useFakeTimers()
    let resolve!: (value: unknown) => void
    const query = vi.fn().mockImplementation(
      () =>
        new Promise((yes) => {
          resolve = yes
        })
    )
    render(
      <PluginProvider client={clientFor(query)}>
        <ProtectedResult runId="arun_one" resultId="vresult_one" />
      </PluginProvider>
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(query.mock.calls[0]?.[2].signal.aborted).toBe(true)
    expect(
      screen.getByText("The result check timed out. Try again.")
    ).toBeTruthy()
    await act(async () => {
      resolve(result())
      await Promise.resolve()
    })
    expect(screen.queryByText("Checked answer")).toBeNull()
  })
  it("reads through the guarded intent and renders HTML as text", async () => {
    const query = vi
      .fn()
      .mockResolvedValue(result("<img src=x onerror=alert(1)>"))
    const { container } = render(
      <PluginProvider client={clientFor(query)}>
        <ProtectedResult runId="arun_one" resultId="vresult_one" />
      </PluginProvider>
    )
    await screen.findByText("<img src=x onerror=alert(1)>")
    expect(query.mock.calls[0]?.slice(0, 2)).toEqual([
      "runs.result",
      { id: "arun_one", result_id: "vresult_one" },
    ])
    expect(container.querySelector("img")).toBeNull()
    expect(screen.getByText(/original candidate was verified/i)).toBeTruthy()
    expect(screen.getByText(/9007199254740993/)).toBeTruthy()
  })
  it("clears previous bytes before retry and never falls back after denial", async () => {
    let reject!: (e: unknown) => void
    const query = vi
      .fn()
      .mockResolvedValueOnce(result())
      .mockImplementationOnce(
        () =>
          new Promise((_, no) => {
            reject = no
          })
      )
    render(
      <PluginProvider client={clientFor(query)}>
        <ProtectedResult runId="arun_one" resultId="vresult_one" />
      </PluginProvider>
    )
    await screen.findByText("Checked answer")
    fireEvent.click(screen.getByRole("button", { name: "Check again" }))
    expect(screen.queryByText("Checked answer")).toBeNull()
    await waitFor(() => expect(query).toHaveBeenCalledTimes(2))
    reject(
      new ContractError("PERMISSION_DENIED", "SECRET diagnostics", {
        code: "result_denied",
      })
    )
    await screen.findByText("You no longer have access to this result.")
    expect(screen.queryByText(/SECRET/)).toBeNull()
    expect(screen.queryByText("Checked answer")).toBeNull()
  })
  it("discards a late reply after an authority context reset", async () => {
    let resolve!: (value: unknown) => void
    const query = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((yes) => {
            resolve = yes
          })
      )
      .mockRejectedValue(
        new ContractError("PERMISSION_DENIED", "denied", {
          code: "result_denied",
        })
      )
    render(
      <PluginProvider client={clientFor(query)}>
        <ProtectedResult runId="arun_one" resultId="vresult_one" />
      </PluginProvider>
    )
    await waitFor(() => expect(query).toHaveBeenCalledTimes(1))
    queryStore.clear()
    await screen.findByText("You no longer have access to this result.")
    resolve(result("LATE private answer"))
    await waitFor(() => expect(query).toHaveBeenCalledTimes(2))
    expect(screen.queryByText("LATE private answer")).toBeNull()
  })
  it.each(["run", "result", "revision", "status", "changed", "schema"])(
    "refuses a malformed %s response",
    async (mode) => {
      const value = result()
      if (mode === "run") value.run_id = "arun_other"
      if (mode === "result") value.result_id = "vresult_other"
      if (mode === "revision") value.run_revision = "1e5"
      if (mode === "status") value.verification_status = "inconclusive"
      if (mode === "changed") value.publication_status = "approved"
      if (mode === "schema") value.schema_version = 2
      render(
        <PluginProvider client={clientFor(vi.fn().mockResolvedValue(value))}>
          <ProtectedResult runId="arun_one" resultId="vresult_one" />
        </PluginProvider>
      )
      await screen.findByText("The server returned an invalid result response.")
      expect(screen.queryByText("Checked answer")).toBeNull()
    }
  )
  it("distinguishes an absent result from a redacted empty answer", async () => {
    const query = vi.fn().mockResolvedValue(result(""))
    const client = clientFor(query)
    const view = render(
      <PluginProvider client={client}>
        <ProtectedResult runId="arun_one" />
      </PluginProvider>
    )
    expect(screen.getByText("No committed result yet")).toBeTruthy()
    expect(query).not.toHaveBeenCalled()
    view.rerender(
      <PluginProvider client={client}>
        <ProtectedResult runId="arun_one" resultId="vresult_one" />
      </PluginProvider>
    )
    await screen.findByText("Publication policy removed all result text.")
  })
})
