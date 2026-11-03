import { describe, expect, it } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import {
  OAuth2OverviewPage,
  oauth2providerSubPlugin,
} from "../../src/sub/oauth2provider"
import { renderSubPage, subStubClient } from "./harness"

const clients = {
  clients: [
    {
      id: "cli_1",
      clientId: "pub-abc",
      name: "Mobile app",
      public: true,
      firstParty: true,
      redirectUris: ["app://cb"],
      scopes: ["openid"],
      grantTypes: ["authorization_code"],
      createdAt: "2026-01-01T00:00:00Z",
    },
    {
      id: "cli_2",
      clientId: "conf-xyz",
      name: "Backend",
      public: false,
      firstParty: false,
      redirectUris: ["https://x.test/cb"],
      scopes: ["openid", "profile"],
      grantTypes: ["authorization_code", "refresh_token"],
      createdAt: "2026-02-01T00:00:00Z",
    },
  ],
}

function renderOverview(
  own = subStubClient({ "oauth2.clients.list": clients })
) {
  renderSubPage(OAuth2OverviewPage, {
    client: own.client,
    hostClient: subStubClient({}).client,
    allowed: [],
  })
  return own
}

describe("oauth2provider sub-plugin shape", () => {
  it("declares the extension, nav, routes and settings tab", () => {
    const sub = oauth2providerSubPlugin
    expect(sub.extension).toBe("oauth2provider")
    expect(sub.host).toBe("authsome")
    expect(sub.nav).toEqual([
      {
        label: "OAuth2 Provider",
        to: "/auth/oauth2",
        group: "Authentication",
        priority: 7,
      },
    ])
    expect(sub.routes.map((r) => r.path)).toEqual([
      "/auth/oauth2",
      "/auth/oauth2/clients/create",
      "/auth/oauth2/clients/:id",
    ])
    expect([...sub.hostIntents].sort()).toEqual([
      "settings.enforce",
      "settings.namespace",
      "settings.unenforce",
      "settings.update",
    ])
    const tabs = sub.contributions["settings.tabs"]
    expect(tabs).toHaveLength(1)
    expect(tabs![0].id).toBe("oauth2provider")
    expect(tabs![0].label).toBe("OAuth2")
  })
})

describe("oauth2 overview clients section", () => {
  it("lists clients from oauth2.clients.list", async () => {
    const own = renderOverview()
    await waitFor(() => expect(screen.getByText("Mobile app")).toBeTruthy())
    expect(screen.getByText("Backend")).toBeTruthy()
    // clientId is the public identifier and is what gets displayed.
    expect(screen.getByText("pub-abc")).toBeTruthy()
    expect(screen.getByText("conf-xyz")).toBeTruthy()
    expect(screen.getByText("Public")).toBeTruthy()
    expect(screen.getByText("Confidential")).toBeTruthy()
    expect(own.intents).toContain("oauth2.clients.list")
  })

  it("shows the contract error when the intent is missing", async () => {
    renderOverview(subStubClient({}))
    expect(
      await screen.findByText(
        /no query handler for intent "oauth2.clients.list"/
      )
    ).toBeTruthy()
  })

  it("links each row to its detail page by internal id", async () => {
    renderOverview()
    await waitFor(() => expect(screen.getByText("Mobile app")).toBeTruthy())
    const link = screen.getByRole("link", { name: "Mobile app" })
    expect(link.getAttribute("href")).toMatch(/\/auth\/oauth2\/clients\/cli_1$/)
    const other = screen.getByRole("link", { name: "Backend" })
    expect(other.getAttribute("href")).toMatch(
      /\/auth\/oauth2\/clients\/cli_2$/
    )
  })

  it("keeps Issuer and Signing keys sections for later tasks", async () => {
    renderOverview()
    expect(screen.getByRole("heading", { name: "Issuer" })).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Signing keys" })).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Clients" })).toBeTruthy()
  })
})
