import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import {
  PluginProvider,
  NavigationProvider,
  createScopedClient,
  type ContractEnvelopeRequest,
} from "@forge-go/dashboard-plugin"
import { CognitiveRunReview } from "../src/pages/cognitive"
import { LearningPage, newLessonID } from "../src/pages/learning"

function mount(
  node: React.ReactNode,
  answer: (request: ContractEnvelopeRequest) => unknown,
  manage = true
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
      const data =
        request.intent === "runtime.detail"
          ? { permissions: { read: true, manage } }
          : answer(request)
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
      <PluginProvider client={client}>{node}</PluginProvider>
    </NavigationProvider>
  )
  return requests
}

describe("governed adaptive review", () => {
  it("keeps unknown reliability separate from a contradicted assumption", async () => {
    mount(<CognitiveRunReview runId="arun_review" />, () => ({
      available: true,
      reliability: { status: "unknown" },
      items: [
        {
          version: 1,
          at: "2026-10-26T12:00:00Z",
          step: 2,
          decision: {
            action: "stop",
            reason: "contradicted_assumption",
            phase: 0,
          },
          state: { reflections: 1, pending: false },
          evidence_available: true,
          assumptions: [
            {
              key: "ready",
              summary: "Deployment is ready",
              origin: "host",
              state: "disputed",
            },
          ],
        },
      ],
    }))
    expect(await screen.findByText(/Reliability: unknown/)).toBeTruthy()
    expect(screen.getByText("disputed")).toBeTruthy()
    expect(screen.getByText(/Deployment is ready/)).toBeTruthy()
    expect(screen.getByText(/does not certify/)).toBeTruthy()
  })
  it("distinguishes an unavailable reviewer from empty history", async () => {
    mount(<CognitiveRunReview runId="arun_review" />, () => ({
      available: false,
      reason: "Current host review is unavailable",
    }))
    expect(await screen.findByText("Decision review unavailable")).toBeTruthy()
    expect(screen.queryByText("No reflection decisions")).toBeNull()
  })
  it("does not offer lesson writes to readers", async () => {
    mount(
      <LearningPage />,
      () => ({
        available: true,
        items: [
          {
            lesson_id: "lesson_read",
            revision: 2,
            domain: "operations",
            operation: "revoke",
            generation: 3,
            attempts: 2,
            acknowledged: false,
            error_code: "unavailable",
            lease_until: "0001-01-01T00:00:00Z",
          },
        ],
      }),
      false
    )
    expect(await screen.findByText(/operations · lesson_read/)).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Accept lesson" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Retry delivery" })).toBeNull()
  })
  it("retries exactly the displayed publication generation", async () => {
    const requests = mount(<LearningPage />, (request) =>
      request.intent === "learning.retry"
        ? { queued: true }
        : {
            available: true,
            items: [
              {
                lesson_id: "lesson_retry",
                revision: 2,
                domain: "operations",
                operation: "revoke",
                generation: 3,
                attempts: 5,
                acknowledged: false,
                error_code: "unavailable",
                lease_until: "0001-01-01T00:00:00Z",
              },
            ],
          }
    )
    fireEvent.click(
      await screen.findByRole("button", { name: "Retry delivery" })
    )
    await waitFor(() =>
      expect(
        requests.find((r) => r.intent === "learning.retry")?.payload
      ).toEqual({ id: "lesson_retry", revision: 2, generation: 3 })
    )
  })
  it("shows a withdrawn lesson without exposing a correction or revoke action", async () => {
    mount(<LearningPage />, (request) =>
      request.intent === "learning.detail"
        ? {
            ref: { id: "lesson_revoked", revision: 2, digest: "a" },
            domain: "operations",
            evidence_class: "validated",
            source_run_id: "arun_source",
            expires_at: "2026-11-01T00:00:00Z",
            revoked_at: "2026-10-26T12:00:00Z",
          }
        : {
            available: true,
            items: [
              {
                lesson_id: "lesson_revoked",
                revision: 2,
                domain: "operations",
                operation: "revoke",
                generation: 3,
                attempts: 1,
                acknowledged: true,
              },
            ],
          }
    )
    fireEvent.click(
      await screen.findByRole("button", { name: /operations · lesson_revoked/ })
    )
    expect(await screen.findByText(/revision 2 · revoked/)).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Revoke lesson" })).toBeNull()
    expect(
      screen.queryByRole("button", { name: "Correct from a verified result" })
    ).toBeNull()
    expect(
      screen
        .getByRole("link", { name: "Review source result" })
        .getAttribute("href")
    ).toBe("/runs/arun_source")
  })
  it("creates bounded distinct TypeID proposals", () => {
    const first = newLessonID(),
      second = newLessonID()
    expect(first).toMatch(/^lesson_[0-7][0-9a-hjkmnp-tv-z]{25}$/)
    expect(second).not.toBe(first)
  })
})
