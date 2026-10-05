import { describe, expect, it } from "vitest"
import { screen, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { SetupPage } from "../src/pages/setup"
import { config } from "./fixtures"
import { failingClient, recordingClient, renderPage, stubClient } from "./harness"

describe("SetupPage", () => {
  it("reads config.get and shows the effective configuration", async () => {
    const { client, intents } = recordingClient({ "config.get": config() })
    renderPage(SetupPage, client)
    expect(await screen.findByText("Engine configuration")).toBeTruthy()
    expect(intents).toEqual(["config.get"])
    const settings = screen.getByText("Pass threshold").closest("dl") as HTMLElement
    expect(within(settings).getByText("0.70")).toBeTruthy()
    expect(within(settings).getByText("0.05")).toBeTruthy()
    expect(within(settings).getByText("4")).toBeTruthy()
    expect(within(settings).getByText("smart").className).toContain("font-mono")
  })

  it("lists targets and scorers with live counts, in the server's order", async () => {
    renderPage(SetupPage, stubClient({ "config.get": config() }))
    expect(await screen.findByText("2 targets")).toBeTruthy()
    expect(screen.getByText("4 scorers")).toBeTruthy()
    const scorers = screen.getByRole("region", { name: "4 scorers" })
    const names = within(scorers)
      .getAllByRole("row")
      .slice(1)
      .map((row) => within(row).getAllByRole("cell")[0].textContent)
    expect(names).toEqual(["contains", "judge", "not_contains", "regex"])
  })

  it("marks only the scorers that call an LLM or need config, and says none for a missing dimension", async () => {
    renderPage(SetupPage, stubClient({ "config.get": config() }))
    const scorers = await screen.findByRole("region", { name: "4 scorers" })
    expect(within(scorers).getAllByText("Calls an LLM").length).toBe(2) // the header and judge
    expect(within(scorers).getAllByText("Needs config").length).toBe(2) // the header and regex
    expect(within(scorers).getAllByLabelText("no dimension").length).toBe(3)
  })

  it("says no run can start when no target is registered, and how to register one", async () => {
    renderPage(SetupPage, stubClient({ "config.get": config({ targets: [] }) }))
    const note = await screen.findByRole("note")
    expect(note.textContent).toContain("No target is registered, so no run can start.")
    expect(note.textContent).toContain("WithTarget(name, description, target)")
    expect(screen.getByText("No targets registered.")).toBeTruthy()
    expect(screen.getByText("0 targets")).toBeTruthy()
  })

  it("has no notice when a target is registered", async () => {
    renderPage(SetupPage, stubClient({ "config.get": config() }))
    await screen.findByText("2 targets")
    expect(screen.queryByRole("note")).toBeNull()
  })

  it("shows a failed read with its code", async () => {
    renderPage(SetupPage, failingClient(new ContractError("PERMISSION_DENIED", "no app in scope")))
    expect((await screen.findByRole("alert")).textContent).toBe("PERMISSION_DENIED: no app in scope")
  })
})
