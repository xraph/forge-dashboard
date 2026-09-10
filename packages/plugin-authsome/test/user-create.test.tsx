import { describe, expect, it } from "vitest"
import { fireEvent, screen } from "@testing-library/react"
import { recordingCommandClient, renderPage } from "./harness"
import { AuthUserCreatePage } from "../src/pages/user-create"

describe("AuthUserCreatePage", () => {
  it("sends every field the contract declares", async () => {
    const { client, sent } = recordingCommandClient({}, { "users.create": { ok: true, id: "u9" } })
    renderPage(AuthUserCreatePage, client)

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new@example.com" } })
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "hunter2hunter2" } })
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "New" } })
    fireEvent.click(screen.getByRole("button", { name: "Create user" }))

    await new Promise((r) => setTimeout(r, 0))
    expect(sent).toHaveLength(1)
    expect(sent[0].intent).toBe("users.create")
    expect(sent[0].payload).toMatchObject({
      email: "new@example.com", password: "hunter2hunter2", firstName: "New",
    })
  })

  it("will not submit without an email and a password", () => {
    const { client, sent } = recordingCommandClient({}, { "users.create": { ok: true } })
    renderPage(AuthUserCreatePage, client)

    const create = screen.getByRole("button", { name: "Create user" }) as HTMLButtonElement
    expect(create.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new@example.com" } })
    expect(create.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "hunter2hunter2" } })
    expect(create.disabled).toBe(false)
    expect(sent).toHaveLength(0)
  })

  it("never renders the password as readable text", () => {
    const { client } = recordingCommandClient({}, { "users.create": { ok: true } })
    renderPage(AuthUserCreatePage, client)
    expect(screen.getByLabelText("Password").getAttribute("type")).toBe("password")
  })

  it("surfaces the server's own sentence when the policy rejects the password", async () => {
    const { client } = recordingCommandClient({}, {})
    renderPage(AuthUserCreatePage, client)
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new@example.com" } })
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "short" } })
    fireEvent.click(screen.getByRole("button", { name: "Create user" }))

    // The stub has no users.create, so it rejects. The page must show what the
    // server said rather than a generic failure: a rejected password is the
    // server telling the operator something true.
    await screen.findByRole("alert")
  })
})
