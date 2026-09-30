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
    // held: gaps; failed: head; not checked: a checkpoint hash
    render(<Certificate response={{ noChain: false, report: truncated }} />)
    const examined = screen.getByRole("region", { name: "What was examined" })

    // Held is an opinion formed and favourable: a badge, outline.
    const held = within(examined).getByText("No unexplained gaps")
    expect(held.closest('[data-slot="badge"]')?.getAttribute("data-variant")).toBe("outline")

    // Failed is an opinion formed and unfavourable: a badge, destructive.
    const failed = within(examined).getByText("Does not match the last event")
    expect(failed.closest('[data-slot="badge"]')?.getAttribute("data-variant")).toBe("destructive")

    // Not checked is no opinion: no badge, and muted. It opens with "Not
    // checked" like every other unchecked row, and the server's note says why.
    const notChecked = within(examined).getByText("Not checked. The checkpoint ends past the chain's head, so its hash could not be compared.")
    expect(notChecked.closest('[data-slot="badge"]')).toBeNull()
    expect(notChecked.className).toContain("text-muted-foreground")
  })

  it("scales the ribbon to the range that was examined, not to the head", () => {
    const examined = { ...broken, firstEvent: 2730, lastEvent: 2830, headSeq: 61004 }
    render(<Certificate response={{ noChain: false, report: examined }} />)
    // (2780 - 2730) / 101 sequences, and not 2780 / 61004.
    expect(screen.getByRole("button", { name: "Sequence 2,780 altered" }).style.left).toBe("49.5%")
    const where = screen.getByRole("region", { name: "Where" })
    expect(within(where).getByText("2,730")).toBeTruthy()
    expect(within(where).getByText("2,830")).toBeTruthy()
    expect(within(where).getByText("The chain's head is at sequence 61,004.")).toBeTruthy()
  })

  it("says nothing about the head under the ribbon when the range reaches it", () => {
    render(<Certificate response={{ noChain: false, report: broken }} />)
    expect(screen.queryByText(/The chain's head is at sequence/)).toBeNull()
  })

  it("names no range and draws no ribbon when nothing was verified", () => {
    const nothing = report({ verified: 0, firstEvent: 0, lastEvent: 0, headSeq: 0, coverage: undefined, checkpointsChecked: false, checkpointHeadChecked: false, headChecked: false })
    const { container } = render(<Certificate response={{ noChain: false, report: nothing }} />)
    expect(screen.queryByRole("region", { name: "Where" })).toBeNull()
    expect(screen.getByText("No events were read.")).toBeTruthy()
    expect(container.textContent).not.toMatch(/\d+ to 0\b|1 to 0/)
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
