import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { CircuitBadge, EnabledBadge, HealthBadge } from "../src/badges"

function variantOf(text: string) {
  return screen.getByText(text).getAttribute("data-variant")
}

describe("badges", () => {
  it("lets the ordinary state recede and the broken one stand out", () => {
    render(
      <>
        <HealthBadge healthy />
        <HealthBadge healthy={false} />
        <CircuitBadge state="closed" />
        <CircuitBadge state="half_open" />
        <CircuitBadge state="open" />
        <EnabledBadge enabled={false} />
      </>
    )
    expect(variantOf("Healthy")).toBe("outline")
    expect(variantOf("Unhealthy")).toBe("destructive")
    expect(variantOf("Closed")).toBe("outline")
    expect(variantOf("Half-open")).toBe("default")
    expect(variantOf("Open")).toBe("destructive")
    expect(variantOf("Disabled")).toBe("secondary")
  })
})
