import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import {
  ContractError,
  NavigationProvider,
  PluginProvider,
} from "@forge-go/dashboard-plugin"
import type { ScopedClient } from "@forge-go/dashboard-plugin"
import { ConfigCreatePage } from "../src/pages/config-create"
import { configPath } from "../src/keys"
import { failingClient, recordingCommandClient } from "./harness"

/**
 * jsdom 25 has no PointerEvent, and Base UI's toggle dispatches through it. A
 * MouseEvent subclass is what a click is.
 */
if (typeof window.PointerEvent === "undefined") {
  class PointerEventShim extends MouseEvent {}
  Object.defineProperty(window, "PointerEvent", { value: PointerEventShim })
}

const CREATED = {
  entry: {
    id: "cfg_01",
    key: "http/timeout",
    value: "90s",
    valueType: "duration",
    knownType: true,
    valueMatchesType: true,
    version: 1,
    description: "",
    metadata: {},
    createdAt: "2026-09-29T10:00:00Z",
    updatedAt: "2026-09-29T10:00:00Z",
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
        <ConfigCreatePage params={{}} />
      </NavigationProvider>
    </PluginProvider>,
  )
  return { navigate }
}

const submit = () =>
  screen.getByRole("button", { name: "Create entry" }) as HTMLButtonElement
const setKey = (v: string) =>
  fireEvent.change(screen.getByLabelText("Key"), { target: { value: v } })
const setType = (v: string) =>
  fireEvent.change(screen.getByLabelText("Type"), { target: { value: v } })
const chooseBool = (v: "true" | "false") =>
  fireEvent.click(screen.getByRole("button", { name: v }))
const valueBox = () => screen.getByLabelText("Value") as HTMLInputElement

function ready() {
  return recordingCommandClient({}, { "config.create": CREATED })
}

describe("ConfigCreatePage", () => {
  it("starts as a string entry with nothing to submit until there is a key", () => {
    const { client } = ready()
    renderCreate(client)
    expect((screen.getByLabelText("Type") as HTMLSelectElement).value).toBe("string")
    expect(submit().disabled).toBe(true)
    setKey("k")
    // A string starts as "", which is a value.
    expect(submit().disabled).toBe(false)
  })

  it("offers the six types", () => {
    const { client } = ready()
    renderCreate(client)
    const select = screen.getByLabelText("Type") as HTMLSelectElement
    expect(Array.from(select.options).map((o) => o.value)).toEqual([
      "string",
      "int",
      "float",
      "bool",
      "json",
      "duration",
    ])
  })

  it("disables submit until a key and a valid value both exist", () => {
    const { client } = ready()
    renderCreate(client)
    setKey("   ")
    expect(submit().disabled).toBe(true)
    setKey("k")
    setType("bool")
    expect(submit().disabled).toBe(true)
    chooseBool("true")
    expect(submit().disabled).toBe(false)
    setType("json")
    expect(submit().disabled).toBe(true)
    fireEvent.change(valueBox(), { target: { value: "{oops" } })
    expect(submit().disabled).toBe(true)
    fireEvent.change(valueBox(), { target: { value: "{}" } })
    expect(submit().disabled).toBe(false)
    setType("duration")
    expect(submit().disabled).toBe(true)
    fireEvent.change(valueBox(), { target: { value: "soon" } })
    expect(submit().disabled).toBe(true)
    fireEvent.change(valueBox(), { target: { value: "1h30m" } })
    expect(submit().disabled).toBe(false)
  })

  it("sends a string as a string, with valueType and exact field names", async () => {
    const { client, sent } = ready()
    renderCreate(client)
    setKey("  banner ")
    fireEvent.change(valueBox(), { target: { value: "true" } })
    fireEvent.click(submit())
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]?.intent).toBe("config.create")
    const payload = sent[0]?.payload as Record<string, unknown>
    expect(payload).toEqual({ key: "banner", valueType: "string", value: "true" })
    expect(Object.keys(payload).sort()).toEqual(["key", "value", "valueType"])
  })

  it("sends an empty string as \"\", not omitted", async () => {
    const { client, sent } = ready()
    renderCreate(client)
    setKey("banner")
    expect(valueBox().value).toBe("")
    fireEvent.click(submit())
    await waitFor(() => expect(sent).toHaveLength(1))
    const payload = sent[0]?.payload as Record<string, unknown>
    expect("value" in payload).toBe(true)
    expect(payload.value).toBe("")
  })

  it("sends an int as a number, and a trimmed description", async () => {
    const { client, sent } = ready()
    renderCreate(client)
    setKey("max-items")
    setType("int")
    fireEvent.change(valueBox(), { target: { value: "25" } })
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: " Cap on the list " },
    })
    fireEvent.click(submit())
    await waitFor(() => expect(sent).toHaveLength(1))
    const payload = sent[0]?.payload as Record<string, unknown>
    expect(payload).toEqual({
      key: "max-items",
      valueType: "int",
      value: 25,
      description: "Cap on the list",
    })
    expect(typeof payload.value).toBe("number")
  })

  it("sends a float as a number", async () => {
    const { client, sent } = ready()
    renderCreate(client)
    setKey("ratio")
    setType("float")
    fireEvent.change(valueBox(), { target: { value: "0.25" } })
    fireEvent.click(submit())
    await waitFor(() => expect(sent).toHaveLength(1))
    expect((sent[0]?.payload as Record<string, unknown>).value).toBe(0.25)
  })

  it("sends a bool as a boolean, false included", async () => {
    const { client, sent } = ready()
    renderCreate(client)
    setKey("k")
    setType("bool")
    chooseBool("false")
    fireEvent.click(submit())
    await waitFor(() => expect(sent).toHaveLength(1))
    const payload = sent[0]?.payload as Record<string, unknown>
    expect(payload).toEqual({ key: "k", valueType: "bool", value: false })
    expect(typeof payload.value).toBe("boolean")
  })

  it("sends json parsed, including null", async () => {
    const { client, sent } = ready()
    renderCreate(client)
    setKey("k")
    setType("json")
    fireEvent.change(valueBox(), { target: { value: '{"a": [1, 2]}' } })
    fireEvent.click(submit())
    await waitFor(() => expect(sent).toHaveLength(1))
    expect((sent[0]?.payload as Record<string, unknown>).value).toEqual({ a: [1, 2] })
  })

  it("sends json null as null, present", async () => {
    const { client, sent } = ready()
    renderCreate(client)
    setKey("k")
    setType("json")
    fireEvent.change(valueBox(), { target: { value: "null" } })
    fireEvent.click(submit())
    await waitFor(() => expect(sent).toHaveLength(1))
    const payload = sent[0]?.payload as Record<string, unknown>
    expect("value" in payload).toBe(true)
    expect(payload.value).toBeNull()
  })

  it("uses a plain mono textarea for json", () => {
    const { client } = ready()
    renderCreate(client)
    setType("json")
    expect(valueBox().tagName).toBe("TEXTAREA")
    expect(valueBox().className).toMatch(/font-mono/)
  })

  it("sends a duration as its string", async () => {
    const { client, sent } = ready()
    renderCreate(client)
    setKey("http/timeout")
    setType("duration")
    fireEvent.change(valueBox(), { target: { value: "90s" } })
    fireEvent.click(submit())
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]?.payload).toEqual({
      key: "http/timeout",
      valueType: "duration",
      value: "90s",
    })
  })

  it("clears the value when the type changes", () => {
    const { client } = ready()
    renderCreate(client)
    setKey("k")
    fireEvent.change(valueBox(), { target: { value: "hello" } })
    setType("int")
    expect(valueBox().value).toBe("")
    expect(submit().disabled).toBe(true)
  })

  it("navigates to the encoded entry path on success", async () => {
    const { client } = ready()
    const { navigate } = renderCreate(client)
    setKey("http/timeout")
    fireEvent.click(submit())
    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1))
    expect(navigate).toHaveBeenCalledWith(configPath("http/timeout"))
    expect(navigate).toHaveBeenCalledWith("/config/http%2Ftimeout")
  })

  it("keeps the form and shows the server's message when the client throws", async () => {
    const { navigate } = renderCreate(
      failingClient(
        new ContractError("BAD_REQUEST", "config: value: expected an integer"),
      ),
    )
    setKey("k")
    setType("int")
    fireEvent.change(valueBox(), { target: { value: "5" } })
    fireEvent.click(submit())
    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toContain("config: value: expected an integer")
    expect(navigate).not.toHaveBeenCalled()
    expect((screen.getByLabelText("Key") as HTMLInputElement).value).toBe("k")
    expect(valueBox().value).toBe("5")
    expect(submit().disabled).toBe(false)
    expect(screen.queryByRole("link", { name: "Open the existing entry" })).toBeNull()
  })

  it("explains a CONFLICT and links to the existing entry", async () => {
    const { navigate } = renderCreate(
      failingClient(
        new ContractError(
          "CONFLICT",
          "a config entry with this key already exists",
        ),
      ),
    )
    setKey("http/timeout")
    fireEvent.click(submit())
    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toContain(
      'A config entry with the key "http/timeout" already exists.',
    )
    expect(alert.textContent).toContain("CONFLICT")
    const link = screen.getByRole("link", { name: "Open the existing entry" })
    expect(link.getAttribute("href")).toBe("/config/http%2Ftimeout")
    expect(navigate).not.toHaveBeenCalled()
  })

  it("keeps the CONFLICT message and link on the submitted key after the field is edited", async () => {
    renderCreate(
      failingClient(
        new ContractError(
          "CONFLICT",
          "a config entry with this key already exists",
        ),
      ),
    )
    setKey("http/timeout")
    fireEvent.click(submit())
    await screen.findByRole("alert")
    setKey("http/typo")
    const link = screen.getByRole("link", { name: "Open the existing entry" })
    expect(link.getAttribute("href")).toBe(configPath("http/timeout"))
    const alert = screen.getByRole("alert")
    expect(alert.textContent).toContain('"http/timeout"')
    expect(alert.textContent).not.toContain("http/typo")
  })

  it("sends nothing when the form is submitted with the button disabled", async () => {
    const { client, sent } = ready()
    const { navigate } = renderCreate(client)
    // No key. Enter in a field submits the form regardless.
    fireEvent.submit(submit().closest("form") as HTMLFormElement)
    await new Promise((r) => setTimeout(r, 20))
    expect(sent).toHaveLength(0)
    expect(navigate).not.toHaveBeenCalled()
  })

  it("has a Cancel link back to the list", () => {
    const { client } = ready()
    renderCreate(client)
    expect(screen.getByRole("link", { name: "Cancel" }).getAttribute("href")).toBe(
      "/config",
    )
  })
})
