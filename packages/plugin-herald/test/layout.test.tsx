import { afterEach, describe, expect, it, vi } from "vitest"
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import { layoutViolations } from "@forge-go/dashboard-kit/lib/layout-check"
import { InboxPage } from "../src/pages/inbox"
import { MessageDetailPage } from "../src/pages/message-detail"
import { PreferencesPage } from "../src/pages/preferences"
import { ProviderCreatePage } from "../src/pages/provider-create"
import { ProviderDetailPage } from "../src/pages/provider-detail"
import { ProviderEditPage } from "../src/pages/provider-edit"
import { ProvidersPage } from "../src/pages/providers"
import { RoutingPage } from "../src/pages/routing"
import { SendTestPage } from "../src/pages/send-test"
import { TemplateCreatePage } from "../src/pages/template-create"
import { TemplateWorkspacePage } from "../src/pages/template-workspace"
import {
  TemplatesPage,
  TemplatesWithoutFallbackPage,
} from "../src/pages/templates"
import {
  engine,
  messageDetail,
  notification,
  providerDetail,
  providerSummary,
  scopeRule,
  templateDetail,
  templateSummary,
} from "./data"
import {
  invalidatingClient,
  renderPage,
  renderWithNavigate,
  scriptedClient,
  stubClient,
} from "./harness"

// The workspace's code editor needs a layout engine jsdom does not have.
vi.mock("../src/components/editor/code-editor", async () => ({
  default: (await import("./editor-stand-in")).EditorStandIn,
}))
vi.mock("../src/components/editor/field-diff", async () => ({
  default: (await import("./editor-stand-in")).DiffStandIn,
}))

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const PROVIDER_ID = "hpvd_01j00000000000000000000001"
const MESSAGE_ID = "hmsg_01j00000000000000000001000"
const SMTP = providerSummary()
const TWILIO = providerSummary({
  id: "hpvd_01j00000000000000000000002",
  name: "Twilio",
  channel: "sms",
  driver: "twilio",
})

function expectLayout(container: HTMLElement) {
  expect(layoutViolations(container)).toEqual([])
}

describe("Herald pages follow the shared layout", () => {
  it("Inbox follows the shared layout", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { client } = scriptedClient({
      "engine.info": engine(),
      "inbox.list": { notifications: [notification()], unread: 1 },
    })
    const { container } = renderPage(InboxPage, client)
    fireEvent.change(await screen.findByLabelText("User ID"), {
      target: { value: "usr_ada" },
    })
    await act(async () => {
      vi.advanceTimersByTime(300)
    })
    await screen.findByText("Welcome to Example")
    expectLayout(container)
  })

  it("Message detail follows the shared layout", async () => {
    const { container } = renderPage(
      MessageDetailPage,
      scriptedClient({
        "engine.info": engine(),
        "messages.detail": {
          message: messageDetail({ status: "failed", error: "550 mailbox" }),
        },
      }).client,
      { id: MESSAGE_ID }
    )
    await screen.findByText("550 mailbox")
    expect(screen.getByRole("heading", { level: 1 })).toBeTruthy()
    expectLayout(container)
  })

  it("Message detail without an ID follows the shared layout", async () => {
    const { container } = renderPage(
      MessageDetailPage,
      stubClient({ "engine.info": engine() }),
      {}
    )
    await screen.findByText("app_demo")
    expectLayout(container)
  })

  it("Preferences follows the shared layout", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { client } = scriptedClient({
      "engine.info": engine(),
      "preferences.get": {
        preference: {
          id: "hprf_01j00000000000000000003000",
          userId: "usr_ada",
          overrides: {
            "auth.welcome": {
              email: null,
              sms: null,
              push: null,
              inapp: false,
            },
          },
          updatedAt: "2026-09-23T10:00:00Z",
        },
        knownTypes: ["auth.welcome"],
      },
    })
    const { container } = renderPage(PreferencesPage, client)
    fireEvent.change(await screen.findByLabelText("User ID"), {
      target: { value: "usr_ada" },
    })
    await act(async () => {
      vi.advanceTimersByTime(300)
    })
    await screen.findByText("1 notification type for usr_ada")
    expectLayout(container)
  })

  it("Provider create follows the shared layout", async () => {
    const { client } = scriptedClient({ "engine.info": engine() })
    const { container } = renderWithNavigate(ProviderCreatePage, client)
    fireEvent.change(await screen.findByLabelText("Channel"), {
      target: { value: "email" },
    })
    fireEvent.change(screen.getByLabelText("Driver"), {
      target: { value: "smtp" },
    })
    await screen.findByLabelText("Host")
    expectLayout(container)
  })

  it("Provider detail follows the shared layout", async () => {
    const { container } = renderPage(
      ProviderDetailPage,
      scriptedClient({
        "engine.info": engine(),
        "providers.detail": { provider: providerDetail() },
      }).client,
      { id: PROVIDER_ID }
    )
    await screen.findByRole("table", { name: /3 settings/ })
    expectLayout(container)
  })

  it("Provider detail without an ID follows the shared layout", async () => {
    const { container } = renderPage(
      ProviderDetailPage,
      stubClient({ "engine.info": engine() }),
      {}
    )
    await screen.findByText("app_demo")
    expectLayout(container)
  })

  it("Provider edit follows the shared layout", async () => {
    const { container } = renderWithNavigate(
      ProviderEditPage,
      scriptedClient({
        "engine.info": engine(),
        "providers.detail": { provider: providerDetail() },
      }).client,
      { id: PROVIDER_ID }
    )
    await screen.findByRole("button", { name: "Replace password" })
    expectLayout(container)
  })

  it("Providers follows the shared layout", async () => {
    const { container } = renderPage(
      ProvidersPage,
      stubClient({
        "engine.info": engine(),
        "providers.list": { providers: [SMTP, TWILIO] },
      })
    )
    await screen.findByText("2 providers")
    expectLayout(container)
  })

  it("Routing follows the shared layout", async () => {
    const { client } = scriptedClient({
      "engine.info": engine(),
      "scopes.list": {
        rules: [
          scopeRule(),
          scopeRule({
            id: "hscf_01j00000000000000000004002",
            scope: "user",
            scopeId: "usr_ada",
            providers: {},
          }),
        ],
      },
      "providers.list": { providers: [SMTP, TWILIO] },
      "send.resolve": {
        provider: {
          id: SMTP.id,
          name: "Primary SMTP",
          driver: "smtp",
          enabled: true,
        },
        via: "app",
        from: {},
      },
    })
    const { container } = renderPage(RoutingPage, client)
    await screen.findByText("usr_ada")
    fireEvent.change(screen.getByLabelText("Channel to test"), {
      target: { value: "email" },
    })
    await screen.findByText(/Primary SMTP/)
    expectLayout(container)
  })

  it("Send test follows the shared layout", async () => {
    const { client } = scriptedClient(
      {
        "engine.info": engine(),
        "providers.list": { providers: [SMTP] },
        "templates.list": { templates: [templateSummary()] },
        "templates.detail": { template: templateDetail(), resolution: [] },
        "templates.resolve": {
          locale: "en",
          steps: [],
          versionId: "htpv_01j00000000000000000000026",
          match: "exact",
        },
        "templates.render": { fields: [], diagnostics: [] },
        "send.resolve": {
          provider: {
            id: SMTP.id,
            name: "Primary SMTP",
            driver: "smtp",
            enabled: true,
          },
          via: "app",
          from: {},
        },
      },
      {
        "send.test": {
          messageId: "hmsg_01j00000000000000000000150",
          status: "sent",
          provider: { id: SMTP.id, name: "Primary SMTP", driver: "smtp" },
          logged: true,
        },
      }
    )
    const { container } = renderPage(SendTestPage, client)
    fireEvent.change(await screen.findByLabelText("Channel"), {
      target: { value: "email" },
    })
    fireEvent.change(screen.getByLabelText("Recipient"), {
      target: { value: "ada@example.com" },
    })
    fireEvent.change(await screen.findByLabelText("Template"), {
      target: { value: "htpl_01j00000000000000000000015" },
    })
    await screen.findByLabelText("customer_name")
    fireEvent.change(screen.getByLabelText("customer_name"), {
      target: { value: "Ada" },
    })
    fireEvent.change(screen.getByLabelText("amount"), {
      target: { value: "$12" },
    })
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Send test" }) as HTMLButtonElement)
          .disabled
      ).toBe(false)
    )
    fireEvent.click(screen.getByRole("button", { name: "Send test" }))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Send" }))
    await screen.findByText(/Accepted by/)
    // Both blocks that carry a heading are on screen: the result and the preview.
    expect(container.querySelectorAll("h2").length).toBeGreaterThanOrEqual(2)
    expectLayout(container)
  })

  it("Template create follows the shared layout", async () => {
    const { client } = scriptedClient({ "engine.info": engine() })
    const { container } = renderWithNavigate(TemplateCreatePage, client)
    await screen.findByLabelText("Name")
    expectLayout(container)
  })

  it("Template workspace follows the shared layout", async () => {
    const { client } = invalidatingClient({
      "engine.info": engine(),
      "templates.detail": { template: templateDetail(), resolution: [] },
      "templates.render": { fields: [], diagnostics: [] },
      "send.resolve": { provider: null, via: "none", from: {} },
    })
    const { container } = renderPage(TemplateWorkspacePage, client, {
      id: templateDetail().id,
    })
    await screen.findByLabelText("Subject (en)")
    expectLayout(container)
    fireEvent.click(screen.getByRole("tab", { name: "Variables" }))
    await screen.findByRole("table", { name: /3 variables/ })
    expectLayout(container)
    fireEvent.click(screen.getByRole("tab", { name: "Settings" }))
    await screen.findByRole("button", { name: "Delete template" })
    expectLayout(container)
  })

  it("Template workspace without an ID follows the shared layout", async () => {
    const { container } = renderPage(
      TemplateWorkspacePage,
      stubClient({ "engine.info": engine() }),
      {}
    )
    await screen.findByText("app_demo")
    expectLayout(container)
  })

  it("Templates follows the shared layout", async () => {
    const { container } = renderPage(
      TemplatesPage,
      stubClient({
        "engine.info": engine(),
        "templates.list": { templates: [templateSummary()] },
      })
    )
    await screen.findByText("1 template")
    expectLayout(container)
  })

  it("Templates without a fallback follows the shared layout", async () => {
    const { container } = renderPage(
      TemplatesWithoutFallbackPage,
      stubClient({
        "engine.info": engine(),
        "templates.list": { templates: [templateSummary()] },
      })
    )
    await screen.findByText("1 template")
    expectLayout(container)
  })
})
