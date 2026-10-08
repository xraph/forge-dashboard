import { expect, it, vi } from "vitest"
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ContractError, PluginProvider } from "@forge-go/dashboard-plugin"
import { Action } from "../src/action"
import { clientFor, renderWithClient } from "./harness"

const props = {
  intent: "jobs.retry",
  payload: { id: "job-a" },
  label: "Retry",
  title: "Retry job-a?",
  description: "Runs job-a again from the start on queue emails.",
}
it("requires confirmation, pins the described payload, and prevents duplicate pending commands", async () => {
  let finish!: (value: unknown) => void
  const send = vi.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const client = clientFor({}, { "jobs.retry": send })
  const done = vi.fn()
  const view = renderWithClient(<Action {...props} onSuccess={done} />, client)
  fireEvent.click(screen.getByRole("button", { name: "Retry" }))
  const dialog = screen.getByRole("alertdialog")
  expect(send).not.toHaveBeenCalled()
  view.rerender(
    <PluginProvider client={client}>
      <Action
        {...props}
        payload={{ id: "job-b" }}
        title="Retry job-b?"
        onSuccess={done}
      />
    </PluginProvider>
  )
  expect(within(dialog).getByText("Retry job-a?")).toBeTruthy()
  fireEvent.click(within(dialog).getByRole("button", { name: "Retry" }))
  fireEvent.click(within(dialog).getByRole("button", { name: "Working…" }))
  expect(send).toHaveBeenCalledTimes(1)
  expect(send).toHaveBeenCalledWith({ id: "job-a" })
  expect(
    within(dialog)
      .getByRole("button", { name: "Cancel" })
      .hasAttribute("disabled")
  ).toBe(true)
  await act(async () => finish({ ok: true }))
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
  expect(done).toHaveBeenCalledWith({ ok: true })
})
it("keeps failures inside the dialog and clears them when it is reopened", async () => {
  const client = clientFor(
    {},
    {
      "jobs.retry": () => {
        throw new ContractError("CONFLICT", "Job is already running")
      },
    }
  )
  renderWithClient(<Action {...props} />, client)
  fireEvent.click(screen.getByRole("button", { name: "Retry" }))
  fireEvent.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: "Retry",
    })
  )
  await screen.findByText("Job is already running")
  expect(
    within(screen.getByRole("alertdialog")).getByRole("alert").textContent
  ).toContain("CONFLICT")
  fireEvent.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: "Cancel",
    })
  )
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
  fireEvent.click(screen.getByRole("button", { name: "Retry" }))
  expect(
    within(screen.getByRole("alertdialog")).queryByRole("alert")
  ).toBeNull()
})
