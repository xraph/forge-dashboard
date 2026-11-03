import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
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
        cluster: expect.objectContaining({ label: "Federation" }),
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

/* ------------------------------------------------------- client pages */

const detail = {
  ...clients.clients[1],
  resources: ["https://api.test"],
  authMethod: "client_secret_basic",
  dpopMode: "disabled",
  updatedAt: "2026-02-02T00:00:00Z",
}
const publicDetail = {
  ...clients.clients[0],
  resources: [],
  authMethod: "none",
  dpopMode: "disabled",
  updatedAt: "2026-01-02T00:00:00Z",
}

function pageAt(path: string) {
  return oauth2providerSubPlugin.routes.find((r) => r.path === path)!.element
}

function renderDetail(own: ReturnType<typeof subStubClient>, id = "cli_2") {
  return renderSubPage(pageAt("/auth/oauth2/clients/:id"), {
    client: own.client,
    hostClient: subStubClient({}).client,
    allowed: [],
    params: { id },
  })
}

function renderCreate(own: ReturnType<typeof subStubClient>) {
  const opts = {
    client: own.client,
    hostClient: subStubClient({}).client,
    allowed: [],
  }
  const view = renderSubPage(pageAt("/auth/oauth2/clients/create"), opts)
  return { view, opts }
}

describe("oauth2 client create", () => {
  it("creates a confidential client and reveals the secret once", async () => {
    const own = subStubClient(
      {},
      {
        "oauth2.clients.create": {
          id: "cli_9",
          clientId: "conf-new",
          clientSecret: "s3cr3t-value",
        },
      }
    )
    const { view, opts } = renderCreate(own)
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Backend 2" },
    })
    fireEvent.change(screen.getByLabelText("Redirect URIs"), {
      target: { value: "https://a.test/cb\nhttps://b.test/cb\n" },
    })
    fireEvent.click(screen.getByRole("button", { name: /create client/i }))
    expect(await screen.findByText("s3cr3t-value")).toBeTruthy()
    expect(screen.getByText("conf-new")).toBeTruthy()
    expect(screen.getByText(/will not be shown again/i)).toBeTruthy()
    expect(own.payloads[0]).toEqual({
      intent: "oauth2.clients.create",
      payload: {
        name: "Backend 2",
        public: false,
        firstParty: false,
        redirectUris: ["https://a.test/cb", "https://b.test/cb"],
        scopes: ["openid", "profile", "email"],
        grantTypes: ["authorization_code"],
        resources: [],
      },
    })

    // Navigating away and back: the secret is gone and never refetched.
    view.unmount()
    renderSubPage(pageAt("/auth/oauth2/clients/create"), opts)
    expect(screen.queryByText("s3cr3t-value")).toBeNull()
    expect(own.intents.filter((i) => i !== "oauth2.clients.create")).toEqual([])
  })

  it("creates a public client without a secret panel", async () => {
    const own = subStubClient(
      {},
      { "oauth2.clients.create": { id: "cli_8", clientId: "pub-new" } }
    )
    renderCreate(own)
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "SPA" },
    })
    fireEvent.click(screen.getByRole("checkbox", { name: "Public client" }))
    fireEvent.click(screen.getByRole("checkbox", { name: "Device code" }))
    fireEvent.click(screen.getByRole("button", { name: /create client/i }))
    expect(await screen.findByText("pub-new")).toBeTruthy()
    expect(screen.queryByText(/will not be shown again/i)).toBeNull()
    expect(
      screen.queryByRole("button", { name: /copy client secret/i })
    ).toBeNull()
    expect(
      own.payloads[0].payload as { public: boolean; grantTypes: string[] }
    ).toMatchObject({
      public: true,
      grantTypes: [
        "authorization_code",
        "urn:ietf:params:oauth:grant-type:device_code",
      ],
    })
  })

  it("shows the server message when create fails", async () => {
    const own = subStubClient(
      {},
      {
        "oauth2.clients.create": new ContractError(
          "BAD_REQUEST",
          "redirect uri must be https"
        ),
      }
    )
    renderCreate(own)
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "X" },
    })
    fireEvent.click(screen.getByRole("button", { name: /create client/i }))
    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toMatch(/redirect uri must be https/)
  })
})

describe("oauth2 client detail", () => {
  it("shows every field, with DPoP mode read-only", async () => {
    renderDetail(subStubClient({ "oauth2.clients.detail": detail }))
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Backend" })).toBeTruthy()
    )
    expect(screen.getAllByText("conf-xyz").length).toBeGreaterThan(0)
    expect(screen.getByText("client_secret_basic")).toBeTruthy()
    expect(screen.getByText("disabled")).toBeTruthy()
    expect(screen.getByText("https://api.test")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Edit" }))
    expect(screen.queryByLabelText(/dpop/i)).toBeNull()
  })

  it("hides rotate secret for public clients", async () => {
    renderDetail(
      subStubClient({ "oauth2.clients.detail": publicDetail }),
      "cli_1"
    )
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Mobile app" })).toBeTruthy()
    )
    expect(screen.queryByRole("button", { name: /rotate secret/i })).toBeNull()
  })

  it("does not rotate when the confirm is cancelled", async () => {
    const own = subStubClient(
      { "oauth2.clients.detail": detail },
      {
        "oauth2.clients.rotateSecret": {
          id: "cli_2",
          clientId: "conf-xyz",
          clientSecret: "new-secret",
        },
      }
    )
    renderDetail(own)
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Backend" })).toBeTruthy()
    )
    fireEvent.click(screen.getByRole("button", { name: /rotate secret/i }))
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }))
    expect(
      own.payloads.filter((p) => p.intent === "oauth2.clients.rotateSecret")
    ).toHaveLength(0)
    expect(screen.queryByText("new-secret")).toBeNull()
  })

  it("rotates after confirming and reveals the new secret", async () => {
    const own = subStubClient(
      { "oauth2.clients.detail": detail },
      {
        "oauth2.clients.rotateSecret": {
          id: "cli_2",
          clientId: "conf-xyz",
          clientSecret: "new-secret",
        },
      }
    )
    renderDetail(own)
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Backend" })).toBeTruthy()
    )
    fireEvent.click(screen.getByRole("button", { name: /rotate secret/i }))
    fireEvent.click(screen.getByRole("button", { name: /^rotate$/i }))
    expect(await screen.findByText("new-secret")).toBeTruthy()
    expect(own.payloads[0]).toEqual({
      intent: "oauth2.clients.rotateSecret",
      payload: { id: "cli_2" },
    })
  })

  it("saves edited redirect URIs", async () => {
    const own = subStubClient(
      { "oauth2.clients.detail": detail },
      { "oauth2.clients.update": { ok: true } }
    )
    renderDetail(own)
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Backend" })).toBeTruthy()
    )
    fireEvent.click(screen.getByRole("button", { name: "Edit" }))
    fireEvent.change(screen.getByLabelText("Redirect URIs"), {
      target: { value: "https://x.test/cb\nhttps://y.test/cb" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(own.payloads).toHaveLength(1))
    expect(own.payloads[0]).toEqual({
      intent: "oauth2.clients.update",
      payload: {
        id: "cli_2",
        redirectUris: ["https://x.test/cb", "https://y.test/cb"],
      },
    })
  })

  it("deletes after confirming and returns to the overview", async () => {
    const own = subStubClient(
      { "oauth2.clients.detail": detail },
      { "oauth2.clients.delete": { ok: true, id: "cli_2" } }
    )
    renderDetail(own)
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Backend" })).toBeTruthy()
    )
    fireEvent.click(screen.getByRole("button", { name: /delete backend/i }))
    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }))
    await waitFor(() => expect(own.payloads).toHaveLength(1))
    expect(own.payloads[0]).toEqual({
      intent: "oauth2.clients.delete",
      payload: { id: "cli_2" },
    })
    const back = await screen.findByRole("link", {
      name: /back to oauth2 provider/i,
    })
    expect(back.getAttribute("href")).toMatch(/\/auth\/oauth2$/)
  })
})
