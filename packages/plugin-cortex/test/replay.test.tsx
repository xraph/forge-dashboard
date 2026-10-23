import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import {
  ContractError,
  PluginProvider,
  NavigationProvider,
  type ScopedClient,
} from "@forge-go/dashboard-plugin"
import { DurableLiveRun } from "../src/replay"
import { LiveRun } from "../src/pages/chat"

const now = "2026-10-23T12:00:00Z"
const page = (gap = false, committed = false) => ({
  gap,
  next_cursor: `1.arun_one.${committed ? "9007199254740993" : "9007199254740992"}`,
  page: {
    watermark: { schema_version: 1, run_id: "arun_one" },
    events: committed
      ? [
          {
            schema_version: 1,
            id: "vcommit_one",
            type: "result_committed",
            run_id: "arun_one",
            observed_at: now,
          },
        ]
      : [],
  },
})
const run = (committed = false) => ({
  id: "arun_one",
  state: committed ? "completed" : "running",
  verification_status: committed ? "passed" : "pending",
  result_ref: committed ? "vresult_one" : undefined,
  metadata: { content_withheld: true },
})
const published = {
  schema_version: 1,
  run_id: "arun_one",
  result_id: "vresult_one",
  run_revision: "9007199254740993",
  content: "Current checked answer",
  publication_status: "approved",
  content_changed: false,
  verification_status: "passed",
  verified_at: now,
  checked_at: now,
}
function mount(
  node: React.ReactNode,
  query: ScopedClient["query"],
  command: ScopedClient["command"] = vi.fn()
) {
  const client: ScopedClient = { extension: "cortex", query, command }
  return render(
    <NavigationProvider
      value={{
        Link: ({ to, children }) => <a href={to}>{children}</a>,
        navigate: vi.fn(),
      }}
    >
      <PluginProvider client={client}>{node}</PluginProvider>
    </NavigationProvider>
  )
}
describe("protected live replay", () => {
  it("keeps the stop command available while verification is pending", async () => {
    const query = vi
      .fn()
      .mockImplementation((intent: string) =>
        Promise.resolve(intent === "runs.replay" ? page() : { run: run() })
      )
    const command = vi.fn().mockResolvedValue({})
    mount(<DurableLiveRun id="arun_one" onDone={vi.fn()} />, query, command)
    fireEvent.click(await screen.findByRole("button", { name: "Stop" }))
    await screen.findByRole("button", { name: "Stopping…" })
    expect(command.mock.calls[0]?.slice(0, 2)).toEqual([
      "runs.cancel",
      { id: "arun_one" },
    ])
  })
  it("does not finish a required run while the verification outcome is absent", async () => {
    const query = vi.fn().mockImplementation((intent: string) =>
      Promise.resolve(
        intent === "runs.replay"
          ? page()
          : {
              run: {
                ...run(),
                state: "completed",
                verification_status: undefined,
                provenance: { verification_required: true },
              },
            }
      )
    )
    const done = vi.fn()
    mount(<DurableLiveRun id="arun_one" onDone={done} />, query)
    await screen.findByText("No committed result yet")
    expect(done).not.toHaveBeenCalled()
  })
  it("refreshes the snapshot on a gap and resumes with the opaque cursor", async () => {
    let reads = 0
    const calls: string[] = []
    const query = vi
      .fn()
      .mockImplementation((intent: string, params: Record<string, unknown>) => {
        calls.push(intent)
        if (intent === "runs.replay") {
          reads++
          if (reads === 2)
            expect(params.after).toBe("1.arun_one.9007199254740992")
          return Promise.resolve(page(reads === 1, reads > 1))
        }
        if (intent === "runs.detail")
          return Promise.resolve({ run: run(reads > 1) })
        return Promise.resolve(published)
      })
    const done = vi.fn()
    mount(<DurableLiveRun id="arun_one" onDone={done} />, query)
    await screen.findByText(/Some earlier events expired/)
    await screen.findByText("Current checked answer", {}, { timeout: 3000 })
    expect(calls.slice(0, 4)).toEqual([
      "runs.replay",
      "runs.detail",
      "runs.replay",
      "runs.detail",
    ])
    expect(done).toHaveBeenCalledTimes(1)
  })
  it("switches a protected cache refusal to durable replay without retrying cached content", async () => {
    const query = vi.fn().mockImplementation((intent: string) => {
      if (intent === "runs.events")
        return Promise.reject(
          new ContractError("CONFLICT", "Use guarded reads", {
            code: "protected_replay_requires_guarded_reads",
          })
        )
      if (intent === "runs.replay") return Promise.resolve(page(false, true))
      if (intent === "runs.detail") return Promise.resolve({ run: run(true) })
      return Promise.resolve(published)
    })
    mount(<LiveRun id="arun_one" onDone={vi.fn()} />, query)
    await screen.findByText("Current checked answer", {}, { timeout: 3000 })
    expect(query.mock.calls.filter((c) => c[0] === "runs.events")).toHaveLength(
      1
    )
  })
  it("does not fetch result bytes when replay is denied", async () => {
    const query = vi
      .fn()
      .mockRejectedValue(
        new ContractError("PERMISSION_DENIED", "SECRET diagnostic")
      )
    mount(<DurableLiveRun id="arun_one" onDone={vi.fn()} />, query)
    await screen.findByRole("alert")
    expect(screen.queryByText(/SECRET/)).toBeNull()
    expect(query.mock.calls.some((c) => c[0] === "runs.result")).toBe(false)
  })
  it("rejects a replay page for another run before requesting its result", async () => {
    const value = page(false, true)
    value.page.watermark.run_id = "arun_other"
    const query = vi.fn().mockResolvedValue(value)
    const done = vi.fn()
    mount(<DurableLiveRun id="arun_one" onDone={done} />, query)
    await screen.findByRole("alert")
    await waitFor(() => expect(query).toHaveBeenCalledTimes(1))
    expect(done).not.toHaveBeenCalled()
  })
})
