import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { DescriptionList, DetailLayout } from "../src/components/detail-layout"

describe("DescriptionList", () => {
  it("pairs each term with its value in a real definition list", () => {
    const { container } = render(
      <DescriptionList
        items={[
          { term: "Email", value: "ada@example.com" },
          { term: "Status", value: "active" },
        ]}
      />,
    )
    expect(container.querySelector("dl")).toBeTruthy()
    expect(container.querySelectorAll("dt")).toHaveLength(2)
    expect(container.querySelectorAll("dd")).toHaveLength(2)
    expect(screen.getByText("Email")).toBeTruthy()
    expect(screen.getByText("ada@example.com")).toBeTruthy()
  })

  it("renders a node value, not just a string", () => {
    render(
      <DescriptionList items={[{ term: "Status", value: <span>banned</span> }]} />,
    )
    expect(screen.getByText("banned")).toBeTruthy()
  })
})

describe("DetailLayout", () => {
  it("renders main content on its own when there is no aside", () => {
    render(<DetailLayout main={<p>main pane</p>} />)
    expect(screen.getByText("main pane")).toBeTruthy()
    expect(screen.queryByRole("complementary")).toBeNull()
  })

  it("renders the aside as a complementary landmark when given one", () => {
    render(<DetailLayout main={<p>main pane</p>} aside={<p>side pane</p>} />)
    expect(screen.getByRole("complementary")).toBeTruthy()
    expect(screen.getByText("side pane")).toBeTruthy()
  })
})
