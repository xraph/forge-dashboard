import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { AuthLayout } from "../src/components/auth-layout"

describe("AuthLayout", () => {
  it("renders the title, description and children", () => {
    render(
      <AuthLayout description="Welcome back." title="Sign in">
        <button type="submit">Continue</button>
      </AuthLayout>,
    )
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeDefined()
    expect(screen.getByText("Welcome back.")).toBeDefined()
    expect(screen.getByRole("button", { name: "Continue" })).toBeDefined()
  })

  it("shows the server host, which is what tells two Forges apart", () => {
    render(
      <AuthLayout serverHost="localhost:7901" title="Sign in">
        <div />
      </AuthLayout>,
    )
    expect(screen.getByText("localhost:7901")).toBeDefined()
  })

  it("falls back to a default brand when none is given", () => {
    render(<AuthLayout title="Sign in"><div /></AuthLayout>)
    expect(screen.getByText("Forge dashboard")).toBeDefined()
  })

  it("uses the given brand", () => {
    render(<AuthLayout brand="Platform" title="Sign in"><div /></AuthLayout>)
    expect(screen.getByText("Platform")).toBeDefined()
  })

  it("renders a footer when given one", () => {
    render(
      <AuthLayout footer={<a href="/forge/login">Back to sign in</a>} title="Reset">
        <div />
      </AuthLayout>,
    )
    expect(screen.getByRole("link", { name: "Back to sign in" })).toBeDefined()
  })
})
