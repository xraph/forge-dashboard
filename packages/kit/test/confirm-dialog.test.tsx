import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { ConfirmDialog } from "../src/components/confirm-dialog"

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
