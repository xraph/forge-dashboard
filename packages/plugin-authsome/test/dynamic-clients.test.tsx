import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { recordingCommandClient, renderPage, stubClient } from "./harness"
import { AuthDynamicClientsPage } from "../src/pages/dynamic-clients"

const activeConfig = {
  title: "Create your account",
  description: "Tell us a bit about your team.",
  active: true,
  fields: [
    { key: "email", label: "Email", type: "email", order: 1 },
    { key: "password", label: "Password", type: "password", order: 2 },
    { key: "company", label: "Company", type: "text", order: 3 },
  ],
}

describe("AuthDynamicClientsPage", () => {
  it("says dynamic registration is disabled and shows no form when inactive", async () => {
    const { client } = stubClient({ "auth.dynamicConfig": { active: false } })
    renderPage(AuthDynamicClientsPage, client)
    await waitFor(() =>
      expect(screen.getByText(/Dynamic registration is disabled/)).toBeTruthy(),
    )
    expect(screen.queryByLabelText("Email")).toBeNull()
    expect(screen.queryByRole("button", { name: "Register" })).toBeNull()
  })

  it("lists the configured fields with a live count", async () => {
    const { client } = stubClient({ "auth.dynamicConfig": activeConfig })
    renderPage(AuthDynamicClientsPage, client)
    await waitFor(() => expect(screen.getByText("Create your account")).toBeTruthy())
    expect(screen.getByText("company")).toBeTruthy()
    expect(screen.getByText("3 fields")).toBeTruthy()
  })

  it("shows a live count of zero for a config with no fields", async () => {
    const { client } = stubClient({
      "auth.dynamicConfig": { active: true, fields: [] },
    })
    renderPage(AuthDynamicClientsPage, client)
    await waitFor(() => expect(screen.getByText("0 fields")).toBeTruthy())
    expect(screen.getByText("No fields configured.")).toBeTruthy()
  })

  it("registers with email, password and the extra field folded into metadata", async () => {
    const { client, sent } = recordingCommandClient(
      { "auth.dynamicConfig": activeConfig },
      { "auth.dynamicRegister": { ok: true, subject: "user_1" } },
    )
    renderPage(AuthDynamicClientsPage, client)
    await waitFor(() => expect(screen.getByText("Create your account")).toBeTruthy())

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "admin@example.com" },
    })
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "hunter2hunter2" },
    })
    fireEvent.change(screen.getByLabelText("Company"), {
      target: { value: "Acme" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Register" }))

    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toEqual({
      intent: "auth.dynamicRegister",
      payload: {
        email: "admin@example.com",
        password: "hunter2hunter2",
        metadata: { company: "Acme" },
      },
    })

    // No secret to reveal: auth.dynamicRegister hands back a session
    // subject, not client credentials.
    await waitFor(() => expect(screen.getByText(/Registration succeeded/)).toBeTruthy())
    expect(screen.getByText("user_1")).toBeTruthy()
  })

  it("does not send a name or metadata that were left blank", async () => {
    const { client, sent } = recordingCommandClient(
      { "auth.dynamicConfig": activeConfig },
      { "auth.dynamicRegister": { ok: true, subject: "user_2" } },
    )
    renderPage(AuthDynamicClientsPage, client)
    await waitFor(() => expect(screen.getByText("Create your account")).toBeTruthy())

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "admin@example.com" },
    })
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "hunter2hunter2" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Register" }))

    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toEqual({
      intent: "auth.dynamicRegister",
      payload: { email: "admin@example.com", password: "hunter2hunter2" },
    })
  })

  it("will not register without an email and a password", async () => {
    const { client, sent } = recordingCommandClient(
      { "auth.dynamicConfig": activeConfig },
      { "auth.dynamicRegister": { ok: true, subject: "user_3" } },
    )
    renderPage(AuthDynamicClientsPage, client)
    await waitFor(() => expect(screen.getByText("Create your account")).toBeTruthy())
    expect(
      (screen.getByRole("button", { name: "Register" }) as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(sent).toHaveLength(0)
  })

  it("shows the server's reason without losing what was typed", async () => {
    const { client } = recordingCommandClient(
      { "auth.dynamicConfig": activeConfig },
      { "auth.dynamicRegister": new ContractError("VALIDATION", "email already registered") },
    )
    renderPage(AuthDynamicClientsPage, client)
    await waitFor(() => expect(screen.getByText("Create your account")).toBeTruthy())

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "admin@example.com" },
    })
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "hunter2hunter2" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Register" }))

    await waitFor(() => expect(screen.getByText("email already registered")).toBeTruthy())
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("admin@example.com")
  })
})
