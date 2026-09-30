import { render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { Certificate } from "../src/verification/certificate"
import { broken, mixed, plainNoCheckpoints, report, truncated } from "./verification/fixtures"

describe("Certificate", () => {
  it("reads in order: verdict, limits, ribbon, breaks, checks, coverage", () => {
    render(<Certificate response={{ noChain: false, report: broken }} />)
    const headings = screen.getAllByRole("heading").map((h) => h.textContent)
    expect(headings).toEqual([
      expect.stringContaining("Breaks found"),
      "What this check cannot see",
      "Where",
      "What was found",
      "Removed by retention",
      "What was examined",
      "Coverage",
    ])
  })

  it("makes an unkeyed pass's limits the loudest thing, directly under the verdict", () => {
    render(<Certificate response={{ noChain: false, report: plainNoCheckpoints }} />)
    const limits = screen.getByRole("region", { name: "What this check cannot see" })
    expect(limits.getAttribute("data-loud")).toBe("true")
    expect(limits.compareDocumentPosition(screen.getByRole("region", { name: "Where" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("renders all three states of a checked field on one page", () => {
    // held: head; failed: checkpoint against head; not checked: a checkpoint hash
    render(<Certificate response={{ noChain: false, report: truncated }} />)
    const examined = screen.getByRole("region", { name: "What was examined" })
    expect(within(examined).getByText("Does not match the last event")).toBeTruthy()
    expect(within(examined).getByText("Reaches past the head")).toBeTruthy()
    const notChecked = within(examined).getByText("The checkpoint ends past the chain's head, so its hash could not be compared.")
    expect(notChecked.className).toContain("text-muted-foreground")
    // A badge means an opinion was formed, and nothing was checked here.
    expect(notChecked.closest('[data-slot="badge"]')).toBeNull()
    expect(within(examined).getByText("Does not match the last event").closest('[data-slot="badge"]')).not.toBeNull()
  })

  it("never renders a missing checkpoint store as No", () => {
    render(<Certificate response={{ noChain: false, report: plainNoCheckpoints }} checkpointingConfigured={false} />)
    expect(screen.getAllByText("Not checked, this deployment stores no checkpoints").length).toBeGreaterThan(0)
    expect(screen.queryByText(/^No$/)).toBeNull()
  })

  it("gives every break a focusable row with its anchor", () => {
    render(<Certificate response={{ noChain: false, report: broken }} />)
    const row = document.getElementById("break-altered-2780")
    expect(row?.getAttribute("tabindex")).toBe("-1")
    expect(row?.textContent).toContain("2,780")
  })

  it("lists coverage spans with their level badges and mono ranges", () => {
    render(<Certificate response={{ noChain: false, report: mixed }} />)
    const cov = screen.getByRole("region", { name: "Coverage" })
    expect(within(cov).getByText("unkeyed")).toBeTruthy()
    expect(within(cov).getByText("48,201").className).toContain("font-mono")
  })

  it("puts nothing in destructive colour for a pass", () => {
    const { container } = render(<Certificate response={{ noChain: false, report: report() }} />)
    expect(container.querySelector(".text-destructive, .bg-destructive")).toBeNull()
  })

  it("says there is no chain, and nothing else, when the scope never recorded", () => {
    render(<Certificate response={{ noChain: true }} />)
    expect(screen.getByText(/has not recorded any events/)).toBeTruthy()
    expect(screen.queryByRole("region", { name: "What was examined" })).toBeNull()
  })
})
