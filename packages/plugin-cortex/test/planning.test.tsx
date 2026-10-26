import { describe, expect, it, vi } from "vitest"
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import {
  PluginProvider,
  NavigationProvider,
  createScopedClient,
  type ContractEnvelopeRequest,
} from "@forge-go/dashboard-plugin"
import { PlanningPage, PlanningDetailPage } from "../src/pages/planning"

const caps = {
  claim: true,
  retry: true,
  reassign: true,
  replan: true,
  reconcile: true,
  cancel: true,
  resolve_conflict: false,
}
const task = (id: string, extra = {}) => ({
  id,
  owner: "producer",
  instruction: `Produce ${id}`,
  status: "pending",
  next_action: "wait",
  ready: false,
  currently_accepted: false,
  review_required: true,
  budget: { max_steps: 3, max_tokens: 100, deadline: "2026-10-27T12:00:00Z" },
  ...extra,
})
const detail = {
  plan: {
    id: "plan_one",
    revision: 4,
    digest: "a".repeat(64),
    objective: "Checked warehouse record",
    tasks: 2,
    deadline: "2026-10-27T12:00:00Z",
  },
  tasks: [
    task("first", { ready: true, status: "ready" }),
    task("second", {
      depends_on: ["first"],
      acceptance_id: "old",
      status: "blocked",
    }),
  ],
  replans: [],
  complete: false,
  observed_at: "2026-10-26T12:00:00Z",
  capabilities: caps,
  budget: {
    charged: { tokens: 21, steps: 1, fan_out: 1 },
    reservations: 1,
    overflow: false,
  },
}
function mount(
  node: React.ReactNode,
  answer: (request: ContractEnvelopeRequest) => unknown,
  manage = true,
  failCommand = false
) {
  const requests: ContractEnvelopeRequest[] = []
  const client = createScopedClient(
    "/dashboard/api/dashboard/v1",
    "cortex",
    vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.body)
        return {
          ok: true,
          status: 200,
          json: async () => ({ token: "test" }),
        } as Response
      const request = JSON.parse(String(init.body)) as ContractEnvelopeRequest
      requests.push(request)
      const envelope =
        failCommand && request.intent === "planning.command"
          ? {
              envelope: "v1",
              ok: false,
              error: { code: "CONFLICT", message: "Plan changed" },
            }
          : {
              envelope: "v1",
              ok: true,
              data:
                request.intent === "runtime.detail"
                  ? { permissions: { read: true, manage } }
                  : answer(request),
            }
      return { ok: true, status: 200, json: async () => envelope } as Response
    })
  )
  render(
    <NavigationProvider
      value={{
        Link: ({ to, children }) => <a href={to}>{children}</a>,
        navigate: vi.fn(),
      }}
    >
      <PluginProvider client={client}>{node}</PluginProvider>
    </NavigationProvider>
  )
  return requests
}
describe("team planning", () => {
  it("distinguishes unavailable planning from an empty roster", async () => {
    mount(<PlanningPage />, () => ({
      available: false,
      reason: "No current team authority installed",
      items: [],
      capabilities: caps,
    }))
    expect(await screen.findByText("Team planning unavailable")).toBeTruthy()
    expect(screen.queryByText("No team plans")).toBeNull()
  })
  it("shows historical acceptance without claiming current success and exposes dependency navigation", async () => {
    mount(
      <PlanningDetailPage params={{ id: "plan_one" }} />,
      () => detail,
      false
    )
    expect(
      await screen.findByText("Historical acceptance; current checks failed")
    ).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Claim and run" })).toBeNull()
    const graph = screen.getByRole("region", { name: "Dependency graph" })
    fireEvent.click(
      within(graph).getByRole("button", { name: "Produce second" })
    )
    expect(
      within(graph)
        .getByRole("button", { name: "Produce second" })
        .getAttribute("aria-pressed")
    ).toBe("true")
    expect(
      within(graph)
        .getByRole("button", { name: "Produce first" })
        .getAttribute("aria-pressed")
    ).toBe("false")
  })
  it("keeps the same durable operation after a failed reply and pins the displayed revision", async () => {
    const requests = mount(
      <PlanningDetailPage params={{ id: "plan_one" }} />,
      () => detail,
      true,
      true
    )
    fireEvent.change(await screen.findByLabelText("Reason"), {
      target: { value: "Run the currently ready task" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Claim and run" }))
    fireEvent.click(
      await screen.findByRole("button", { name: "Confirm operation" })
    )
    await waitFor(() =>
      expect(
        requests.filter((r) => r.intent === "planning.command")
      ).toHaveLength(1)
    )
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "Confirm operation",
          }) as HTMLButtonElement
        ).disabled
      ).toBe(false)
    )
    fireEvent.click(screen.getByRole("button", { name: "Confirm operation" }))
    await waitFor(() =>
      expect(
        requests.filter((r) => r.intent === "planning.command")
      ).toHaveLength(2)
    )
    const commands = requests.filter((r) => r.intent === "planning.command")
    expect(commands[0]!.payload).toEqual(commands[1]!.payload)
    expect(commands[0]!.payload).toMatchObject({
      operation: "claim",
      plan_id: "plan_one",
      expected_revision: 4,
      expected_digest: "a".repeat(64),
      task_id: "first",
      reason: "Run the currently ready task",
    })
    expect(
      (commands[0]!.payload as { operation_id: string }).operation_id
    ).toMatch(/^tclaim_[0-9a-hjkmnp-tv-z]{26}$/)
  })
  it("hides retry and reassignment when only initial claims are installed", async () => {
    mount(<PlanningDetailPage params={{ id: "plan_one" }} />, () => ({
      ...detail,
      capabilities: { ...caps, retry: false, reassign: false },
    }))
    expect(
      await screen.findByRole("button", { name: "Claim and run" })
    ).toBeTruthy()
    expect(
      screen.queryByRole("button", { name: "Retry with current checks" })
    ).toBeNull()
    expect(screen.queryByLabelText("Replacement worker")).toBeNull()
  })
  it("pins the selected artifact conflict and current resource head", async () => {
    const requests = mount(
      <PlanningDetailPage params={{ id: "plan_one" }} />,
      () => ({
        ...detail,
        capabilities: { ...caps, resolve_conflict: true },
        artifacts: [
          {
            resource: {
              resource: "warehouse",
              revision: "source-1",
              access: "write",
            },
            head_revision: 3,
            head_digest: "b".repeat(64),
            conflicts: [
              {
                id: "btrans_conflict",
                task_id: "first",
                owner: { agent: "worker-two", principal: "second" },
                artifact: { id: "artifact_two", sha256: "c".repeat(64) },
                at: "2026-10-26T12:00:00Z",
              },
            ],
          },
        ],
      })
    )
    fireEvent.change(await screen.findByLabelText("Reason"), {
      target: { value: "Select independently checked ownership" },
    })
    fireEvent.click(
      screen.getByRole("button", { name: "Resolve selected conflict" })
    )
    fireEvent.click(
      await screen.findByRole("button", { name: "Confirm operation" })
    )
    await waitFor(() =>
      expect(
        requests.filter((r) => r.intent === "planning.command")
      ).toHaveLength(1)
    )
    expect(
      requests.find((r) => r.intent === "planning.command")!.payload
    ).toMatchObject({
      operation: "resolve_conflict",
      conflict_id: "btrans_conflict",
      expected_resource_revision: 3,
      expected_resource_digest: "b".repeat(64),
      expected_revision: 4,
    })
  })
})
