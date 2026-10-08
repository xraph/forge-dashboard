import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { Settings2 } from "@forge-go/dashboard-kit/icons"
import { IconButton } from "../src/components/icon-button"

describe("IconButton", () => {
  it("keeps the action accessible and shows its tooltip on keyboard focus", async () => {
    const onClick = vi.fn()
    render(<IconButton label="Refresh discovery" onClick={onClick} />)
    const button = screen.getByRole("button", { name: "Refresh discovery" })
    expect(button.textContent).toBe("")
    expect(button.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
      "true"
    )
    expect(
      button.querySelector("svg")?.classList.contains("lucide-refresh-cw")
    ).toBe(true)
    fireEvent.focus(button)
    expect((await screen.findByText("Refresh discovery")).textContent).toBe(
      "Refresh discovery"
    )
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledOnce()
  })

  it("preserves disabled actions and resource-specific accessible names", () => {
    const onClick = vi.fn()
    render(
      <IconButton
        label="Delete"
        aria-label="Delete webhook example"
        disabled
        onClick={onClick}
      />
    )
    const button = screen.getByRole("button", {
      name: "Delete webhook example",
    })
    expect(button.hasAttribute("disabled")).toBe(true)
    fireEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it("renders links without nesting interactive elements", () => {
    render(
      <IconButton
        label="Edit route"
        nativeButton={false}
        role="link"
        render={<a href="/routes/example/edit" />}
      />
    )
    const link = screen.getByRole("link", { name: "Edit route" })
    expect(link.getAttribute("href")).toBe("/routes/example/edit")
    expect(link.querySelector("svg")).toBeTruthy()
    expect(link.querySelector("button, a")).toBeNull()
  })

  it("supports an explicit plugin icon and a neutral unknown action", () => {
    render(
      <>
        <IconButton label="Custom action" icon={Settings2} />
        <IconButton label="Future action" />
      </>
    )
    expect(
      screen
        .getByRole("button", { name: "Custom action" })
        .querySelector(".lucide-settings-2")
    ).toBeTruthy()
    expect(
      screen
        .getByRole("button", { name: "Future action" })
        .querySelector(".lucide-ellipsis")
    ).toBeTruthy()
  })
})
