import { describe, expect, it } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import { renderPage, stubClient } from "./harness"
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
})

describe("what this page deliberately does not offer", () => {
  it("has no control that calls auth.dynamicRegister", async () => {
    const client = stubClient({
      "auth.dynamicConfig": {
        title: "Join", description: "", active: true,
        fields: [{ key: "email", label: "Email", type: "email", order: 1 }],
      },
    }).client
    renderPage(AuthDynamicClientsPage, client)
    await waitFor(() => expect(screen.getByText("Join")).toBeTruthy())

    // `auth.dynamicRegister` creates a real account and writes the new
    // account's session cookie over the caller's. An admin pressing a button
    // here would be signed out of their own session, signed in as an account
    // they had just made, and left with a junk user in production. An earlier
    // version of this page offered exactly that, labelled honestly, and
    // honest labelling is not enough.
    expect(screen.queryByRole("button", { name: /register/i })).toBeNull()
    expect(screen.queryByLabelText(/password/i)).toBeNull()
  })
})
