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
      </PluginErrorBoundary>
    )
    expect(screen.getByText("custom fallback")).toBeTruthy()
  })

  it("still renders the default message when no fallback is supplied", () => {
    render(
      <PluginErrorBoundary plugin="auth">
        <Exploding />
      </PluginErrorBoundary>
    )
    expect(screen.queryByText("custom fallback")).toBeNull()
    // Absence alone would also pass if the boundary rendered nothing at all.
    // The default message has to actually be on screen, not merely not be
    // the custom one.
    expect(screen.getByText(/this plugin failed to render/i)).toBeTruthy()
  })
})

describe("FallbackAuthGate", () => {
  it("names the wiring mistake when no plugin declares auth", () => {
    render(<FallbackAuthGate reason="no-provider" />)
    expect(screen.getByRole("alert").textContent).toMatch(
      /no plugin declares auth/i
    )
  })

  it("says the screen failed when an auth screen threw", () => {
    render(<FallbackAuthGate reason="screen-failed" />)
    expect(screen.getByRole("alert").textContent).toMatch(/failed to render/i)
  })
})
