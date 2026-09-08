import { describe, expect, it, vi } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { AuthGate } from "../src/gate"
import { renderPage, stubClient } from "./harness"

const config = { passwordEnabled: true, brand: "Platform" }

describe("AuthGate", () => {
  it("renders the provider's sign-in form", async () => {
    const { client } = stubClient({ "auth.config": config })
    renderPage(
      () => <AuthGate loginPath="/dashboard/login" onAuthenticated={() => {}} />,
      client,
    )
    expect(await screen.findByLabelText("Email")).toBeTruthy()
    expect(screen.getByLabelText("Password")).toBeTruthy()
  })

  // This is the screen every visitor meets before anything else in the
  // product, so it is the busiest sign-in surface there is. A password
  // manager that cannot recognise the fields makes every visit worse, and
  // no other assertion in this file would catch the attributes going
  // missing, so they get pinned directly.
  it("carries autocomplete hints a password manager can act on", async () => {
    const { client } = stubClient({ "auth.config": config })
    renderPage(
      () => <AuthGate loginPath="/dashboard/login" onAuthenticated={() => {}} />,
      client,
    )
    const emailField = await screen.findByLabelText("Email")
    const passwordField = screen.getByLabelText("Password")
    // No jest-dom matcher is wired into this package's vitest setup, so this
    // reads the DOM attributes directly rather than reaching for
    // toHaveAttribute.
    expect(emailField.getAttribute("autocomplete")).toBe("username")
    expect(emailField.getAttribute("name")).toBe("email")
    expect(passwordField.getAttribute("autocomplete")).toBe("current-password")
    expect(passwordField.getAttribute("name")).toBe("password")
  })

  it("reports a successful sign-in to the host instead of rendering a signed-in panel", async () => {
    const onAuthenticated = vi.fn()
    const { client } = stubClient(
      { "auth.config": config },
      { "auth.login": { ok: true, subject: "usr_1" } },
    )
    renderPage(
      () => <AuthGate loginPath="/dashboard/login" onAuthenticated={onAuthenticated} />,
      client,
    )

    fireEvent.change(await screen.findByLabelText("Email"), {
      target: { value: "ada@example.com" },
    })
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "hunter2" } })
    fireEvent.submit(screen.getByRole("button", { name: "Sign in" }))

    // A gate that succeeds stops existing. Rendering "signed in as ada" here
    // would leave the visitor staring at a confirmation with no way onward,
    // because the shell only appears once the host re-reads the session.
    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledTimes(1))
    expect(screen.queryByText(/signed in as/i)).toBeNull()
  })

  it("does not report anything when the login command fails", async () => {
    const onAuthenticated = vi.fn()
    const { client } = stubClient({ "auth.config": config })
    client.command = vi.fn(async () => {
      throw new Error("bad credentials")
    })
    renderPage(
      () => <AuthGate loginPath="/dashboard/login" onAuthenticated={onAuthenticated} />,
      client,
    )

    fireEvent.change(await screen.findByLabelText("Email"), {
      target: { value: "ada@example.com" },
    })
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrong" } })
    fireEvent.submit(screen.getByRole("button", { name: "Sign in" }))

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy())
    expect(onAuthenticated).not.toHaveBeenCalled()
  })

  it("renders the denied variant and no form when requiredRoles is present", async () => {
    const { client, intents } = stubClient({ "auth.config": config })
    renderPage(
      () => (
        <AuthGate
          loginPath="/dashboard/login"
          requiredRoles={["admin"]}
          onAuthenticated={() => {}}
        />
      ),
      client,
    )
    expect(await screen.findByText(/admin/)).toBeTruthy()
    expect(screen.queryByLabelText("Password")).toBeNull()
    // The denied screen never shows the form the config would fill in, so it
    // must not fire the read either. Reading anyway would be a request whose
    // answer is thrown away on every render of a screen that is often the
    // last thing a locked-out visitor sees.
    expect(intents).not.toContain("auth.config")
  })
})
