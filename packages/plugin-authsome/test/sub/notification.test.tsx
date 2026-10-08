import { fireEvent, screen, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import {
  NotificationsPage,
  NotificationSendPage,
} from "../../src/sub/notification"
import { renderSubPage, subStubClient } from "./harness"

const templates = {
  templates: [
    {
      id: "template-1",
      name: "Welcome",
      slug: "welcome",
      channel: "email",
      category: "auth",
      enabled: true,
      is_system: true,
      versions: [
        {
          id: "version-1",
          template_id: "template-1",
          locale: "en",
          active: true,
        },
      ],
    },
  ],
}

describe("notification management", () => {
  it("shows templates and their event mappings", async () => {
    const client = subStubClient({
      "notification.templates.list": templates,
      "notification.mappings.list": {
        mappings: [
          {
            action: "auth.signup",
            template: "welcome",
            channels: ["email"],
            enabled: true,
          },
        ],
      },
    })
    renderSubPage(NotificationsPage, {
      client: client.client,
      hostClient: subStubClient({}).client,
      allowed: [],
    })
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "Welcome" })).toBeTruthy()
    )
    fireEvent.click(screen.getByRole("tab", { name: /Event mappings/ }))
    expect(screen.getByText("auth.signup")).toBeTruthy()
    expect(screen.getByRole("link", { name: "Send notification" })).toBeTruthy()
  })

  it("validates variables before a test send and passes the chosen template", async () => {
    const client = subStubClient(
      { "notification.templates.list": templates },
      { "notification.send": { ok: true } }
    )
    renderSubPage(NotificationSendPage, {
      client: client.client,
      hostClient: subStubClient({}).client,
      allowed: [],
    })
    await waitFor(() => expect(screen.getByLabelText("Template")).toBeTruthy())
    fireEvent.change(screen.getByLabelText("Template"), {
      target: { value: "template-1" },
    })
    fireEvent.change(screen.getByLabelText("Recipient"), {
      target: { value: "user@example.com" },
    })
    fireEvent.change(screen.getByLabelText("Variables (JSON)"), {
      target: { value: "[1]" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Test send" }))
    expect(screen.getByRole("alert").textContent).toMatch(/JSON object/)
    expect(client.payloads).toHaveLength(0)
    fireEvent.change(screen.getByLabelText("Variables (JSON)"), {
      target: { value: '{"name":"Ada"}' },
    })
    fireEvent.click(screen.getByRole("button", { name: "Test send" }))
    await waitFor(() => expect(client.payloads).toHaveLength(1))
    expect(client.payloads[0]).toEqual({
      intent: "notification.send",
      payload: {
        id: "template-1",
        recipient: "user@example.com",
        locale: "",
        data: { name: "Ada" },
        test: true,
      },
    })
  })
})
