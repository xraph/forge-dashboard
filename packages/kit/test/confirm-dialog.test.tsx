import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { ConfirmDialog } from "../src/components/confirm-dialog"
import { CommandAlert } from "../src/components/query-boundary"

describe("ConfirmDialog", () => {
  it("renders nothing while closed", () => {
    render(
      <ConfirmDialog
        open={false}
        onOpenChange={() => {}}
        title="Ban ada@example.com?"
        onConfirm={() => {}}
      />,
    )
    expect(screen.queryByText("Ban ada@example.com?")).toBeNull()
  })

  it("shows the title and description when open", () => {
    render(
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        title="Ban ada@example.com?"
        description="They will be signed out of every session."
        onConfirm={() => {}}
      />,
    )
    expect(screen.getByText("Ban ada@example.com?")).toBeTruthy()
    expect(screen.getByText("They will be signed out of every session.")).toBeTruthy()
  })

  it("renders children outside the description, so a block alert is valid markup", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      render(
        <ConfirmDialog
          open
          onOpenChange={() => {}}
          title="Delete orders?"
          description="The bucket and its objects are removed."
          onConfirm={() => {}}
        >
          <CommandAlert
            error={{ code: "conflict", message: "The bucket is not empty." }}
            title="Could not delete the bucket"
          />
        </ConfirmDialog>,
      )
      const alert = screen.getByRole("alert")
      expect(alert.textContent).toContain("The bucket is not empty.")
      // A <div> inside the description's <p> is what React complained about.
      expect(alert.closest("p")).toBeNull()
      expect(screen.getByText("The bucket and its objects are removed.").contains(alert)).toBe(false)
      const nesting = consoleError.mock.calls.filter((args) =>
        args.map(String).join(" ").includes("cannot be a descendant of"),
      )
      expect(nesting).toEqual([])
    } finally {
      consoleError.mockRestore()
    }
  })

  it("calls onConfirm when the confirm button is pressed", () => {
    const onConfirm = vi.fn()
    render(
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        title="Ban ada@example.com?"
        confirmLabel="Ban"
        onConfirm={onConfirm}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Ban" }))
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it("disables confirm and says so while a command is in flight", () => {
    render(
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        title="Ban ada@example.com?"
        confirmLabel="Ban"
        pending
        onConfirm={() => {}}
      />,
    )
    const confirm = screen.getByRole("button", { name: "Working…" })
    expect((confirm as HTMLButtonElement).disabled).toBe(true)
  })

  it("disables confirm without claiming to be working when the caller is not ready", () => {
    render(
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        title="Kick this connection?"
        confirmLabel="Kick"
        confirmDisabled
        onConfirm={() => {}}
      />,
    )
    // Label unchanged: this is "not yet", not "working on it", and swapping
    // the label would tell the operator something false about what is
    // happening.
    const confirm = screen.getByRole("button", { name: "Kick" })
    expect((confirm as HTMLButtonElement).disabled).toBe(true)
    // Cancel stays available. Somebody who cannot confirm must still be able
    // to back out.
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(false)
  })
})
