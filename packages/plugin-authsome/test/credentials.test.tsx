import { describe, expect, it } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import { renderPage, stubClient } from "./harness"
import { AuthCredentialsPage } from "../src/pages/credentials"

const platformAnswers = {
  "credentials.detail": {
    appId: "app_1",
    appName: "Storefront",
    appSlug: "storefront",
    publishableKey: "pk_live_abc123",
    envId: "env_1",
    envName: "Production",
    envSlug: "production",
    isPlatform: false,
  },
}

describe("AuthCredentialsPage", () => {
  it("shows the app, environment and publishable key with a copy control", async () => {
    const { client } = stubClient(platformAnswers)
    renderPage(AuthCredentialsPage, client)

    await waitFor(() => expect(screen.getByText("Storefront")).toBeTruthy())
    expect(screen.getByText("storefront")).toBeTruthy()
    expect(screen.getByText("Production")).toBeTruthy()
    expect(screen.getByText("pk_live_abc123")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Copy publishable key" })).toBeTruthy()
    expect(screen.getByText("app")).toBeTruthy()
  })

  it("marks the platform app with a badge", async () => {
    const { client } = stubClient({
      "credentials.detail": { ...platformAnswers["credentials.detail"], isPlatform: true },
    })
    renderPage(AuthCredentialsPage, client)
    await waitFor(() => expect(screen.getByText("Storefront")).toBeTruthy())
    expect(screen.getByText("platform")).toBeTruthy()
  })

  it("shows a dash rather than a blank when there is no environment or key on file", async () => {
    const { client } = stubClient({
      "credentials.detail": {
        appId: "app_1",
        appName: "Platform",
        appSlug: "platform",
        isPlatform: true,
      },
    })
    renderPage(AuthCredentialsPage, client)
    await waitFor(() => expect(screen.getByText("Platform")).toBeTruthy())
    expect(screen.getAllByLabelText(/^no /).length).toBeGreaterThanOrEqual(2)
    expect(screen.queryByRole("button", { name: "Copy publishable key" })).toBeNull()
  })
})
