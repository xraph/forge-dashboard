import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { PageHeader } from "../src/components/page-header"

describe("PageHeader", () => {
  it("renders the title as the page's level-one heading", () => {
    render(<PageHeader title="Users" />)
    const heading = screen.getByRole("heading", { level: 1, name: "Users" })
    expect(heading).toBeTruthy()
  })

  it("renders a description when given one", () => {
    render(<PageHeader title="Users" description="Everyone who can sign in." />)
    expect(screen.getByText("Everyone who can sign in.")).toBeTruthy()
  })

  it("renders actions alongside the title", () => {
    render(<PageHeader title="Users" actions={<button>New user</button>} />)
    expect(screen.getByRole("button", { name: "New user" })).toBeTruthy()
  })
})
