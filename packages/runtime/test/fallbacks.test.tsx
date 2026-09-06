import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { IntentErrorBoundary } from "../src/fallbacks"

function Exploding(): never {
  throw new Error("intent component blew up")
}

describe("intent error boundary", () => {
  it("contains a throwing intent and keeps its sibling on screen", () => {
    // React logs the caught error to stderr. That output is expected here.
    render(
      <main>
        <IntentErrorBoundary intent="atom.boom">
          <Exploding />
        </IntentErrorBoundary>
        {/* A bare sibling, not a second boundary: with GraphRenderer gone,
            nothing wraps every intent in its own boundary automatically. The
            contract under test is unchanged either way - throw contained,
            sibling survives - so a plain element proves it just as well. */}
        <span>still here</span>
      </main>
    )

    expect(screen.getByText(/atom.boom/)).toBeDefined()
    expect(screen.getByText("still here")).toBeDefined()
  })
})
