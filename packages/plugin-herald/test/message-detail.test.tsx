import { describe, expect, it } from "vitest"
import { screen } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { MessageDetailPage } from "../src/pages/message-detail"
import { engine, messageDetail } from "./data"
import { pendingClient, renderPage, scriptedClient } from "./harness"

const ID = "hmsg_01j00000000000000000001000"

function show(detail = messageDetail()) {
  return renderPage(MessageDetailPage, scriptedClient({ "engine.info": engine(), "messages.detail": { message: detail } }).client, { id: ID })
}

describe("MessageDetailPage", () => {
  it("says accepted, not delivered, and that receipts never come back", async () => {
    show()
    expect(await screen.findByText(/Accepted by provider/, { selector: "p" })).toBeTruthy()
    expect(screen.getByText(/delivery isn't confirmed/)).toBeTruthy()
    expect(screen.getByText("1000.msg@smtp.example.com").className).toMatch(/font-mono text-xs/)
  })

  it("asks for the message by id", async () => {
    const c = scriptedClient({ "engine.info": engine(), "messages.detail": { message: messageDetail() } })
    renderPage(MessageDetailPage, c.client, { id: ID })
    await screen.findByText(/Accepted by provider/, { selector: "p" })
    expect(c.queried.find((q) => q.intent === "messages.detail")?.params).toEqual({ id: ID })
  })

  it("links the template and provider while they exist", async () => {
    show()
    expect((await screen.findByRole("link", { name: "auth.welcome" })).getAttribute("href")).toBe("/templates/htpl_01j00000000000000000000011")
    expect(screen.getByRole("link", { name: "Primary SMTP" }).getAttribute("href")).toBe("/providers/hpvd_01j00000000000000000000001")
  })

  it("names a template that is gone without linking it, and says when there is no provider", async () => {
    show(messageDetail({ templateSlug: "retired.notice", template: null, provider: null, status: "suppressed", providerMessageId: undefined }))
    expect(await screen.findByText("retired.notice")).toBeTruthy()
    expect(screen.getByText(/no longer exists/)).toBeTruthy()
    expect(screen.queryByRole("link", { name: "retired.notice" })).toBeNull()
    expect(screen.getByLabelText("no provider")).toBeTruthy()
    expect(screen.getByText(/opted out/)).toBeTruthy()
  })

  it("says a deleted provider no longer exists, without saying delivered", async () => {
    const { container } = show(messageDetail({ provider: null, status: "sent" }))
    expect(await screen.findByLabelText("no provider")).toBeTruthy()
    expect(screen.getByText("(no longer exists)")).toBeTruthy()
    expect(container.textContent).not.toMatch(/delivered/i)
  })

  it("gives a provider with no name its id in mono", async () => {
    show(messageDetail({ provider: { id: "hpvd_01j00000000000000000000001", name: "", driver: "smtp" } }))
    const link = await screen.findByRole("link", { name: "hpvd_01j00000000000000000000001" })
    expect(link.querySelector("span")?.className).toMatch(/font-mono text-xs/)
  })

  it("says so when a failure recorded no error, and when the body is empty", async () => {
    show(messageDetail({ status: "failed", error: undefined, body: "", providerMessageId: undefined, sentAt: undefined }))
    expect(await screen.findByText("No error was recorded.")).toBeTruthy()
    expect(screen.getByText("No body recorded.")).toBeTruthy()
    expect(document.querySelector("pre")).toBeNull()
  })

  it("shows a failure verbatim in a pre", async () => {
    show(messageDetail({ status: "failed", error: "smtp: 550 5.1.1 mailbox unavailable", providerMessageId: undefined, sentAt: undefined }))
    const pre = await screen.findByText("smtp: 550 5.1.1 mailbox unavailable")
    expect(pre.tagName).toBe("PRE")
  })

  it("says the body is the text part, cut at the engine's limit", async () => {
    show()
    expect(await screen.findByText(/HTML bodies aren't logged/)).toBeTruthy()
    expect(screen.getByText(/4096 bytes/)).toBeTruthy()
  })

  it("links to a test send to this recipient, replacing retry", async () => {
    show()
    expect((await screen.findByRole("link", { name: "Send a test to this recipient" })).getAttribute("href")).toBe(`/messages/${ID}/send-test`)
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull()
  })

  it("renders not found as an error card, still under the app header", async () => {
    renderPage(MessageDetailPage, scriptedClient({ "engine.info": engine(), "messages.detail": () => new ContractError("NOT_FOUND", "message not found") }).client, { id: ID })
    expect(await screen.findByText(/Message unavailable/)).toBeTruthy()
    expect(screen.getByRole("heading", { level: 1, name: "Message" })).toBeTruthy()
    expect(screen.getByText(/^App:/)).toBeTruthy()
    expect(screen.queryByRole("link", { name: "Send a test to this recipient" })).toBeNull()
  })

  it("names the app while loading", () => {
    renderPage(MessageDetailPage, pendingClient(), { id: ID })
    expect(screen.getByRole("heading", { level: 1, name: "Message" })).toBeTruthy()
    expect(screen.getByText(/^App:/)).toBeTruthy()
  })

  it("says there is nothing to show with no id, under the app header, and asks nothing", () => {
    const c = scriptedClient({ "engine.info": engine() })
    renderPage(MessageDetailPage, c.client, {})
    expect(screen.getByRole("heading", { level: 1, name: "Message" })).toBeTruthy()
    expect(screen.getByText("No message ID in the address, so there is nothing to show.")).toBeTruthy()
    expect(c.queried.find((q) => q.intent === "messages.detail")).toBeUndefined()
  })
})
