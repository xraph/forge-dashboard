import { describe, expect, it } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import { AuthAppPicker } from "../src/pages/app-picker"
import { renderPage, stubClient } from "./harness"

const contextAnswer = {
  currentApp: undefined,
  availableApps: [
    { id: "app_1", name: "Core", slug: "core", isPlatform: true },
    { id: "app_2", name: "Storefront", slug: "storefront", isPlatform: false },
  ],
  availableEnvs: [],
}

describe("AuthAppPicker", () => {
  it("lists every available app with its slug and a platform badge on the platform app", async () => {
    const { client } = stubClient({ "apps.context": contextAnswer })
    renderPage(AuthAppPicker, client)

    await waitFor(() => expect(screen.getByText("Core")).toBeTruthy())
    expect(screen.getByText("Storefront")).toBeTruthy()
    expect(screen.getByText("core")).toBeTruthy()
    expect(screen.getByText("storefront")).toBeTruthy()
    expect(screen.getByText("platform")).toBeTruthy()
    expect(screen.getByText("app")).toBeTruthy()
    expect(screen.getByText("2 apps")).toBeTruthy()
  })

  it("links each row scope-relative, with that row's own slug in the path", async () => {
    const { client } = stubClient({ "apps.context": contextAnswer })
    renderPage(AuthAppPicker, client)
    await waitFor(() => expect(screen.getByText("Core")).toBeTruthy())

    const coreLink = screen.getByRole("link", { name: "Core" })
    const storefrontLink = screen.getByRole("link", { name: "Storefront" })
    expect(coreLink.getAttribute("href")).toBe("/core/users")
    expect(storefrontLink.getAttribute("href")).toBe("/storefront/users")
  })

  it("says in one line what picking an app does, without claiming the whole dashboard scopes to it", async () => {
    const { client } = stubClient({ "apps.context": contextAnswer })
    renderPage(AuthAppPicker, client)
    await waitFor(() => expect(screen.getByText("Core")).toBeTruthy())

    expect(screen.getByText(/Pick an app to scope/)).toBeTruthy()
  })

  it("says so when there are no apps to pick", async () => {
    const { client } = stubClient({
      "apps.context": { availableApps: [], availableEnvs: [] },
    })
    renderPage(AuthAppPicker, client)

    await waitFor(() => expect(screen.getByText("No apps yet.")).toBeTruthy())
  })
})
