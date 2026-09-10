import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { recordingCommandClient, renderPage, stubClient } from "./harness"
import { AuthSignupFormEditorPage, AuthSignupFormsPage } from "../src/pages/signup-forms"

const listAnswer = {
  formConfigs: [
    { id: "f1", formType: "signup", version: 3, active: true, createdAt: "2026-01-01T00:00:00Z" },
  ],
}

const signupAnswer = {
  appId: "app1",
  updatedAt: "2026-02-01T00:00:00Z",
  fields: [
    { key: "email", label: "Email", type: "input", order: 1 },
    { key: "password", label: "Password", type: "input", order: 2 },
    { key: "name", label: "Name", type: "input", order: 3 },
  ],
}

describe("AuthSignupFormsPage", () => {
  it("lists the saved form configurations", async () => {
    const { client } = stubClient({ "formConfigs.list": listAnswer })
    renderPage(AuthSignupFormsPage, client)
    await waitFor(() => expect(screen.getByText("signup")).toBeTruthy())
    expect(screen.getByText("3")).toBeTruthy()
  })
})

describe("AuthSignupFormEditorPage", () => {
  it("shows each field's key and label", async () => {
    const { client } = stubClient({ "formConfigs.signup": signupAnswer })
    renderPage(AuthSignupFormEditorPage, client)
    await waitFor(() => expect(screen.getByDisplayValue("email")).toBeTruthy())
    expect(screen.getByDisplayValue("Email")).toBeTruthy()
    expect(screen.getByDisplayValue("password")).toBeTruthy()
    expect(screen.getByDisplayValue("Password")).toBeTruthy()
    expect(screen.getByDisplayValue("name")).toBeTruthy()
    expect(screen.getByDisplayValue("Name")).toBeTruthy()
  })

  it("appends a new field with the next order value", async () => {
    const { client } = stubClient({ "formConfigs.signup": signupAnswer })
    renderPage(AuthSignupFormEditorPage, client)
    await waitFor(() => expect(screen.getByDisplayValue("email")).toBeTruthy())

    expect(screen.getAllByLabelText("Key")).toHaveLength(3)
    fireEvent.click(screen.getByRole("button", { name: "Add field" }))

    expect(screen.getAllByLabelText("Key")).toHaveLength(4)
    // The three loaded fields have orders 1, 2, 3, so the appended field
    // takes the next one, 4.
    expect(screen.getByText("Order 4")).toBeTruthy()
  })

  it("removing a field leaves the rest contiguous", async () => {
    const { client } = stubClient({ "formConfigs.signup": signupAnswer })
    renderPage(AuthSignupFormEditorPage, client)
    await waitFor(() => expect(screen.getByDisplayValue("email")).toBeTruthy())

    // Remove the middle field (password, order 2). What remains (email,
    // order 1; name, order 3) must close the gap rather than leave a hole.
    fireEvent.click(screen.getByRole("button", { name: "Remove Password" }))

    expect(screen.queryByDisplayValue("password")).toBeNull()
    expect(screen.getAllByLabelText("Key")).toHaveLength(2)
    expect(screen.getByText("Order 1")).toBeTruthy()
    expect(screen.getByText("Order 2")).toBeTruthy()
    expect(screen.queryByText("Order 3")).toBeNull()
  })

  it("moving a field up swaps the two order values, not only the array positions", async () => {
    const { client } = stubClient({ "formConfigs.signup": signupAnswer })
    renderPage(AuthSignupFormEditorPage, client)
    await waitFor(() => expect(screen.getByDisplayValue("email")).toBeTruthy())

    // Move "name" (order 3) up past "password" (order 2).
    fireEvent.click(screen.getByRole("button", { name: "Move Name up" }))

    const keys = screen.getAllByLabelText("Key") as HTMLInputElement[]
    // The field content re-orders too, not only the numbers next to it: name
    // now renders before password.
    expect(keys.map((k) => k.value)).toEqual(["email", "name", "password"])

    const orders = screen.getAllByText(/^Order \d$/).map((el) => el.textContent)
    expect(orders).toEqual(["Order 1", "Order 2", "Order 3"])
  })

  it("sends the whole fields array on save", async () => {
    const { client, sent } = recordingCommandClient(
      { "formConfigs.signup": signupAnswer },
      { "formConfigs.saveSignup": { ok: true } },
    )
    renderPage(AuthSignupFormEditorPage, client)
    await waitFor(() => expect(screen.getByDisplayValue("email")).toBeTruthy())

    fireEvent.click(screen.getByRole("button", { name: "Save" }))

    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0].intent).toBe("formConfigs.saveSignup")
    const payload = sent[0].payload as { fields: unknown[]; active: boolean }
    expect(payload.fields).toEqual(signupAnswer.fields)
    expect(payload.active).toBe(true)
  })

  it("confirms before deleting, then sends an empty payload", async () => {
    const { client, sent } = recordingCommandClient(
      { "formConfigs.signup": signupAnswer },
      { "formConfigs.deleteSignup": { ok: true } },
    )
    renderPage(AuthSignupFormEditorPage, client)
    await waitFor(() => expect(screen.getByDisplayValue("email")).toBeTruthy())

    fireEvent.click(screen.getByRole("button", { name: "Delete signup form" }))
    expect(sent).toHaveLength(0)
    expect(screen.getByText(/removed entirely/)).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Delete" }))
    await waitFor(() => expect(sent).toHaveLength(1))
    // `formConfigs.deleteSignup` takes no input: it deletes the one signup
    // form config for the current app context, not one picked by id.
    expect(sent[0]).toEqual({ intent: "formConfigs.deleteSignup", payload: {} })
    expect(screen.getByText("The signup form has been deleted.")).toBeTruthy()
  })

  it("shows the server's reason and leaves the delete dialog open when the delete fails", async () => {
    const { client } = recordingCommandClient(
      { "formConfigs.signup": signupAnswer },
      { "formConfigs.deleteSignup": new ContractError("VALIDATION", "no signup form to delete") },
    )
    renderPage(AuthSignupFormEditorPage, client)
    await waitFor(() => expect(screen.getByDisplayValue("email")).toBeTruthy())

    fireEvent.click(screen.getByRole("button", { name: "Delete signup form" }))
    fireEvent.click(screen.getByRole("button", { name: "Delete" }))

    // The alert lives inside the open dialog's own description, so it is
    // reachable without reaching past Base UI's `aria-hidden` on the rest of
    // the page.
    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toContain("Could not delete")
    expect(alert.textContent).toContain("no signup form to delete")
    expect(screen.getByRole("alertdialog")).toBeTruthy()
  })
})
