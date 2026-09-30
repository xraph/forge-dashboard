import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { Ribbon } from "../src/verification/ribbon"
import { broken, mixed } from "./verification/fixtures"

describe("Ribbon", () => {
  it("draws one band per coverage span, labelled with its level", () => {
    render(<Ribbon report={mixed} fromSeq={1} toSeq={61004} />)
    expect(screen.getAllByTestId("ribbon-band").map((b) => b.getAttribute("data-level"))).toEqual([
      "unkeyed",
      "signed",
      "keyed",
    ])
  })

  it("puts each break at its sequence as a focusable control named for it", () => {
    render(<Ribbon report={broken} fromSeq={1} toSeq={5000} />)
    const markers = screen.getAllByRole("button")
    expect(markers.map((m) => m.getAttribute("aria-label"))).toEqual([
      "Sequences 2,311 to 2,312 missing",
      "Sequence 2,780 altered",
      "Sequence 2,901 relabelled",
    ])
    // 2780 of 1..5000 sits a little past halfway.
    expect(markers[1].style.left).toBe("55.58%")
  })

  it("moves focus to the break's row when a marker is activated", () => {
    render(
      <>
        <Ribbon report={broken} fromSeq={1} toSeq={5000} />
        <table>
          <tbody>
            <tr id="break-altered-2780" tabIndex={-1}>
              <td>row</td>
            </tr>
          </tbody>
        </table>
      </>,
    )
    fireEvent.click(screen.getByRole("button", { name: "Sequence 2,780 altered" }))
    expect(document.activeElement?.id).toBe("break-altered-2780")
  })

  it("shades retained ranges without calling them breaks", () => {
    render(<Ribbon report={broken} fromSeq={1} toSeq={5000} />)
    expect(screen.getAllByTestId("ribbon-retained")).toHaveLength(1)
    expect(screen.queryByRole("button", { name: /101/ })).toBeNull()
  })

  it("does not animate when the operator prefers reduced motion", () => {
    render(<Ribbon report={broken} fromSeq={1} toSeq={5000} />)
    expect(screen.getByTestId("ribbon-track").className).toContain("motion-reduce:transition-none")
  })
})
