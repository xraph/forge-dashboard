import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import {
  PluginProvider,
  NavigationProvider,
  createScopedClient,
  type ContractEnvelopeRequest,
} from "@forge-go/dashboard-plugin"
import { ImprovementsPage } from "../src/pages/improvements"

const experiment = {
  id: "oexp_review",
  revision: 7,
  state: "awaiting_review",
  phase: "decide",
  spec: {
    agent_id: "agt_review",
    mode: "sequential",
    budget: { token_only: true },
  },
}
const decision = {
  id: "odec_review",
  outcome: "recommend",
  evidence_class: "validated",
  selection_kind: "execution",
  candidate: { id: "hver_new", digest: "sha256:new" },
  reasons: ["held-out comparison"],
  comparison: {
    complete: true,
    missing_reasons: [],
    required_failures: [],
    mean_delta: 0.1,
    lower_bound: 0.02,
    upper_bound: 0.18,
  },
}
function mount(
  options: {
    deny?: boolean
    incomplete?: boolean
    stale?: boolean
    partialRoute?: boolean
    failCommand?: boolean
    retained?: boolean
    partialBaseline?: boolean
    nullBaseline?: boolean
  } = {}
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
          json: async () => ({ token: "csrf" }),
        } as Response
      const req = JSON.parse(String(init.body)) as ContractEnvelopeRequest
      requests.push(req)
      if (req.kind === "command" && options.failCommand)
        return {
          ok: true,
          status: 200,
          json: async () => ({
            envelope: "v1",
            ok: false,
            error: {
              code: "CONFLICT",
              message: "The reviewed generation changed",
            },
          }),
        } as Response
      let data: unknown
      switch (req.intent) {
        case "optimization.experiments.list":
          data = { items: [experiment], complete: true }
          break
        case "optimization.experiments.detail":
          data = experiment
          break
        case "optimization.capabilities":
          data = {
            permissions: options.deny
              ? {}
              : {
                  "optimization.activate": true,
                  "optimization.rollback": true,
                  "optimization.retain": true,
                  "optimization.create": true,
                },
            checks: { accounting: "unknown" },
            pricing_quality: "unknown",
            trials_ready: false,
          }
          break
        case "optimization.comparison":
          data = {
            revision: options.stale ? 8 : 7,
            decision: {
              ...decision,
              ...(options.retained
                ? {
                    outcome: "retain",
                    evidence_class: "exploratory",
                    reasons: null,
                  }
                : {}),
              comparison: {
                ...decision.comparison,
                complete: !options.incomplete && !options.retained,
                ...(options.retained
                  ? {
                      baseline_ids: Array.from(
                        { length: 20 },
                        (_, i) => `eval_${i}`
                      ),
                      required_failures: null,
                      missing_reasons: [
                        "The finalist is the unchanged baseline.",
                      ],
                    }
                  : {}),
              },
            },
            evaluations: {
              items: options.nullBaseline
                ? null
                : options.retained
                  ? [
                      {
                        id: "discovery",
                        complete: true,
                        criteria: [{ required: true, passed: true }],
                      },
                      ...Array.from(
                        { length: options.partialBaseline ? 19 : 20 },
                        (_, i) => ({
                          id: `eval_${i}`,
                          complete: true,
                          criteria: [{ required: true, passed: i < 16 }],
                          errors: null,
                        })
                      ),
                    ]
                  : [],
              complete: !options.partialBaseline,
            },
          }
          break
        case "optimization.candidates.list":
          data = {
            items: options.retained
              ? [{ id: "ocan_empty", accepted: false, proposal: { edits: [] } }]
              : [],
            complete: true,
          }
          break
        case "optimization.activations.list":
          data = {
            complete: !options.partialRoute,
            items: [
              {
                id: "oact_new",
                generation: 4,
                version: { id: "hver_current", digest: "current" },
              },
              {
                id: "oact_prior",
                generation: 3,
                version: { id: "hver_old", digest: "old" },
              },
            ],
          }
          break
        case "optimization.catalog":
          data = {
            complete: true,
            items: ["agent", "evaluation", "controller", "environment"].map(
              (kind) => ({
                kind,
                name: `Approved ${kind}`,
                ref: {
                  ref: `${kind}_source`,
                  revision: "r1",
                  digest: "digest",
                },
              })
            ),
          }
          break
        default:
          data = { id: "oexp_created" }
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ envelope: "v1", ok: true, data }),
      } as Response
    })
  )
  render(
    <NavigationProvider
      value={{
        Link: ({ to, children }) => <a href={to}>{children}</a>,
        navigate: vi.fn(),
      }}
    >
      <PluginProvider client={client}>
        <ImprovementsPage />
      </PluginProvider>
    </NavigationProvider>
  )
  return requests
}
async function review() {
  fireEvent.click(await screen.findByText("oexp_review"))
  await screen.findByText(/Recommendation:/)
}
describe("improvement review", () => {
  it("renders nullable retained evidence and the exact validation roster without inventing a measured delta", async () => {
    const requests = mount({ retained: true })
    await review()
    expect(
      await screen.findByText(
        "Baseline validation: 16 / 20 passed required checks."
      )
    ).toBeTruthy()
    expect(
      await screen.findByText(
        /Rejected candidate: ocan_empty.*0 edits.*No edits proposed/
      )
    ).toBeTruthy()
    expect(screen.getByText(/No complete paired comparison/)).toBeTruthy()
    expect(screen.queryByText(/Measured delta/)).toBeNull()
    fireEvent.change(await screen.findByLabelText("Review reason"), {
      target: { value: "Review retained baseline" },
    })
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Activate reviewed version",
      }).disabled
    ).toBe(true)
    expect(requests.some((r) => r.kind === "command")).toBe(false)
  })
  it.each([{ partialBaseline: true }, { nullBaseline: true }])(
    "does not summarize an unavailable baseline roster %j",
    async (options) => {
      mount({ retained: true, ...options })
      await review()
      expect(
        await screen.findByText(/Baseline validation summary unavailable/)
      ).toBeTruthy()
      expect(
        screen.queryByText(
          "Baseline validation: 16 / 20 passed required checks."
        )
      ).toBeNull()
    }
  )

  it("keeps unknown cost explicit and sends the reviewed generation with stable retries", async () => {
    const requests = mount({ failCommand: true })
    await review()
    expect(await screen.findByText(/Cost ratio: unknown/)).toBeTruthy()
    expect(await screen.findByText("No candidate proposals")).toBeTruthy()
    fireEvent.change(await screen.findByLabelText("Review reason"), {
      target: { value: "Validated record improvement" },
    })
    fireEvent.click(
      screen.getByRole("button", { name: "Activate reviewed version" })
    )
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Activate reviewed version",
      })
    )
    await screen.findByText("The reviewed generation changed")
    const commands = requests.filter((r) => r.kind === "command")
    expect(commands).toHaveLength(1)
    expect(commands[0].payload).toMatchObject({
      expected_generation: 4,
      version_id: "hver_new",
      version_digest: "sha256:new",
      decision_id: "odec_review",
      kind: "execution",
    })
    fireEvent.click(
      screen.getByRole("button", {
        name: "Activate reviewed version",
      })
    )
    await waitFor(() =>
      expect(requests.filter((r) => r.kind === "command")).toHaveLength(2)
    )
    expect(requests.filter((r) => r.kind === "command")[1].idempotencyKey).toBe(
      commands[0].idempotencyKey
    )
  })
  it("does not offer activation when current permission is denied", async () => {
    const requests = mount({ deny: true })
    await review()
    await screen.findByLabelText("Review reason")
    expect(
      screen.queryByRole("button", { name: "Activate reviewed version" })
    ).toBeNull()
    expect(requests.some((r) => r.kind === "command")).toBe(false)
  })
  it.each([{ incomplete: true }, { partialRoute: true }])(
    "disables activation with incomplete evidence or route history %j",
    async (options) => {
      mount(options)
      await review()
      fireEvent.change(await screen.findByLabelText("Review reason"), {
        target: { value: "Review" },
      })
      expect(
        screen.getByRole<HTMLButtonElement>("button", {
          name: "Activate reviewed version",
        }).disabled
      ).toBe(true)
    }
  )
  it("rejects an experiment revision changed during review", async () => {
    mount({ stale: true })
    await review()
    expect(
      await screen.findByText(/experiment changed during review/)
    ).toBeTruthy()
    expect(
      screen.queryByRole("button", { name: "Activate reviewed version" })
    ).toBeNull()
  })
  it("creates only from selected host catalog references and does not start evaluation", async () => {
    const requests = mount()
    fireEvent.click(screen.getByRole("button", { name: "Create experiment" }))
    await screen.findByLabelText("Agent")
    for (const kind of ["agent", "evaluation", "controller", "environment"])
      fireEvent.change(
        screen.getByLabelText(kind[0].toUpperCase() + kind.slice(1)),
        {
          target: {
            value: JSON.stringify({
              ref: `${kind}_source`,
              revision: "r1",
              digest: "digest",
            }),
          },
        }
      )
    fireEvent.click(screen.getByRole("button", { name: "Create experiment" }))
    await screen.findByText(/Created oexp_created/)
    const commands = requests.filter((r) => r.kind === "command")
    expect(commands).toHaveLength(1)
    expect(commands[0].intent).toBe("optimization.experiments.create")
    expect(commands[0].payload).toMatchObject({
      selection: {
        agent: { ref: "agent_source", revision: "r1", digest: "digest" },
      },
    })
  })
})
