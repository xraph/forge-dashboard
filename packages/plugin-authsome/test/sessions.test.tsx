import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import type { ScopedClient } from "@forge-go/dashboard-plugin"
import { AuthSessionsPage } from "../src/pages/sessions"
import type { SessionSummary } from "../src/pages/sessions"
import {
  failingClient,
  pendingClient,
  recordingCommandClient,
  renderPage,
  stubClient,
} from "./harness"

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

/**
 * Records every `sessions.list` read this page issues, together with the
 * params it was called with.
 *
 * Mirrors the identically-named helper in `users.test.tsx`: `stubClient`'s
 * own recording lives on the command side (`intents`, `payloads`), and the
 * filter test below needs to see what a *query* was asked with -
 * specifically, whether `userId` is dropped rather than sent empty once the
 * filter is cleared.
 */
function recordingClient(answers: Record<string, unknown>): {
  client: ScopedClient
  queries: { intent: string; params?: Record<string, unknown> }[]
} {
  const queries: { intent: string; params?: Record<string, unknown> }[] = []
  const { client: inner } = stubClient(answers)
  return {
    queries,
    client: {
      extension: inner.extension,
      query: (intent: string, params?: Record<string, unknown>) => {
        queries.push({ intent, params })
        return inner.query(intent, params)
      },
      command: inner.command,
    } as ScopedClient,
  }
}

describe("AuthSessionsPage", () => {
  it("renders a row per session with the fields it was given", async () => {
    const { client } = stubClient({
      "sessions.list": {
        sessions: [
          session(),
          session({
            id: "ses_2",
            userId: "usr_2",
            userAgent: "Mozilla/5.0 (fixture)",
          }),
        ],
      },
    })
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
    // The count is information ("0 sessions"), not something to drop just
    // because the table itself has nothing to show.
    expect(screen.getByText("0 sessions")).toBeDefined()
  })

  it("announces a missing ip, user agent or last activity instead of a bare dash", async () => {
    const { client } = stubClient({
      "sessions.list": {
        sessions: [
          session({ ipAddress: undefined, userAgent: undefined, lastActivityAt: undefined }),
        ],
      },
    })
    renderPage(AuthSessionsPage, client)

    await waitFor(() => expect(screen.getByText("ses_1")).toBeTruthy())
    expect(screen.getByLabelText("no ip address")).toBeTruthy()
    expect(screen.getByLabelText("no user agent")).toBeTruthy()
    expect(screen.getByLabelText("no last activity")).toBeTruthy()
  })

  it("sends nothing until the revoke is confirmed, and shows the reason on failure", async () => {
    const { client, sent } = recordingCommandClient(
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
    expect(sent).toHaveLength(0)

    fireEvent.click(screen.getByRole("button", { name: "Revoke" }))
    await waitFor(() => expect(sent).toHaveLength(1))

    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toContain("Could not revoke")
    expect(alert.textContent).toContain("sessions.revoke required")
    expect(screen.getByText("ses_1")).toBeDefined()
  })
})

describe("AuthSessionsPage actions", () => {
  const sessionsAnswer = {
    sessions: [
      { id: "s1", userId: "u1", ipAddress: "10.0.0.1", userAgent: "Firefox",
        lastActivityAt: "2026-02-02T00:00:00Z", expiresAt: "2026-03-01T00:00:00Z",
        createdAt: "2026-02-01T00:00:00Z" },
    ],
  }

  it("revokes one session after confirming, naming the user", async () => {
    const { client, sent } = recordingCommandClient(
      { "sessions.list": sessionsAnswer },
      { "sessions.revoke": { ok: true } },
    )
    renderPage(AuthSessionsPage, client)
    await waitFor(() => expect(screen.getByText("10.0.0.1")).toBeTruthy())

    fireEvent.click(screen.getByRole("button", { name: "Revoke session s1" }))
    expect(sent).toHaveLength(0)
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }))

    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toEqual({ intent: "sessions.revoke", payload: { id: "s1" } })
  })

  it("revokes every session for one user, and says how many that is", async () => {
    // `BulkRevokeResponse` from handlers_sessions.go is `{ ok, count }` - the
    // json tag is `count`, not `revoked`.
    const { client, sent } = recordingCommandClient(
      { "sessions.list": sessionsAnswer },
      { "sessions.bulkRevoke": { ok: true, count: 3 } },
    )
    renderPage(AuthSessionsPage, client)
    await waitFor(() => expect(screen.getByText("10.0.0.1")).toBeTruthy())

    fireEvent.click(screen.getByRole("button", { name: "Revoke all for u1" }))
    fireEvent.click(screen.getByRole("button", { name: "Revoke all" }))

    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toEqual({ intent: "sessions.bulkRevoke", payload: { userId: "u1" } })
    // The dialog closing is not feedback. The server's own count has to
    // reach the operator, not just fire on the wire.
    expect(await screen.findByText("Revoked 3 sessions for u1.")).toBeTruthy()
  })

  it("filters by user id and drops the filter when cleared", async () => {
    const { client, queries } = recordingClient({ "sessions.list": sessionsAnswer })
    renderPage(AuthSessionsPage, client)
    await waitFor(() => expect(screen.getByText("10.0.0.1")).toBeTruthy())

    fireEvent.change(screen.getByRole("searchbox", { name: "Filter by user" }), {
      target: { value: "u9" },
    })
    await waitFor(() => expect(queries.some((q) => q.params?.userId === "u9")).toBe(true))

    fireEvent.change(screen.getByRole("searchbox", { name: "Filter by user" }), {
      target: { value: "" },
    })
    // Cleared means absent, not empty string: an empty userId would be a
    // different cache key for the same question.
    await waitFor(() =>
      expect(queries.filter((q) => q.params?.userId === undefined).length).toBeGreaterThan(1),
    )
  })
})

describe("AuthSessionsPage stale command state across rows", () => {
  const twoSessions = {
    sessions: [
      session({ id: "s1", userId: "u1", ipAddress: "10.0.0.1" }),
      session({ id: "s2", userId: "u2", ipAddress: "10.0.0.2" }),
    ],
  }

  it("does not carry one session's revoke error into another session's revoke dialog", async () => {
    const { client } = recordingCommandClient(
      { "sessions.list": twoSessions },
      {
        "sessions.revoke": (payload?: unknown) =>
          (payload as { id: string }).id === "s1"
            ? new ContractError("PERMISSION_DENIED", "sessions.revoke required")
            : { ok: true },
      }
    )
    renderPage(AuthSessionsPage, client)
    await waitFor(() => expect(screen.getByText("10.0.0.1")).toBeTruthy())

    fireEvent.click(screen.getByRole("button", { name: "Revoke session s1" }))
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }))
    const failure = await screen.findByRole("alert")
    expect(failure.textContent).toContain("sessions.revoke required")

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    fireEvent.click(screen.getByRole("button", { name: "Revoke session s2" }))

    // s2 has not been touched. s1's failure must not show up here.
    expect(screen.getByText("Revoke this session?")).toBeTruthy()
    expect(screen.queryByRole("alert")).toBeNull()
    expect(screen.queryByText("sessions.revoke required")).toBeNull()
  })

  it("does not carry one user's bulk-revoke error into another user's bulk-revoke dialog", async () => {
    const { client } = recordingCommandClient(
      { "sessions.list": twoSessions },
      {
        "sessions.bulkRevoke": (payload?: unknown) =>
          (payload as { userId: string }).userId === "u1"
            ? new ContractError("PERMISSION_DENIED", "sessions.bulkRevoke required")
            : { ok: true },
      }
    )
    renderPage(AuthSessionsPage, client)
    await waitFor(() => expect(screen.getByText("10.0.0.1")).toBeTruthy())

    fireEvent.click(screen.getByRole("button", { name: "Revoke all for u1" }))
    fireEvent.click(screen.getByRole("button", { name: "Revoke all" }))
    const failure = await screen.findByRole("alert")
    expect(failure.textContent).toContain("sessions.bulkRevoke required")

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    fireEvent.click(screen.getByRole("button", { name: "Revoke all for u2" }))

    // u2 has not been touched. u1's failure must not show up here.
    expect(screen.getByText("Revoke every session for u2?")).toBeTruthy()
    expect(screen.queryByRole("alert")).toBeNull()
    expect(screen.queryByText("sessions.bulkRevoke required")).toBeNull()
  })
})
