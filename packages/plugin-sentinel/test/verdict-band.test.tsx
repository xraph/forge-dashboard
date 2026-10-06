import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { VerdictBand } from "../src/components/verdict-band"
import { regressed, regression, run, runningRun } from "./fixtures"

const NOW = Date.parse("2026-09-30T14:03:08Z")

describe("VerdictBand", () => {
  it("measures last progress from the clock it is given", () => {
    render(<VerdictBand run={runningRun()} regression={regression({ state: "running" })} now={NOW} />)
    expect(screen.getByRole("region", { name: "Verdict" }).textContent).toContain(
      "Last progress 8 s ago. There is no verdict until the run finishes.",
    )
  })

  it("says no case is scored yet before the first result", () => {
    render(
      <VerdictBand
        run={runningRun({ completedCases: 0, lastProgressAt: undefined })}
        regression={regression({ state: "running" })}
        now={NOW}
      />,
    )
    expect(screen.getByRole("region", { name: "Verdict" }).textContent).toContain("0 of 4 cases scored")
    expect(screen.getByRole("region", { name: "Verdict" }).textContent).toContain("No case scored yet.")
  })

  it("says when the threshold was set for the view", () => {
    render(<VerdictBand run={run()} regression={regressed({ thresholdSource: "override", threshold: 0.1 })} />)
    expect(screen.getByRole("region", { name: "Verdict" }).textContent).toContain("threshold 0.10 set for this view")
  })

  it("lists missing and new cases as evidence", () => {
    render(
      <VerdictBand
        run={run()}
        regression={regressed({
          missingDimensions: [],
          missingCases: [{ caseId: "a", caseName: "A" }],
          newCases: [
            { caseId: "b", caseName: "B" },
            { caseId: "c", caseName: "C" },
          ],
        })}
      />,
    )
    const text = screen.getByRole("region", { name: "Verdict" }).textContent ?? ""
    expect(text).toContain("1 case missing from this run")
    expect(text).toContain("2 new cases")
    expect(text).not.toContain("not measured")
  })

  it("names the dimension that fell when nothing else did, and claims no regressed case", () => {
    render(
      <VerdictBand
        run={run()}
        regression={regressed({
          regressedCases: [],
          missingDimensions: [],
          passRateDelta: 0,
          avgScoreDelta: -0.02,
          dimensionDeltas: { persona: -0.15, trait: -0.01 },
        })}
      />,
    )
    const text = screen.getByRole("region", { name: "Verdict" }).textContent ?? ""
    expect(text).toContain(`Regressed against "Release 1.4"`)
    expect(text).toContain("persona −0.15")
    expect(text).not.toContain("trait")
    expect(text).not.toContain("Avg score")
    expect(text).not.toContain("cases regressed")
    expect(text).not.toContain("No case fell")
  })

  it("names an average score that fell past the threshold", () => {
    render(<VerdictBand run={run()} regression={regressed({ regressedCases: [], avgScoreDelta: -0.08 })} />)
    expect(screen.getByRole("region", { name: "Verdict" }).textContent).toContain("Avg score −0.08")
  })

  it("keeps a threshold's third decimal", () => {
    render(<VerdictBand run={run()} regression={regressed({ threshold: 0.025 })} />)
    expect(screen.getByRole("region", { name: "Verdict" }).textContent).toContain("threshold 0.025 recorded by the run")
  })

  it("names a baseline from another suite as the reason there is no comparison", () => {
    render(<VerdictBand run={run()} regression={regression({ state: "notComparable", reason: "otherSuite" })} />)
    expect(screen.getByText("That baseline belongs to another suite, so it is not compared")).toBeTruthy()
  })

  it("marks only a regression with the destructive edge, beside an icon and words", () => {
    const { container, rerender } = render(<VerdictBand run={run()} regression={regressed()} />)
    const edge = () => screen.getByRole("region", { name: "Verdict" }).className
    expect(edge()).toContain("border-l-destructive")
    expect(container.querySelector("svg")).toBeTruthy()
    rerender(<VerdictBand run={run()} regression={regressed({ hasRegression: false, regressedCases: [] })} />)
    expect(edge()).not.toContain("destructive")
  })
})
