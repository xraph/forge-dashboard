import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { NavigationSection } from "../src/components/navigation-section"

describe("NavigationSection", () => {
  it("folds only its own destinations and exposes the state to assistive technology", () => {
    render(
      <>
        <NavigationSection label="Workspace">
          <a href="/services">Services</a>
        </NavigationSection>
        <NavigationSection label="Observe">
          <a href="/metrics">Metrics</a>
        </NavigationSection>
      </>
    )
    const toggle = screen.getByRole("button", { name: "Collapse Workspace" })
    expect(
      document.getElementById(toggle.getAttribute("aria-controls")!)
    ).toBeTruthy()
    fireEvent.click(toggle)
    expect(
      screen
        .getByRole("button", { name: "Expand Workspace" })
        .getAttribute("aria-expanded")
    ).toBe("false")
    expect(screen.queryByRole("link", { name: "Services" })).toBeNull()
    expect(screen.getByRole("link", { name: "Metrics" })).toBeTruthy()
    fireEvent.click(toggle)
    expect(screen.getByRole("link", { name: "Services" })).toBeTruthy()
  })

  it("keeps destinations available when icon mode hides the heading", () => {
    const view = render(
      <NavigationSection label="Workspace">
        <a href="/services">Services</a>
      </NavigationSection>
    )
    fireEvent.click(screen.getByRole("button", { name: "Collapse Workspace" }))
    view.rerender(
      <NavigationSection>
        <a href="/services">Services</a>
      </NavigationSection>
    )
    expect(screen.getByRole("link", { name: "Services" })).toBeTruthy()
  })

  it("restores destinations after navigation changes", () => {
    const section = (path: string) => (
      <NavigationSection label="Workspace" navigationKey={path}>
        <a href="/services">Services</a>
      </NavigationSection>
    )
    const view = render(section("/overview"))
    fireEvent.click(screen.getByRole("button", { name: "Collapse Workspace" }))
    view.rerender(section("/services"))
    expect(screen.getByRole("link", { name: "Services" })).toBeTruthy()
    expect(
      screen
        .getByRole("button", { name: "Collapse Workspace" })
        .getAttribute("aria-expanded")
    ).toBe("true")
  })
})
