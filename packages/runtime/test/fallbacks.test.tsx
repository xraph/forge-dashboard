import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { PluginErrorBoundary } from "../src/fallbacks"

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
})
