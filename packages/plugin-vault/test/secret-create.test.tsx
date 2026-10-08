import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import {
  ContractError,
  NavigationProvider,
  PluginProvider,
} from "@forge-go/dashboard-plugin"
import type { ScopedClient } from "@forge-go/dashboard-plugin"
import { SecretCreatePage } from "../src/pages/secret-create"
import { secretPath } from "../src/keys"
import { failingClient, recordingCommandClient } from "./harness"

const CANARY = "hunter2-canary"

const CREATED = {
  secret: {
    id: "sec_01",
    key: "db/primary.password",
    version: 1,
    encryptionAlg: "AES-256-GCM",
    appId: "app_1",
    createdAt: "2026-09-23T10:00:00Z",
    updatedAt: "2026-09-23T10:00:00Z",
  },
}

function renderCreate(client: ScopedClient) {
  const navigate = vi.fn()
  render(
    <PluginProvider client={client}>
      <NavigationProvider
        value={{
          Link: ({ to, children, className }) => (
            <a href={to} className={className}>
              {children}
            </a>
          ),
          navigate,
        }}
      >
        <SecretCreatePage params={{}} />
      </NavigationProvider>
    </PluginProvider>
  )
  return { navigate }
}

function fill(key: string, value: string, expires?: string) {
  fireEvent.change(screen.getByLabelText("Key"), { target: { value: key } })
  fireEvent.change(screen.getByLabelText("Value"), { target: { value } })
  if (expires !== undefined) {
    fireEvent.change(screen.getByLabelText(/Expires/), {
      target: { value: expires },
    })
  }
}

/**
 * The value must be absent from the markup on every path. React copies a
 * controlled input's value into its HTML `value` attribute, so the field is
 * uncontrolled: `.value` (the live property) can hold the secret for a retry,
 * but nothing that serialises the page can read it.
 */
function expectValueNotInMarkup() {
  expect(document.body.innerHTML).not.toContain(CANARY)
  expect(document.body.outerHTML).not.toContain(CANARY)
  expect(screen.getByLabelText("Value").hasAttribute("value")).toBe(false)
}

const submitButton = () =>
  screen.getByRole("button", { name: "Create secret" }) as HTMLButtonElement

describe("SecretCreatePage", () => {
  it("renders a password value input that is not autofilled or spellchecked", () => {
    const { client } = recordingCommandClient({}, { "secrets.create": CREATED })
    renderCreate(client)
    const value = screen.getByLabelText("Value") as HTMLInputElement
    expect(value.type).toBe("password")
    expect(value.getAttribute("autocomplete")).toBe("new-password")
    expect(value.getAttribute("spellcheck")).toBe("false")
    expect(
      (screen.getByLabelText("Key") as HTMLInputElement).className
    ).toMatch(/font-mono/)
  })

  it("says the value cannot be shown again", () => {
    const { client } = recordingCommandClient({}, { "secrets.create": CREATED })
    renderCreate(client)
    expect(screen.getByText(/cannot be shown again/)).toBeTruthy()
  })

  it("disables submit until key and value are both filled", () => {
    const { client } = recordingCommandClient({}, { "secrets.create": CREATED })
    renderCreate(client)
    expect(submitButton().disabled).toBe(true)
    fireEvent.change(screen.getByLabelText("Key"), { target: { value: "   " } })
    fireEvent.change(screen.getByLabelText("Value"), {
      target: { value: CANARY },
    })
    expect(submitButton().disabled).toBe(true)
    fireEvent.change(screen.getByLabelText("Key"), { target: { value: "k" } })
    expect(submitButton().disabled).toBe(false)
  })

  it("sends exactly key and value when no expiry is set", async () => {
    const { client, sent } = recordingCommandClient(
      {},
      { "secrets.create": CREATED }
    )
    renderCreate(client)
    fill("db/primary.password", CANARY)
    fireEvent.click(submitButton())
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]?.intent).toBe("secrets.create")
    expect(sent[0]?.payload).toEqual({
      key: "db/primary.password",
      value: CANARY,
    })
    expect(Object.keys(sent[0]?.payload as object).sort()).toEqual([
      "key",
      "value",
    ])
  })

  it("sends expiresAt as RFC3339 UTC when an expiry is set", async () => {
    const { client, sent } = recordingCommandClient(
      {},
      { "secrets.create": CREATED }
    )
    renderCreate(client)
    const local = "2099-01-02T03:04"
    fill("api-token", CANARY, local)
    fireEvent.click(submitButton())
    await waitFor(() => expect(sent).toHaveLength(1))
    const payload = sent[0]?.payload as Record<string, unknown>
    expect(Object.keys(payload).sort()).toEqual(["expiresAt", "key", "value"])
    expect(payload.expiresAt).toBe(new Date(local).toISOString())
    expect(String(payload.expiresAt)).toMatch(/Z$/)
  })

  it("navigates to the encoded detail path on success", async () => {
    const { client } = recordingCommandClient({}, { "secrets.create": CREATED })
    const { navigate } = renderCreate(client)
    fill("db/primary.password", CANARY)
    fireEvent.click(submitButton())
    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1))
    expect(navigate).toHaveBeenCalledWith(secretPath("db/primary.password"))
    expect(navigate).toHaveBeenCalledWith("/secrets/db%2Fprimary.password")
  })

  it("leaves the value nowhere in the document after a successful submit", async () => {
    const { client } = recordingCommandClient({}, { "secrets.create": CREATED })
    const { navigate } = renderCreate(client)
    fill("k", CANARY)
    fireEvent.click(submitButton())
    await waitFor(() => expect(navigate).toHaveBeenCalled())
    expect((screen.getByLabelText("Value") as HTMLInputElement).value).toBe("")
    expectValueNotInMarkup()
  })

  it("holds the value only in the password field while typing", () => {
    const { client } = recordingCommandClient({}, { "secrets.create": CREATED })
    renderCreate(client)
    fill("k", CANARY)
    // The live property holds it; the markup does not.
    expect((screen.getByLabelText("Value") as HTMLInputElement).value).toBe(
      CANARY
    )
    expectValueNotInMarkup()
  })

  it("keeps key, expiry and value and shows the alert when the client throws", async () => {
    const failing = failingClient(
      new ContractError("INTERNAL", "vault is unavailable")
    )
    const { navigate } = renderCreate(failing)
    const local = "2099-01-02T03:04"
    fill("db/primary.password", CANARY, local)
    fireEvent.click(submitButton())
    const alert = await screen.findByText("vault is unavailable")
    expect(alert.closest('[role="alert"]')).toBeTruthy()
    expect(navigate).not.toHaveBeenCalled()
    expect((screen.getByLabelText("Key") as HTMLInputElement).value).toBe(
      "db/primary.password"
    )
    expect((screen.getByLabelText(/Expires/) as HTMLInputElement).value).toBe(
      local
    )
    expect((screen.getByLabelText("Value") as HTMLInputElement).value).toBe(
      CANARY
    )
    expectValueNotInMarkup()
    // Retry is possible.
    expect(submitButton().disabled).toBe(false)
  })

  it("explains a CONFLICT and links to the existing secret", async () => {
    const failing = failingClient(
      new ContractError("CONFLICT", "secret already exists")
    )
    const { navigate } = renderCreate(failing)
    fill("db/primary.password", CANARY)
    fireEvent.click(submitButton())
    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toMatch(/already exists/)
    expect(alert.textContent).toContain("CONFLICT")
    const link = screen.getByRole("link", { name: "Open the existing secret" })
    expect(link.getAttribute("href")).toBe("/secrets/db%2Fprimary.password")
    expect(navigate).not.toHaveBeenCalled()
    expectValueNotInMarkup()
  })

  it("keeps the CONFLICT message and link on the submitted key when the key field is edited", async () => {
    const failing = failingClient(
      new ContractError("CONFLICT", "secret already exists")
    )
    renderCreate(failing)
    fill("db/primary.password", CANARY)
    fireEvent.click(submitButton())
    await screen.findByRole("alert")
    fireEvent.change(screen.getByLabelText("Key"), {
      target: { value: "db/typo" },
    })
    const link = screen.getByRole("link", { name: "Open the existing secret" })
    expect(link.getAttribute("href")).toBe(secretPath("db/primary.password"))
    const alert = screen.getByRole("alert")
    expect(alert.textContent).toContain('"db/primary.password"')
    expect(alert.textContent).not.toContain("db/typo")
  })

  it("does not offer the existing-secret link for other failures", async () => {
    const failing = failingClient(new ContractError("INTERNAL", "boom"))
    renderCreate(failing)
    fill("k", CANARY)
    fireEvent.click(submitButton())
    await screen.findByText("boom")
    expect(
      screen.queryByRole("link", { name: "Open the existing secret" })
    ).toBeNull()
  })

  it("blocks a past expiry with a message and sends nothing", async () => {
    const { client, sent } = recordingCommandClient(
      {},
      { "secrets.create": CREATED }
    )
    const { navigate } = renderCreate(client)
    fill("k", CANARY, "2001-01-01T00:00")
    expect(screen.getByText(/expiry is in the past/)).toBeTruthy()
    expect(submitButton().disabled).toBe(true)
    // Enter in a field submits the form even when the button is disabled.
    fireEvent.submit(submitButton().closest("form") as HTMLFormElement)
    await new Promise((r) => setTimeout(r, 20))
    expect(sent).toHaveLength(0)
    expect(navigate).not.toHaveBeenCalled()
  })

  it("never carries the value in a query", async () => {
    const queries: { intent: string; params?: unknown }[] = []
    const { client: inner } = recordingCommandClient(
      { "secrets.list": { secrets: [], total: 0 } },
      { "secrets.create": CREATED }
    )
    const client = {
      extension: "vault",
      query: (intent: string, params?: unknown) => {
        queries.push({ intent, params })
        return inner.query(intent, params as Record<string, unknown>)
      },
      command: inner.command,
    } as ScopedClient
    const { navigate } = renderCreate(client)
    fill("k", CANARY)
    fireEvent.click(submitButton())
    await waitFor(() => expect(navigate).toHaveBeenCalled())
    expect(JSON.stringify(queries)).not.toContain(CANARY)
  })
})
