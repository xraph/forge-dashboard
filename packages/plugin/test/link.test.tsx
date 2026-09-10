import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { NavigationProvider, PluginLink } from "../src/link"
import type { PluginLinkProps } from "../src/link"

function RouterLink({ to, children, className, ...rest }: PluginLinkProps) {
  return (
    <a data-router="yes" href={to} className={className} {...rest}>
      {children}
    </a>
  )
}

describe("PluginLink", () => {
  it("renders a real anchor with the right href outside any host", () => {
    render(<PluginLink to="/@auth/users/u1">Details</PluginLink>)
    const link = screen.getByRole("link", { name: "Details" })
    // The fallback is a real link, not a stub. A test asserting on href reads
    // the same whether or not a host is present.
    expect(link.getAttribute("href")).toBe("/@auth/users/u1")
    expect(link.getAttribute("data-router")).toBeNull()
  })

  it("uses the host's router link when there is one", () => {
    render(
      <NavigationProvider value={{ Link: RouterLink, navigate: () => {} }}>
        <PluginLink to="/@auth/users/u1">Details</PluginLink>
      </NavigationProvider>,
    )
    // Inside the shell this must be a client-side navigation. A plain anchor
    // is a full document load: capabilities refetched, every plugin remounted,
    // the query store thrown away, all to look at one user.
    expect(screen.getByRole("link", { name: "Details" }).getAttribute("data-router")).toBe("yes")
  })

  it("carries className and aria-label through in both modes", () => {
    const { rerender } = render(
      <PluginLink to="/x" className="underline" aria-label="Open x">
        x
      </PluginLink>,
    )
    expect(screen.getByLabelText("Open x").className).toBe("underline")
    rerender(
      <NavigationProvider value={{ Link: RouterLink, navigate: () => {} }}>
        <PluginLink to="/x" className="underline" aria-label="Open x">
          x
        </PluginLink>
      </NavigationProvider>,
    )
    expect(screen.getByLabelText("Open x").className).toBe("underline")
  })
})
