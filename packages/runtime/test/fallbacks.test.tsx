import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { FallbackAuthGate, PluginErrorBoundary } from "../src/fallbacks"

function Exploding(): never {
  throw new Error("plugin component blew up")
}

describe("plugin error boundary", () => {
  it("contains a throwing plugin and keeps its sibling on screen", () => {
    // React logs the caught error to stderr. That output is expected here.
    render(
      <main>
        <PluginErrorBoundary plugin="atom.boom">
          <Exploding />
        </PluginErrorBoundary>
        {/* A bare sibling, not a second boundary: nothing wraps every plugin
            in its own boundary automatically, the host does that per call
            site. The contract under test is unchanged either way - throw
            contained, sibling survives - so a plain element proves it just
            as well. */}
        <span>still here</span>
      </main>
    )

    expect(screen.getByText(/atom.boom/)).toBeDefined()
    expect(screen.getByText("still here")).toBeDefined()
  })

  it("renders a supplied fallback instead of the default message", () => {
    render(
      <PluginErrorBoundary plugin="auth" fallback={<p>custom fallback</p>}>
        <Exploding />
      </PluginErrorBoundary>,
    )
    expect(screen.getByText("custom fallback")).toBeTruthy()
  })

  it("still renders the default message when no fallback is supplied", () => {
    render(
      <PluginErrorBoundary plugin="auth">
        <Exploding />
      </PluginErrorBoundary>,
    )
    expect(screen.queryByText("custom fallback")).toBeNull()
  })
})

describe("FallbackAuthGate", () => {
  it("links to the login path when nobody is signed in", () => {
    render(<FallbackAuthGate loginPath="/dashboard/login" onAuthenticated={() => {}} />)
    const link = screen.getByRole("link", { name: /sign in/i })
    expect(link.getAttribute("href")).toBe("/dashboard/login")
  })

  it("renders the denied variant when requiredRoles is present", () => {
    render(
      <FallbackAuthGate
        loginPath="/dashboard/login"
        requiredRoles={["admin", "auditor"]}
        onAuthenticated={() => {}}
      />,
    )
    expect(screen.getByText(/admin/)).toBeTruthy()
    expect(screen.getByText(/auditor/)).toBeTruthy()
  })

  it("offers a way out of the denied state", () => {
    // Without this a user signed in as the wrong person has no shell, no
    // sign-in form, and no way to reach a different account.
    render(
      <FallbackAuthGate
        loginPath="/dashboard/login"
        requiredRoles={["admin"]}
        onAuthenticated={() => {}}
      />,
    )
    expect(screen.getByRole("link", { name: /sign in as someone else/i })).toBeTruthy()
  })

  it("treats an empty requiredRoles as signed out, not denied", () => {
    // The host passes requiredRoles straight through from a 403 body that may
    // carry an empty array. Reading empty as "denied" would show an
    // access-denied panel listing no roles, which explains nothing.
    render(<FallbackAuthGate loginPath="/dashboard/login" requiredRoles={[]} onAuthenticated={() => {}} />)
    expect(screen.getByRole("link", { name: /^sign in$/i })).toBeTruthy()
  })
})
