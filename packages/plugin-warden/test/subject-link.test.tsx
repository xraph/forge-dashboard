import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { SubjectLink, subjectPath } from "../src/components/subject-link"

describe("SubjectLink", () => {
  it("links kind:id to the subject's access page", () => {
    render(<SubjectLink kind="user" id="alice" />)
    const link = screen.getByRole("link", { name: "user:alice" })
    expect(link.getAttribute("href")).toBe("/subjects/user/alice")
  })

  it("encodes both parts, so an id holding a slash stays one path segment", () => {
    render(<SubjectLink kind="api key" id="a/b c?d#e" />)
    const link = screen.getByRole("link", { name: "api key:a/b c?d#e" })
    expect(link.getAttribute("href")).toBe("/subjects/api%20key/a%2Fb%20c%3Fd%23e")
  })

  it("encodes the id exactly as encodeURIComponent does", () => {
    const id = "svc/ci:prod+1"
    expect(subjectPath("service", id)).toBe(`/subjects/service/${encodeURIComponent(id)}`)
    expect(subjectPath("service", id)).toContain("%2F")
  })

  it("renders plain text when the kind is empty, because the route cannot carry it", () => {
    const { container } = render(<SubjectLink kind="" id="alice" className="font-medium" />)
    expect(screen.queryByRole("link")).toBeNull()
    const text = screen.getByText(":alice")
    expect(text.className).toContain("font-medium")
    expect(container.querySelector("a")).toBeNull()
  })

  it("renders plain text when the id is empty, which no route matches", () => {
    render(<SubjectLink kind="user" id="" />)
    expect(screen.queryByRole("link")).toBeNull()
    expect(screen.getByText("user:")).toBeTruthy()
  })

  it("passes its class name to the link", () => {
    render(<SubjectLink kind="user" id="alice" className="font-mono text-xs" />)
    const link = screen.getByRole("link", { name: "user:alice" })
    expect(link.className).toContain("font-mono")
    expect(link.className).toContain("text-xs")
  })
})
