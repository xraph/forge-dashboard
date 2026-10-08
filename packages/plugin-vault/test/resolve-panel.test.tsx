import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { ResolvePanel } from "../src/components/resolve-panel"
import { recordingQueryClient, renderPage } from "./harness"

const KEY = "app/greeting"

function resolved(over: Record<string, unknown> = {}) {
  return {
    value: "hello",
    valueMatchesType: true,
    source: "appDefault",
    appValue: "hello",
    ...over,
  }
}

function setup(
  answer: Record<string, unknown> | ContractError,
  valueType = "string"
) {
  const { client, sent } = recordingQueryClient({})
  const inner = client.query
  client.query = (async (intent: string, params?: Record<string, unknown>) => {
    if (intent !== "config.resolve") return inner(intent, params)
    sent.push({ intent, params })
    if (answer instanceof ContractError) throw answer
    return answer
  }) as typeof client.query
  // Only the resolve reads are counted below.
  const resolves = () => sent.filter((s) => s.intent === "config.resolve")
  renderPage(
    () => <ResolvePanel entryKey={KEY} valueType={valueType} />,
    client
  )
  return { resolves }
}

const tenantBox = () =>
  screen.getByLabelText("Resolve for tenant") as HTMLInputElement
const press = () =>
  fireEvent.click(screen.getByRole("button", { name: "Resolve" }))
const sentence = async (re: RegExp) =>
  waitFor(() => {
    const el = screen.getByRole("status")
    expect(el.textContent).toMatch(re)
  })

describe("ResolvePanel", () => {
  it("asks nothing until Resolve is pressed", async () => {
    const { resolves } = setup(resolved())
    fireEvent.change(tenantBox(), { target: { value: "acme" } })
    await new Promise((r) => setTimeout(r, 20))
    expect(resolves()).toHaveLength(0)
    expect(screen.queryByRole("status")).toBeNull()
  })

  it("says a tenant's value came from its override, and what the app default is", async () => {
    const { resolves } = setup(
      resolved({
        value: "howdy",
        source: "override",
        overrideValue: "howdy",
        tenantId: "acme",
      })
    )
    fireEvent.change(tenantBox(), { target: { value: " acme " } })
    press()
    await sentence(/Tenant acme gets "howdy", from its override\./)
    expect(screen.getByRole("status").textContent).toMatch(
      /The app default is "hello"\./
    )
    expect(resolves().map((r) => r.params)).toEqual([
      { key: KEY, tenantId: "acme" },
    ])
  })

  it("says the app default answered, without repeating it as a second sentence", async () => {
    setup(resolved({ tenantId: "acme" }))
    fireEvent.change(tenantBox(), { target: { value: "acme" } })
    press()
    await sentence(/Tenant acme gets "hello", the app default\./)
    expect(screen.getByRole("status").textContent).not.toMatch(
      /The app default is/
    )
  })

  it("asks with no tenant at all, and says so", async () => {
    const { resolves } = setup(resolved())
    press()
    await sentence(/Without a tenant, the app default is "hello"\./)
    expect(resolves().map((r) => r.params)).toEqual([{ key: KEY }])
  })

  it("shows an override of the empty string as quoted, not as no override", async () => {
    setup(
      resolved({
        value: "",
        source: "override",
        overrideValue: "",
        tenantId: "acme",
      })
    )
    fireEvent.change(tenantBox(), { target: { value: "acme" } })
    press()
    await sentence(/Tenant acme gets "", from its override\./)
    expect(screen.getByRole("status").textContent).toMatch(
      /The app default is "hello"\./
    )
  })

  it("shows an override of false as false", async () => {
    setup(
      resolved({
        value: false,
        source: "override",
        overrideValue: false,
        appValue: true,
        tenantId: "acme",
      }),
      "bool"
    )
    fireEvent.change(tenantBox(), { target: { value: "acme" } })
    press()
    await sentence(/Tenant acme gets false, from its override\./)
    expect(screen.getByRole("status").textContent).toMatch(
      /The app default is true\./
    )
  })

  it("flags a resolved value that is not a value of the type", async () => {
    setup(resolved({ valueMatchesType: false, value: 5 }), "string")
    press()
    await screen.findByText("Wrong type")
  })

  it("Clear removes the answer and the typed tenant, and asks nothing more", async () => {
    const { resolves } = setup(resolved({ tenantId: "acme" }))
    fireEvent.change(tenantBox(), { target: { value: "acme" } })
    press()
    await sentence(/Tenant acme gets/)
    fireEvent.click(screen.getByRole("button", { name: "Clear" }))
    expect(screen.queryByRole("status")).toBeNull()
    expect(tenantBox().value).toBe("")
    await new Promise((r) => setTimeout(r, 20))
    expect(resolves()).toHaveLength(1)
  })

  it("asks again when the same question is pressed twice", async () => {
    const { resolves } = setup(resolved({ tenantId: "acme" }))
    fireEvent.change(tenantBox(), { target: { value: "acme" } })
    press()
    await sentence(/Tenant acme gets/)
    press()
    await waitFor(() => expect(resolves()).toHaveLength(2))
  })

  it("shows a refusal instead of an answer", async () => {
    setup(new ContractError("NOT_FOUND", "config entry not found"))
    press()
    expect(await screen.findByText(/config entry not found/)).toBeTruthy()
  })
})
