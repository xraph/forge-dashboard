import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { TemplateCreatePage } from "../src/pages/template-create"
import { engine, templateSummary } from "./data"
import { renderWithNavigate, scriptedClient } from "./harness"

const CREATED = { template: templateSummary({ id: "htpl_01j00000000000000000000101", slug: "billing.dunning" }) }

function setup(onCreate: () => unknown = () => CREATED) {
  const c = scriptedClient({ "engine.info": engine() }, { "templates.create": onCreate })
  return { ...c, ...renderWithNavigate(TemplateCreatePage, c.client) }
}

async function fill() {
  fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Dunning" } })
  fireEvent.change(screen.getByLabelText("Slug"), { target: { value: "billing.dunning" } })
  fireEvent.change(screen.getByLabelText("Channel"), { target: { value: "email" } })
}

describe("TemplateCreatePage", () => {
  it("creates with a fallback version by default and opens the template", async () => {
    const { sent, navigate } = setup()
    await fill()
    fireEvent.click(screen.getByRole("button", { name: "Create template" }))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]?.payload).toEqual({ slug: "billing.dunning", name: "Dunning", channel: "email", category: "transactional", version: { locale: "" } })
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/templates/htpl_01j00000000000000000000101"))
  })

  it("starts with the locale you type instead", async () => {
    const { sent } = setup()
    await fill()
    fireEvent.change(screen.getByLabelText("First version's locale"), { target: { value: "pt-BR" } })
    fireEvent.click(screen.getByRole("button", { name: "Create template" }))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect((sent[0]?.payload as { version: unknown }).version).toEqual({ locale: "pt-BR" })
  })

  it("refuses a slug the server would refuse, before sending it", async () => {
    const { sent } = setup()
    await fill()
    fireEvent.change(screen.getByLabelText("Slug"), { target: { value: "Billing Dunning" } })
    expect(screen.getByText(/lower-case letters, digits, dots, dashes or underscores/)).toBeTruthy()
    expect((screen.getByRole("button", { name: "Create template" }) as HTMLButtonElement).disabled).toBe(true)
    expect(sent).toEqual([])
  })

  it("explains a duplicate slug on the same channel", async () => {
    setup(() => new ContractError("CONFLICT", "a template with this slug already exists on this channel"))
    await fill()
    fireEvent.click(screen.getByRole("button", { name: "Create template" }))
    expect((await screen.findByRole("alert")).textContent).toMatch(/billing\.dunning already exists on email/)
  })

  it("names the app before the channels have loaded", async () => {
    setup()
    expect(screen.getByRole("heading", { level: 1, name: "New template" })).toBeTruthy()
    expect(screen.getByText(/App: loading/)).toBeTruthy()
    await screen.findByLabelText("Name")
    expect(screen.getByText("app_demo")).toBeTruthy()
  })
})
