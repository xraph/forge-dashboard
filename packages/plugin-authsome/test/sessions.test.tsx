import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { AuthSessionsPage } from "../src/pages/sessions"
import type { SessionSummary } from "../src/pages/sessions"
import { failingClient, pendingClient, renderPage, stubClient } from "./harness"

const START = "2026-09-06T09:00:00.000Z"
const END = "2026-09-07T09:00:00.000Z"

function session(over: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: "ses_1",
    userId: "usr_1",
    ipAddress: "127.0.0.1",
    userAgent: "curl/8.4.0",
    lastActivityAt: START,
    expiresAt: END,
    createdAt: START,
    ...over,
  }
}

/** The same mutable stand-in as the users tests, one intent smaller. */
function mutableSessions(
  seed: SessionSummary[] = [
    session(),
    session({
      id: "ses_2",
      userId: "usr_2",
      userAgent: "Mozilla/5.0 (fixture)",
    }),
  ]
) {
  const state = new Map(seed.map((s) => [s.id, { ...s }]))

  return stubClient(
    { "sessions.list": () => ({ sessions: [...state.values()] }) },
    {
      "sessions.revoke": (payload?: unknown) => {
        const id = (payload as { id: string }).id
        if (!state.delete(id)) {
          throw new ContractError("NOT_FOUND", `session ${id} not found`)
        }
        return { ok: true, id }
      },
    }
  )
}

describe("AuthSessionsPage", () => {
  it("renders a row per session with the fields it was given", async () => {
    const { client } = mutableSessions()
    renderPage(AuthSessionsPage, client)

    expect(await screen.findByText("ses_1")).toBeDefined()
    expect(screen.getByText("ses_2")).toBeDefined()
    expect(screen.getByText("curl/8.4.0")).toBeDefined()
    expect(screen.getByText("2 sessions")).toBeDefined()
  })

  it("says it is loading rather than rendering a blank pane", () => {
    renderPage(AuthSessionsPage, pendingClient())

    const busy = screen.getByRole("status")
    expect(busy.getAttribute("aria-busy")).toBe("true")
    expect(busy.getAttribute("aria-label")).toBe("Loading Sessions")
  })

  it("shows the contract error code and message when the read fails", async () => {
    renderPage(
      AuthSessionsPage,
      failingClient(new ContractError("TRANSPORT", "contract unreachable"))
    )

    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toContain("TRANSPORT")
    expect(alert.textContent).toContain("contract unreachable")
  })

  it("shows the empty message instead of a headerless table", async () => {
    const { client } = stubClient({ "sessions.list": { sessions: [] } })
    renderPage(AuthSessionsPage, client)

    await waitFor(() =>
      expect(screen.getByText("No active sessions.")).toBeDefined()
    )
    expect(screen.queryByRole("table")).toBeNull()
  })

  it("refetches the list after a successful revoke, and the row disappears", async () => {
    const { client, intents, payloads } = mutableSessions()
    renderPage(AuthSessionsPage, client)

    fireEvent.click(
      await screen.findByRole("button", { name: "Revoke session ses_1" })
    )

    await waitFor(() => expect(screen.queryByText("ses_1")).toBeNull())
    expect(screen.getByText("ses_2")).toBeDefined()
    expect(screen.getByText("1 session")).toBeDefined()

    expect(payloads).toEqual([
      { intent: "sessions.revoke", payload: { id: "ses_1" } },
    ])
    expect(intents).toEqual([
      "sessions.list",
      "sessions.revoke",
      "sessions.list",
    ])
  })

  it("does not refetch when the revoke fails, and shows the reason", async () => {
    const { client, intents } = stubClient(
      { "sessions.list": { sessions: [session()] } },
      {
        "sessions.revoke": new ContractError(
          "PERMISSION_DENIED",
          "sessions.revoke required"
        ),
      }
    )
    renderPage(AuthSessionsPage, client)

    fireEvent.click(
      await screen.findByRole("button", { name: "Revoke session ses_1" })
    )

    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toContain("Revoke failed")
    expect(alert.textContent).toContain("sessions.revoke required")
    expect(screen.getByText("ses_1")).toBeDefined()
    expect(intents).toEqual(["sessions.list", "sessions.revoke"])
  })
})
