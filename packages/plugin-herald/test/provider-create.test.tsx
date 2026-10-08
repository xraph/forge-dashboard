import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { ProviderCreatePage } from "../src/pages/provider-create"
import { engine, providerSummary } from "./data"
import { expectNotInReactState } from "./canary"
import {
  invalidatingClient,
  renderWithNavigate,
  scriptedClient,
} from "./harness"

const CANARY = "sk_live_canary_herald"
const CREATED = {
  provider: providerSummary({ id: "hpvd_01j00000000000000000000100" }),
}

function expectCanaryNotInMarkup() {
  expect(document.body.innerHTML).not.toContain(CANARY)
  for (const input of document.querySelectorAll("input[type=password]"))
    expect(input.hasAttribute("value")).toBe(false)
  // The DOM check cannot see React state: walk every mounted component's props and hooks too.
  expectNotInReactState(document.body.firstElementChild as HTMLElement, CANARY)
}

function setup(
  onCreate: (input: Record<string, unknown>) => unknown = () => CREATED
) {
  const c = scriptedClient(
    { "engine.info": engine() },
    { "providers.create": onCreate }
  )
  const view = renderWithNavigate(ProviderCreatePage, c.client)
  return { ...c, ...view }
}

async function pickSmtp() {
  fireEvent.change(await screen.findByLabelText("Name"), {
    target: { value: "Ops SMTP" },
  })
  fireEvent.change(screen.getByLabelText("Channel"), {
    target: { value: "email" },
  })
  fireEvent.change(screen.getByLabelText("Driver"), {
    target: { value: "smtp" },
  })
}

describe("ProviderCreatePage", () => {
  it("offers only the channels a driver serves, and only that channel's drivers", async () => {
    setup()
    const channel = (await screen.findByLabelText(
      "Channel"
    )) as HTMLSelectElement
    const channels = [...channel.options].map((o) => o.value).filter(Boolean)
    expect(channels).toEqual(["email", "sms", "inapp"])
    fireEvent.change(channel, { target: { value: "sms" } })
    const drivers = [
      ...(screen.getByLabelText("Driver") as HTMLSelectElement).options,
    ]
      .map((o) => o.value)
      .filter(Boolean)
    expect(drivers).toEqual(["legacy-sms", "twilio"])
  })

  it("renders the schema, with the secret as an uncontrolled password field", async () => {
    setup()
    await pickSmtp()
    expect(screen.getByLabelText("Host")).toBeTruthy()
    expect(
      screen.getByText("Usually 587, or 465 with implicit TLS.")
    ).toBeTruthy()
    const password = screen.getByLabelText("Password") as HTMLInputElement
    expect(password.type).toBe("password")
    expect(password.getAttribute("autocomplete")).toBe("new-password")
    expect(password.getAttribute("spellcheck")).toBe("false")
    expect(password.hasAttribute("value")).toBe(false)
  })

  it("holds Create until the name and every required field are filled", async () => {
    const { sent } = setup()
    await pickSmtp()
    const button = screen.getByRole("button", {
      name: "Create provider",
    }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.submit(button.closest("form")!)
    fireEvent.change(screen.getByLabelText("Host"), {
      target: { value: "smtp.ops.test" },
    })
    fireEvent.change(screen.getByLabelText("Port"), {
      target: { value: "587" },
    })
    expect(button.disabled).toBe(false)
    expect(sent).toEqual([])
  })

  it("sends settings and credentials where the schema puts them, then clears the secret and opens the provider", async () => {
    const { sent, navigate, queried } = setup()
    await pickSmtp()
    fireEvent.change(screen.getByLabelText("Host"), {
      target: { value: "smtp.ops.test" },
    })
    fireEvent.change(screen.getByLabelText("Port"), {
      target: { value: "587" },
    })
    fireEvent.change(screen.getByLabelText("Username"), {
      target: { value: "ops" },
    })
    const password = screen.getByLabelText("Password") as HTMLInputElement
    fireEvent.change(password, { target: { value: CANARY } })
    expectCanaryNotInMarkup()
    fireEvent.click(screen.getByRole("button", { name: "Create provider" }))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toEqual({
      intent: "providers.create",
      payload: {
        name: "Ops SMTP",
        channel: "email",
        driver: "smtp",
        priority: 0,
        enabled: true,
        credentials: { password: CANARY, username: "ops" },
        settings: { host: "smtp.ops.test", port: "587" },
      },
    })
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith(
        "/providers/hpvd_01j00000000000000000000100"
      )
    )
    expect(password.value).toBe("")
    expectCanaryNotInMarkup()
    expect(JSON.stringify(queried)).not.toContain(CANARY)
  })

  it("keeps the secret in the field on failure, out of the markup and out of the error", async () => {
    setup(
      () =>
        new ContractError(
          "BAD_REQUEST",
          'herald: invalid provider: smtp: missing required credential "host"'
        )
    )
    await pickSmtp()
    fireEvent.change(screen.getByLabelText("Host"), {
      target: { value: "smtp.ops.test" },
    })
    fireEvent.change(screen.getByLabelText("Port"), {
      target: { value: "587" },
    })
    const password = screen.getByLabelText("Password") as HTMLInputElement
    fireEvent.change(password, { target: { value: CANARY } })
    fireEvent.click(screen.getByRole("button", { name: "Create provider" }))
    expect((await screen.findByRole("alert")).textContent).toContain(
      "missing required credential"
    )
    expect(password.value).toBe(CANARY)
    expectCanaryNotInMarkup()
  })

  it("falls back to key/value rows for a driver with no schema, secrets to credentials and the rest to settings", async () => {
    const { sent } = setup()
    fireEvent.change(await screen.findByLabelText("Name"), {
      target: { value: "Gateway" },
    })
    fireEvent.change(screen.getByLabelText("Channel"), {
      target: { value: "sms" },
    })
    fireEvent.change(screen.getByLabelText("Driver"), {
      target: { value: "legacy-sms" },
    })
    expect(screen.getByText(/no field schema/)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Add a field" }))
    fireEvent.click(screen.getByRole("button", { name: "Add a field" }))
    const keys = screen.getAllByLabelText(/^Key, field/)
    fireEvent.change(keys[0], { target: { value: "gateway" } })
    fireEvent.change(screen.getAllByLabelText(/^Value, field/)[0], {
      target: { value: "https://sms.test" },
    })
    fireEvent.change(keys[1], { target: { value: "token" } })
    fireEvent.click(
      screen.getAllByRole("checkbox", { name: /^Secret, field/ })[1]
    )
    const secret = screen.getAllByLabelText(
      /^Value, field/
    )[1] as HTMLInputElement
    expect(secret.type).toBe("password")
    fireEvent.change(secret, { target: { value: CANARY } })
    fireEvent.click(screen.getByRole("button", { name: "Create provider" }))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect((sent[0]?.payload as Record<string, unknown>).credentials).toEqual({
      token: CANARY,
    })
    expect((sent[0]?.payload as Record<string, unknown>).settings).toEqual({
      gateway: "https://sms.test",
    })
    expectCanaryNotInMarkup()
  })

  it("sends disabled explicitly when unticked, since the server reads a missing enabled as false", async () => {
    const { sent } = setup()
    fireEvent.change(await screen.findByLabelText("Name"), {
      target: { value: "Inbox" },
    })
    fireEvent.change(screen.getByLabelText("Channel"), {
      target: { value: "inapp" },
    })
    fireEvent.change(screen.getByLabelText("Driver"), {
      target: { value: "inapp" },
    })
    fireEvent.click(screen.getByRole("switch", { name: "Enabled" }))
    fireEvent.click(screen.getByRole("button", { name: "Create provider" }))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]?.payload).toEqual({
      name: "Inbox",
      channel: "inapp",
      driver: "inapp",
      priority: 0,
      enabled: false,
    })
  })

  it("keeps the secret when the server answers CONFLICT, and shows the server's own words", async () => {
    const { sent } = setup(
      () =>
        new ContractError(
          "CONFLICT",
          'herald: a provider named "Ops SMTP" already exists'
        )
    )
    await pickSmtp()
    fireEvent.change(screen.getByLabelText("Host"), {
      target: { value: "smtp.ops.test" },
    })
    fireEvent.change(screen.getByLabelText("Port"), {
      target: { value: "587" },
    })
    const password = screen.getByLabelText("Password") as HTMLInputElement
    fireEvent.change(password, { target: { value: CANARY } })
    fireEvent.click(screen.getByRole("button", { name: "Create provider" }))
    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toContain("CONFLICT")
    expect(alert.textContent).toContain("already exists")
    expect(password.value).toBe(CANARY)
    expectCanaryNotInMarkup()
    // A retry sends the same secret again, untouched.
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "Create provider",
          }) as HTMLButtonElement
        ).disabled
      ).toBe(false)
    )
    fireEvent.click(screen.getByRole("button", { name: "Create provider" }))
    await waitFor(() => expect(sent).toHaveLength(2))
    expect(
      (sent[1]?.payload as { credentials: Record<string, string> }).credentials
        .password
    ).toBe(CANARY)
  })

  it("clears a typed secret when the driver changes, so it cannot ride along to another driver", async () => {
    const { sent } = setup()
    await pickSmtp()
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: CANARY },
    })
    fireEvent.change(screen.getByLabelText("Driver"), {
      target: { value: "resend" },
    })
    expect((screen.getByLabelText(/API key/) as HTMLInputElement).value).toBe(
      ""
    )
    expect(
      (
        screen.getByRole("button", {
          name: "Create provider",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true)
    expect(sent).toEqual([])
    expectCanaryNotInMarkup()
  })

  it("survives the create's own invalidations and opens the provider once the answer lands", async () => {
    const { client, sent } = invalidatingClient(
      { "engine.info": engine() },
      {
        "providers.create": {
          answer: CREATED,
          invalidates: [
            "providers.list",
            "providers.detail",
            "overview.stats",
            "send.resolve",
            "scopes.list",
          ],
        },
      }
    )
    const { navigate } = renderWithNavigate(ProviderCreatePage, client)
    await pickSmtp()
    fireEvent.change(screen.getByLabelText("Host"), {
      target: { value: "smtp.ops.test" },
    })
    fireEvent.change(screen.getByLabelText("Port"), {
      target: { value: "587" },
    })
    const password = screen.getByLabelText("Password") as HTMLInputElement
    fireEvent.change(password, { target: { value: CANARY } })
    fireEvent.click(screen.getByRole("button", { name: "Create provider" }))
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith(
        "/providers/hpvd_01j00000000000000000000100"
      )
    )
    expect(sent).toHaveLength(1)
    expect(password.value).toBe("")
    expectCanaryNotInMarkup()
  })

  it("names the app in the header while the drivers load", async () => {
    setup()
    expect(
      screen.getByRole("heading", { level: 1, name: "New provider" })
    ).toBeTruthy()
    expect(await screen.findByText("app_demo")).toBeTruthy()
  })
})
