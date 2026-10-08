import { describe, expect, it, vi } from "vitest"
import { act, render, renderHook, screen } from "@testing-library/react"
import { cloneElement, type ReactNode } from "react"
import { NavigationProvider, PluginLink, useNavigateTo } from "../src/link"
import type { Navigation, PluginLinkProps } from "../src/link"

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

  it("accepts children supplied by a composed control", () => {
    render(
      cloneElement(<PluginLink to="/routes/example/edit" />, {
        "aria-label": "Edit route",
        children: <svg aria-hidden="true" />,
      })
    )
    expect(
      screen.getByRole("link", { name: "Edit route" }).querySelector("svg")
    ).toBeTruthy()
  })

  it("uses the host's router link when there is one", () => {
    render(
      <NavigationProvider value={{ Link: RouterLink, navigate: () => {} }}>
        <PluginLink to="/@auth/users/u1">Details</PluginLink>
      </NavigationProvider>
    )
    // Inside the shell this must be a client-side navigation. A plain anchor
    // is a full document load: capabilities refetched, every plugin remounted,
    // the query store thrown away, all to look at one user.
    expect(
      screen.getByRole("link", { name: "Details" }).getAttribute("data-router")
    ).toBe("yes")
  })

  it("carries className and aria-label through in both modes", () => {
    const { rerender } = render(
      <PluginLink to="/x" className="underline" aria-label="Open x">
        x
      </PluginLink>
    )
    expect(screen.getByLabelText("Open x").className).toBe("underline")
    rerender(
      <NavigationProvider value={{ Link: RouterLink, navigate: () => {} }}>
        <PluginLink to="/x" className="underline" aria-label="Open x">
          x
        </PluginLink>
      </NavigationProvider>
    )
    expect(screen.getByLabelText("Open x").className).toBe("underline")
  })
})

describe("PluginLink with a host that resolves scope-relative paths", () => {
  const nav = {
    Link: RouterLink,
    navigate: () => {},
    resolve: (to: string) => `/@auth/acme${to}?env=prod`,
  }

  it("resolves a scope-relative path through the host", () => {
    render(
      <NavigationProvider value={nav}>
        <PluginLink to="/users/u1">Details</PluginLink>
      </NavigationProvider>
    )
    // The page wrote "/users/u1" and never had to know it was mounted under
    // an app. That is the property: a hardcoded "/@auth/users/u1" resolves
    // and renders and is about the wrong app.
    expect(
      screen.getByRole("link", { name: "Details" }).getAttribute("href")
    ).toBe("/@auth/acme/users/u1?env=prod")
  })

  it("leaves an already-addressed path alone, so cross-scope links still work", () => {
    render(
      <NavigationProvider value={nav}>
        <PluginLink to="/@streaming/rooms">Rooms</PluginLink>
      </NavigationProvider>
    )
    expect(
      screen.getByRole("link", { name: "Rooms" }).getAttribute("href")
    ).toBe("/@streaming/rooms")
  })

  it("uses the path as written when the host offers no resolver", () => {
    // A host predating routed context still satisfies the interface, and its
    // pages keep working rather than losing every link.
    render(
      <NavigationProvider value={{ Link: RouterLink, navigate: () => {} }}>
        <PluginLink to="/users/u1">Details</PluginLink>
      </NavigationProvider>
    )
    expect(
      screen.getByRole("link", { name: "Details" }).getAttribute("href")
    ).toBe("/users/u1")
  })
})

describe("useNavigateTo", () => {
  function withHost(nav: Navigation) {
    return ({ children }: { children: ReactNode }) => (
      <NavigationProvider value={nav}>{children}</NavigationProvider>
    )
  }

  it("hands replace to the host's navigate, after resolving the path", () => {
    const navigate = vi.fn()
    const { result } = renderHook(() => useNavigateTo(), {
      wrapper: withHost({
        Link: RouterLink,
        navigate,
        resolve: (to) => `/@keys${to}`,
      }),
    })

    result.current("/keys", { replace: true })
    expect(navigate).toHaveBeenLastCalledWith("/@keys/keys", { replace: true })

    // Every call site written before replace existed is a one-argument call,
    // and it still compiles and still pushes.
    result.current("/keys")
    expect(navigate).toHaveBeenLastCalledWith("/@keys/keys")
  })

  it("replaces the history entry outside a host, and pushes one otherwise", () => {
    // jsdom performs fragment navigations for real, history entries included,
    // which makes a hash the one target this can be checked against.
    const { result } = renderHook(() => useNavigateTo())
    const start = window.history.length

    act(() => result.current("#pushed"))
    expect(window.location.hash).toBe("#pushed")
    expect(window.history.length).toBe(start + 1)

    act(() => result.current("#replaced", { replace: true }))
    expect(window.location.hash).toBe("#replaced")
    expect(window.history.length).toBe(start + 1)
  })
})
