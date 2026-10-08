import { describe, expect, it } from "vitest"
import { screen } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import type { ComponentType } from "react"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { HeraldHeader } from "../src/components/herald-header"
import { engine } from "./data"
import { failingClient, renderPage, stubClient } from "./harness"

const Page: ComponentType<PluginPageProps> = () => (
  <HeraldHeader title="Providers" description="The ones that send." />
)

describe("HeraldHeader", () => {
  it("names the app in mono", async () => {
    renderPage(Page, stubClient({ "engine.info": engine() }))
    const app = await screen.findByText("app_demo")
    expect(app.className).toMatch(/font-mono text-xs/)
    expect(
      screen.getByRole("heading", { level: 1, name: "Providers" })
    ).toBeTruthy()
  })

  it("says Default app for the empty app, not a blank", async () => {
    renderPage(
      Page,
      stubClient({
        "engine.info": engine({ app: { id: "", label: "Default app" } }),
      })
    )
    expect(await screen.findByText("Default app")).toBeTruthy()
  })

  it("says the app is unknown when engine.info fails, rather than naming none", async () => {
    renderPage(
      Page,
      failingClient(
        new ContractError(
          "PERMISSION_DENIED",
          "the app on this session can't be read"
        )
      )
    )
    expect(await screen.findByText(/App unknown/)).toBeTruthy()
    expect(
      screen.getByText(/the app on this session can't be read/)
    ).toBeTruthy()
  })

  it("puts a meta row between the title and the app line", async () => {
    renderPage(
      () => (
        <HeraldHeader
          title="Receipt"
          meta={<span className="font-mono text-xs">billing.receipt</span>}
        />
      ),
      stubClient({ "engine.info": engine() })
    )
    const slug = await screen.findByText("billing.receipt")
    const app = await screen.findByText("app_demo")
    expect(
      slug.compareDocumentPosition(app) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })
})
