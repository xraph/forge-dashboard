import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import type { ContractEnvelopeRequest } from "@forge-go/dashboard-plugin"
import { AuthLoginPage } from "../src/pages/login"
import type { AuthConfig } from "../src/pages/login"
import {
  contractHarness,
  failingClient,
  pendingClient,
  renderPage,
  stubClient,
} from "./harness"

const CONFIG: AuthConfig = {
  passwordEnabled: true,
  brand: "Forge Fixture",
  signupURL: "/signup",
  signupLabel: "Create an account",
  termsURL: "/terms",
  privacyURL: "/privacy",
  socialProviders: [
    {
      id: "google",
      label: "Continue with Google",
      authStartURL: "/auth/oauth/google/start",
    },
  ],
}

/** Fills the form and submits it, the way a person would. */
async function signIn(email = "ada@example.com", password = "hunter2") {
  fireEvent.change(await screen.findByLabelText("Email"), {
    target: { value: email },
  })
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: password },
  })
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }))
}

describe("AuthLoginPage", () => {
  it("shapes the form from auth.config rather than hardcoding it", async () => {
    const { client } = stubClient({ "auth.config": CONFIG })
    renderPage(AuthLoginPage, client)

    expect(await screen.findByLabelText("Email")).toBeDefined()
    expect(screen.getByLabelText("Password")).toBeDefined()
    expect(screen.getByText("Continue with Google")).toBeDefined()
    expect(screen.getByText("Create an account")).toBeDefined()
    expect(screen.getByText("Terms")).toBeDefined()
  })

  it("offers no password box when the deployment has password login off", async () => {
    const { client } = stubClient({
      "auth.config": {
        passwordEnabled: false,
        socialProviders: CONFIG.socialProviders,
      } satisfies AuthConfig,
    })
    renderPage(AuthLoginPage, client)

    expect(await screen.findByText("Continue with Google")).toBeDefined()
    expect(screen.queryByLabelText("Password")).toBeNull()
    expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull()
  })

  it("says it is loading rather than rendering a blank pane", () => {
    renderPage(AuthLoginPage, pendingClient())

    const busy = screen.getByRole("status")
    expect(busy.getAttribute("aria-busy")).toBe("true")
    expect(busy.getAttribute("aria-label")).toBe("Loading Sign-in options")
  })

  it("shows the contract error instead of guessing at a form when the config read fails", async () => {
    renderPage(
      AuthLoginPage,
      failingClient(new ContractError("TRANSPORT", "contract unreachable"))
    )

    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toContain("TRANSPORT")
    expect(alert.textContent).toContain("contract unreachable")
    expect(screen.queryByLabelText("Email")).toBeNull()
  })

  /**
   * The assertion this whole package exists to make.
   *
   * A real `createScopedClient` sits behind the page, so what is checked here
   * is the envelope that left the transport: the CSRF token the client fetched
   * for itself, and the idempotency key it minted. Neither value is typed
   * anywhere in `src/`, and that is the design - a key minted in a page is a
   * fresh key on every retry, which is the bug the handshake prevents.
   */
  it("sends the login command carrying both csrf and idempotencyKey", async () => {
    const harness = contractHarness((req) => {
      if (req.intent === "auth.config") return { data: CONFIG }
      if (req.intent === "auth.login") {
        return { data: { ok: true, subject: "usr_1" } }
      }
      return { error: { code: "NOT_FOUND", message: `no ${req.intent}` } }
    })

    renderPage(AuthLoginPage, harness.client)
    await signIn()
    expect(await screen.findByText("usr_1")).toBeDefined()

    const login = harness.requests.filter((r) => r.intent === "auth.login")
    expect(login).toHaveLength(1)
    expect(login[0].kind).toBe("command")
    expect(login[0].contributor).toBe("auth")
    expect(login[0].csrf).toBe("csrf-token-fixture")
    expect(typeof login[0].idempotencyKey).toBe("string")
    expect((login[0].idempotencyKey ?? "").length).toBeGreaterThan(0)
    expect(login[0].payload).toEqual({
      email: "ada@example.com",
      password: "hunter2",
    })

    // The token is fetched once for the life of the client, not per command.
    expect(harness.csrfFetches).toBe(1)
  })

  it("sends neither field on the auth.config query", async () => {
    const harness = contractHarness((req) =>
      req.intent === "auth.config"
        ? { data: CONFIG }
        : { error: { code: "NOT_FOUND", message: `no ${req.intent}` } }
    )

    renderPage(AuthLoginPage, harness.client)
    await screen.findByLabelText("Email")

    const config = harness.requests.find(
      (r: ContractEnvelopeRequest) => r.intent === "auth.config"
    )
    expect(config?.kind).toBe("query")
    expect(config?.csrf).toBeUndefined()
    expect(config?.idempotencyKey).toBeUndefined()
    expect(harness.csrfFetches).toBe(0)
  })

  it("renders wrong credentials as a message, and does not throw", async () => {
    const harness = contractHarness((req) => {
      if (req.intent === "auth.config") return { data: CONFIG }
      return {
        error: {
          code: "UNAUTHENTICATED",
          message: "invalid email or password",
        },
      }
    })

    renderPage(AuthLoginPage, harness.client)
    await signIn("nobody@example.com", "wrong")

    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toContain("invalid email or password")
    expect(alert.textContent).toContain("Sign in failed")

    // Still on the form, and the failure was not retried. A contract-level
    // rejection arrives as an `ok: false` envelope over HTTP 200, so the
    // client's stale-token retry must not fire on it.
    expect(screen.getByLabelText("Email")).toBeDefined()
    expect(
      harness.requests.filter((r) => r.intent === "auth.login")
    ).toHaveLength(1)
  })

  it("mints a fresh idempotency key for each attempt the operator makes", async () => {
    // Not the client's automatic retry - a person clicking Sign in twice. Each
    // click is its own logical command and must carry its own key, or the
    // server would replay the first failure's response for the second attempt.
    const harness = contractHarness((req) => {
      if (req.intent === "auth.config") return { data: CONFIG }
      if (
        req.payload &&
        (req.payload as { password?: string }).password === "hunter2"
      ) {
        return { data: { ok: true, subject: "usr_1" } }
      }
      return {
        error: {
          code: "UNAUTHENTICATED",
          message: "invalid email or password",
        },
      }
    })

    renderPage(AuthLoginPage, harness.client)
    await signIn("ada@example.com", "wrong")
    await screen.findByRole("alert")
    await signIn("ada@example.com", "hunter2")
    expect(await screen.findByText("usr_1")).toBeDefined()

    const keys = harness.requests
      .filter((r) => r.intent === "auth.login")
      .map((r) => r.idempotencyKey)
    expect(keys).toHaveLength(2)
    expect(keys[0]).not.toBe(keys[1])
    expect(new Set(keys).size).toBe(2)
  })

  it("signs out through auth.logout and returns to the form", async () => {
    const { client, intents } = stubClient(
      { "auth.config": CONFIG },
      {
        "auth.login": { ok: true, subject: "usr_1" },
        "auth.logout": { ok: true },
      }
    )

    renderPage(AuthLoginPage, client)
    await signIn()
    expect(await screen.findByText("usr_1")).toBeDefined()

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }))

    await waitFor(() => expect(screen.getByLabelText("Email")).toBeDefined())
    // No second "auth.config": LoginForm stays mounted across sign-in and
    // sign-out, so the page's one read is not reissued by a state change.
    expect(intents).toEqual(["auth.config", "auth.login", "auth.logout"])
  })

  it("stays signed in when the sign-out command fails", async () => {
    const { client } = stubClient(
      { "auth.config": CONFIG },
      {
        "auth.login": { ok: true, subject: "usr_1" },
        "auth.logout": new ContractError("TRANSPORT", "contract unreachable"),
      }
    )

    renderPage(AuthLoginPage, client)
    await signIn()
    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }))

    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toContain("Sign out failed")
    expect(screen.getByText("usr_1")).toBeDefined()
  })
})
