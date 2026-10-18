import { describe, expect, it } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import { OutcomeSummary, liveOutcome } from "../src/outcome"

describe("execution outcome", () => {
  it("does not infer completion from a closed or expired feed", () => {
    expect(liveOutcome([], true).state).toBe("unknown")
    expect(liveOutcome([], false).state).toBe("running")
  })
  it("recognizes incomplete and blocked terminal events", () => {
    const value = liveOutcome(
      [
        {
          event: "incomplete",
          data: {
            state: "incomplete",
            stop_reason: "policy_unavailable",
            verification_status: "unchecked",
          },
        },
      ],
      true
    )
    expect(value.state).toBe("incomplete")
    render(<OutcomeSummary outcome={value} />)
    expect(screen.getByText("Stopped: policy unavailable")).toBeTruthy()
    expect(screen.getByText("Verification: unchecked")).toBeTruthy()
  })
  it("keeps legacy completion unchecked", () => {
    render(
      <OutcomeSummary
        outcome={liveOutcome([{ event: "done", data: {} }], true)}
      />
    )
    expect(screen.getByText("Verification: unchecked")).toBeTruthy()
    expect(screen.getByText("Screening: unknown")).toBeTruthy()
  })
  it("does not present contradictory or unreferenced verification as passed", () => {
    for (const outcome of [
      {
        state: "incomplete",
        verification_status: "passed",
        result_ref: "result-1",
      },
      { state: "completed", verification_status: "passed" },
      { state: "completed", verification_status: "future-status" },
    ]) {
      render(<OutcomeSummary outcome={outcome} />)
      expect(screen.queryByText("Verification: passed")).toBeNull()
      cleanup()
    }
  })
  it("uses the saved terminal outcome when the feed was lost", () => {
    expect(
      liveOutcome([], true, {
        state: "cancelled",
        verification_status: "unchecked",
      }).state
    ).toBe("cancelled")
  })
})
