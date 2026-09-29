import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import {
  ContractError,
  NavigationProvider,
  PluginProvider,
} from "@forge-go/dashboard-plugin"
import type { ScopedClient } from "@forge-go/dashboard-plugin"
import { FlagCreatePage } from "../src/pages/flag-create"
import { flagPath } from "../src/keys"
import { failingClient, recordingCommandClient } from "./harness"

/**
 * jsdom 25 has no PointerEvent, and Base UI's checkbox and toggle dispatch
 * through it. A MouseEvent subclass is what a click is.
 */
if (typeof window.PointerEvent === "undefined") {
  class PointerEventShim extends MouseEvent {}
  Object.defineProperty(window, "PointerEvent", { value: PointerEventShim })
}

const CREATED = {
  flag: {
    id: "flg_01",
    key: "checkout/new-flow",
    type: "bool",
    defaultValue: true,
    defaultMatchesType: true,
    description: "",
    tags: [],
    enabled: true,
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
        <FlagCreatePage params={{}} />
      </NavigationProvider>
    </PluginProvider>,
  )
  return { navigate }
}

const submit = () =>
  screen.getByRole("button", { name: "Create flag" }) as HTMLButtonElement
const setKey = (v: string) =>
  fireEvent.change(screen.getByLabelText("Key"), { target: { value: v } })
const setType = (v: string) =>
  fireEvent.change(screen.getByLabelText("Type"), { target: { value: v } })
const chooseBool = (v: "true" | "false") =>
  fireEvent.click(screen.getByRole("button", { name: v }))
const defaultBox = () => screen.getByLabelText("Default") as HTMLInputElement

describe("FlagCreatePage", () => {
  it("starts as a bool flag, enabled, with nothing to submit", () => {
    const { client } = recordingCommandClient({}, { "flags.create": CREATED })
    renderCreate(client)
    expect((screen.getByLabelText("Type") as HTMLSelectElement).value).toBe("bool")
    expect(screen.getByRole("checkbox", { name: "Enabled" }).getAttribute("aria-checked")).toBe(
      "true",
    )
    expect(submit().disabled).toBe(true)
  })

  it("offers the five types", () => {
    const { client } = recordingCommandClient({}, { "flags.create": CREATED })
    renderCreate(client)
    const select = screen.getByLabelText("Type") as HTMLSelectElement
    expect(Array.from(select.options).map((o) => o.value)).toEqual([
      "bool",
      "string",
      "int",
      "float",
      "json",
    ])
  })

  it("disables submit until a key and a valid default both exist", () => {
    const { client } = recordingCommandClient({}, { "flags.create": CREATED })
    renderCreate(client)
    setKey("   ")
    chooseBool("true")
    expect(submit().disabled).toBe(true)
    setKey("k")
    expect(submit().disabled).toBe(false)
    setType("json")
    expect(submit().disabled).toBe(true)
    fireEvent.change(defaultBox(), { target: { value: "{oops" } })
    expect(submit().disabled).toBe(true)
    fireEvent.change(defaultBox(), { target: { value: "{}" } })
    expect(submit().disabled).toBe(false)
  })

  it("sends a real boolean default and exact field names", async () => {
    const { client, sent } = recordingCommandClient({}, { "flags.create": CREATED })
    renderCreate(client)
    setKey("checkout/new-flow")
    chooseBool("true")
    fireEvent.click(submit())
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]?.intent).toBe("flags.create")
    const payload = sent[0]?.payload as Record<string, unknown>
    expect(payload).toEqual({
      key: "checkout/new-flow",
      type: "bool",
      defaultValue: true,
      enabled: true,
    })
    expect(typeof payload.defaultValue).toBe("boolean")
    expect(Object.keys(payload).sort()).toEqual(["defaultValue", "enabled", "key", "type"])
  })

  it("sends false as false, not as an absent default", async () => {
    const { client, sent } = recordingCommandClient({}, { "flags.create": CREATED })
    renderCreate(client)
    setKey("k")
    chooseBool("false")
    fireEvent.click(submit())
    await waitFor(() => expect(sent).toHaveLength(1))
    expect((sent[0]?.payload as Record<string, unknown>).defaultValue).toBe(false)
  })

  it("sends an int default as a number, description, trimmed tags and enabled off", async () => {
    const { client, sent } = recordingCommandClient({}, { "flags.create": CREATED })
    renderCreate(client)
    setKey("  max-items ")
    setType("int")
    fireEvent.change(defaultBox(), { target: { value: "25" } })
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: " Cap on the list " },
    })
    fireEvent.change(screen.getByLabelText("Tags"), {
      target: { value: " a, b ,, ,c " },
    })
    fireEvent.click(screen.getByRole("checkbox", { name: "Enabled" }))
    fireEvent.click(submit())
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]?.payload).toEqual({
      key: "max-items",
      type: "int",
      defaultValue: 25,
      description: "Cap on the list",
      tags: ["a", "b", "c"],
      enabled: false,
    })
  })

  it("sends a string default that looks like a boolean as a string", async () => {
    const { client, sent } = recordingCommandClient({}, { "flags.create": CREATED })
    renderCreate(client)
    setKey("k")
    setType("string")
    fireEvent.change(defaultBox(), { target: { value: "true" } })
    fireEvent.click(submit())
    await waitFor(() => expect(sent).toHaveLength(1))
    expect((sent[0]?.payload as Record<string, unknown>).defaultValue).toBe("true")
  })

  it("sends parsed JSON, including null", async () => {
    const { client, sent } = recordingCommandClient({}, { "flags.create": CREATED })
    renderCreate(client)
    setKey("k")
    setType("json")
    fireEvent.change(defaultBox(), { target: { value: "null" } })
    expect(submit().disabled).toBe(false)
    fireEvent.click(submit())
    await waitFor(() => expect(sent).toHaveLength(1))
    const payload = sent[0]?.payload as Record<string, unknown>
    expect("defaultValue" in payload).toBe(true)
    expect(payload.defaultValue).toBeNull()
  })

  it("clears the default when the type changes", () => {
    const { client } = recordingCommandClient({}, { "flags.create": CREATED })
    renderCreate(client)
    setKey("k")
    setType("string")
    fireEvent.change(defaultBox(), { target: { value: "hello" } })
    expect(submit().disabled).toBe(false)
    setType("int")
    expect(defaultBox().value).toBe("")
    expect(submit().disabled).toBe(true)
    setType("bool")
    expect(submit().disabled).toBe(true)
  })

  it("navigates to the encoded flag path on success", async () => {
    const { client } = recordingCommandClient({}, { "flags.create": CREATED })
    const { navigate } = renderCreate(client)
    setKey("checkout/new-flow")
    chooseBool("true")
    fireEvent.click(submit())
    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1))
    expect(navigate).toHaveBeenCalledWith(flagPath("checkout/new-flow"))
    expect(navigate).toHaveBeenCalledWith("/flags/checkout%2Fnew-flow")
  })

  it("keeps the form and shows the server's message when the client throws", async () => {
    const { navigate } = renderCreate(
      failingClient(
        new ContractError("BAD_REQUEST", "flag: defaultValue: expected an integer"),
      ),
    )
    setKey("k")
    setType("int")
    fireEvent.change(defaultBox(), { target: { value: "5" } })
    fireEvent.click(submit())
    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toContain("flag: defaultValue: expected an integer")
    expect(navigate).not.toHaveBeenCalled()
    expect((screen.getByLabelText("Key") as HTMLInputElement).value).toBe("k")
    expect(defaultBox().value).toBe("5")
    expect(submit().disabled).toBe(false)
    expect(screen.queryByRole("link", { name: "Open the existing flag" })).toBeNull()
  })

  it("explains a CONFLICT and links to the existing flag", async () => {
    const { navigate } = renderCreate(
      failingClient(
        new ContractError("CONFLICT", "a flag with this key already exists"),
      ),
    )
    setKey("checkout/new-flow")
    chooseBool("true")
    fireEvent.click(submit())
    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toContain(
      'A flag with the key "checkout/new-flow" already exists.',
    )
    expect(alert.textContent).toContain("CONFLICT")
    const link = screen.getByRole("link", { name: "Open the existing flag" })
    expect(link.getAttribute("href")).toBe("/flags/checkout%2Fnew-flow")
    expect(navigate).not.toHaveBeenCalled()
  })

  it("keeps the CONFLICT message and link on the submitted key after the field is edited", async () => {
    renderCreate(
      failingClient(
        new ContractError("CONFLICT", "a flag with this key already exists"),
      ),
    )
    setKey("checkout/new-flow")
    chooseBool("true")
    fireEvent.click(submit())
    await screen.findByRole("alert")
    setKey("checkout/typo")
    const link = screen.getByRole("link", { name: "Open the existing flag" })
    expect(link.getAttribute("href")).toBe(flagPath("checkout/new-flow"))
    const alert = screen.getByRole("alert")
    expect(alert.textContent).toContain('"checkout/new-flow"')
    expect(alert.textContent).not.toContain("checkout/typo")
  })

  it("sends nothing when the form is submitted with the button disabled", async () => {
    const { client, sent } = recordingCommandClient({}, { "flags.create": CREATED })
    const { navigate } = renderCreate(client)
    setKey("k")
    // No default chosen. Enter in a field submits the form regardless.
    fireEvent.submit(submit().closest("form") as HTMLFormElement)
    await new Promise((r) => setTimeout(r, 20))
    expect(sent).toHaveLength(0)
    expect(navigate).not.toHaveBeenCalled()
  })

  it("has a Cancel link back to the list", () => {
    const { client } = recordingCommandClient({}, { "flags.create": CREATED })
    renderCreate(client)
    expect(screen.getByRole("link", { name: "Cancel" }).getAttribute("href")).toBe("/flags")
  })
})
