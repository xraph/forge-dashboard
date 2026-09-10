import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import type { ScopedClient } from "@forge-go/dashboard-plugin"
import { AuthUsersPage } from "../src/pages/users"
import type { UserSummary } from "../src/pages/users"
import {
  failingClient,
  pendingClient,
  recordingCommandClient,
  renderPage,
  stubClient,
} from "./harness"

const START = "2026-09-06T09:00:00.000Z"

function user(over: Partial<UserSummary> = {}): UserSummary {
  return {
    id: "usr_1",
    email: "ada@example.com",
    emailVerified: true,
    firstName: "Ada",
    lastName: "Lovelace",
    banned: false,
    createdAt: START,
    ...over,
  }
}

/**
 * Records every `users.list` read this page issues, together with the params
 * it was called with.
 *
 * `stubClient`'s own recording lives on the command side (`intents`,
 * `payloads`), because that is what the pre-rewrite page needed. The search
 * and cursor-paging tests below need to see what a *query* was asked with -
 * specifically, whether `cursor` was carried across a new search - so this
 * wraps `query` the same way the harness's own `recordingCommandClient` wraps
 * `command`.
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

describe("AuthUsersPage", () => {
  it("renders a row per user with the fields it was given", async () => {
    const { client } = stubClient({
      "users.list": {
        users: [
          user(),
          user({
            id: "usr_2",
            email: "grace@example.com",
            firstName: "Grace",
            lastName: "Hopper",
            emailVerified: false,
            banned: true,
          }),
        ],
        total: 2,
      },
    })
    renderPage(AuthUsersPage, client)

    expect(await screen.findByText("ada@example.com")).toBeDefined()
    expect(screen.getByText("grace@example.com")).toBeDefined()
    expect(screen.getByText("Ada Lovelace")).toBeDefined()
    expect(screen.getByText("Grace Hopper")).toBeDefined()
    expect(screen.getByText("verified")).toBeDefined()
    expect(screen.getByText("unverified")).toBeDefined()
    expect(screen.getByText("active")).toBeDefined()
    expect(screen.getByText("banned")).toBeDefined()
  })

  it("says it is loading rather than rendering a blank pane", () => {
    renderPage(AuthUsersPage, pendingClient())

    const busy = screen.getByRole("status")
    expect(busy.getAttribute("aria-busy")).toBe("true")
    expect(busy.getAttribute("aria-label")).toBe("Loading Users")
  })

  it("shows the contract error code and message when the read fails", async () => {
    renderPage(
      AuthUsersPage,
      failingClient(new ContractError("PERMISSION_DENIED", "users.read required"))
    )

    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toContain("PERMISSION_DENIED")
    expect(alert.textContent).toContain("users.read required")
  })

  it("shows the empty message instead of a headerless table", async () => {
    const { client } = stubClient({ "users.list": { users: [], total: 0 } })
    renderPage(AuthUsersPage, client)

    await waitFor(() => expect(screen.getByText("No users yet.")).toBeDefined())
    expect(screen.queryByRole("table")).toBeNull()
  })
})

const page1 = {
  users: [
    {
      id: "u1",
      email: "ada@example.com",
      emailVerified: true,
      firstName: "Ada",
      lastName: "L",
      banned: false,
      createdAt: "2026-01-01T00:00:00Z",
    },
    {
      id: "u2",
      email: "grace@example.com",
      emailVerified: false,
      banned: true,
      createdAt: "2026-01-02T00:00:00Z",
    },
  ],
  nextCursor: "c1",
  total: 5,
}

describe("AuthUsersPage search and paging", () => {
  it("sends the search term as `email`, and resets to the first page", async () => {
    const { client, queries } = recordingClient({ "users.list": page1 })
    renderPage(AuthUsersPage, client)
    await waitFor(() => expect(screen.getByText("ada@example.com")).toBeTruthy())

    fireEvent.change(screen.getByRole("searchbox", { name: "Search users" }), {
      target: { value: "grace" },
    })

    await waitFor(() =>
      expect(queries.some((q) => q.params?.email === "grace")).toBe(true)
    )
    // A search with a stale cursor would return page two of the old result set.
    const search = queries.find((q) => q.params?.email === "grace")
    expect(search?.params?.cursor).toBeUndefined()
  })

  it("walks forward with the server's cursor and back again", async () => {
    const { client, queries } = recordingClient({ "users.list": page1 })
    renderPage(AuthUsersPage, client)
    await waitFor(() => expect(screen.getByText("ada@example.com")).toBeTruthy())
    expect(screen.getByText(/2 of 5/)).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Next page" }))
    await waitFor(() => expect(queries.some((q) => q.params?.cursor === "c1")).toBe(true))

    fireEvent.click(screen.getByRole("button", { name: "Previous page" }))
    await waitFor(() =>
      expect(queries.filter((q) => q.params?.cursor === undefined).length).toBeGreaterThan(1)
    )
  })
})

describe("AuthUsersPage row actions", () => {
  it("collects a reason and an expiry before banning", async () => {
    const { client, sent } = recordingCommandClient(
      { "users.list": page1 },
      { "users.ban": { ok: true, id: "u1" } }
    )
    renderPage(AuthUsersPage, client)
    await waitFor(() => expect(screen.getByText("ada@example.com")).toBeTruthy())

    fireEvent.click(screen.getByRole("button", { name: "Ban ada@example.com" }))
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "spam" } })
    fireEvent.change(screen.getByLabelText("Expires at"), {
      target: { value: "2026-12-01T00:00" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Ban" }))

    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0].intent).toBe("users.ban")
    expect(sent[0].payload).toMatchObject({ id: "u1", reason: "spam" })
    expect((sent[0].payload as { expiresAt?: string }).expiresAt).toBeTruthy()
  })

  it("bans indefinitely when no expiry is given, rather than sending an empty string", async () => {
    const { client, sent } = recordingCommandClient(
      { "users.list": page1 },
      { "users.ban": { ok: true } }
    )
    renderPage(AuthUsersPage, client)
    await waitFor(() => expect(screen.getByText("ada@example.com")).toBeTruthy())

    fireEvent.click(screen.getByRole("button", { name: "Ban ada@example.com" }))
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "spam" } })
    fireEvent.click(screen.getByRole("button", { name: "Ban" }))

    await waitFor(() => expect(sent).toHaveLength(1))
    // The contract says empty means indefinite, and the store keys an absent
    // key the same as an undefined one, so omitting it is the honest form.
    expect(sent[0].payload).toEqual({ id: "u1", reason: "spam" })
  })

  it("offers unban on a banned user and ban on an active one, never both", async () => {
    const { client } = stubClient({ "users.list": page1 })
    renderPage(AuthUsersPage, client)
    await waitFor(() => expect(screen.getByText("ada@example.com")).toBeTruthy())

    expect(screen.getByRole("button", { name: "Ban ada@example.com" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Unban ada@example.com" })).toBeNull()
    expect(screen.getByRole("button", { name: "Unban grace@example.com" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Ban grace@example.com" })).toBeNull()
  })

  it("unbans immediately, with no confirmation dialog", async () => {
    // Unban restores access. The worst outcome of a mis-click is that
    // somebody can sign in again, so it skips the confirm step that ban and
    // delete both require.
    const { client, sent } = recordingCommandClient(
      { "users.list": page1 },
      { "users.unban": { ok: true, id: "u2" } }
    )
    renderPage(AuthUsersPage, client)
    // Not `getByText("grace@example.com")`: grace has no name on file, so
    // `displayName` falls back to the email and it legitimately renders
    // twice in her row (Email column and Name column).
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Unban grace@example.com" })).toBeTruthy()
    )

    fireEvent.click(screen.getByRole("button", { name: "Unban grace@example.com" }))

    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toEqual({ intent: "users.unban", payload: { id: "u2" } })
    expect(screen.queryByRole("alertdialog")).toBeNull()
  })

  it("shows the server's reason and leaves the ban dialog open when the ban fails", async () => {
    const { client } = recordingCommandClient(
      { "users.list": page1 },
      { "users.ban": new ContractError("VALIDATION", "reason is required") }
    )
    renderPage(AuthUsersPage, client)
    await waitFor(() => expect(screen.getByText("ada@example.com")).toBeTruthy())

    fireEvent.click(screen.getByRole("button", { name: "Ban ada@example.com" }))
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "spam" } })
    fireEvent.click(screen.getByRole("button", { name: "Ban" }))

    // `{ hidden: true }`: the open AlertDialog marks the rest of the page
    // `aria-hidden`, and testing-library's role queries respect that by
    // default. The alert is still there, just outside the current modal's
    // accessibility tree.
    const alert = await screen.findByRole("alert", { hidden: true })
    expect(alert.textContent).toContain("Could not ban")
    expect(alert.textContent).toContain("reason is required")
    // The dialog stays open: the operator's typed reason is not thrown away
    // by a failed attempt.
    expect(screen.getByLabelText("Reason")).toBeTruthy()
  })

  it("names the user in the delete confirmation, because a delete is not undoable", async () => {
    const { client, sent } = recordingCommandClient(
      { "users.list": page1 },
      { "users.delete": { ok: true } }
    )
    renderPage(AuthUsersPage, client)
    await waitFor(() => expect(screen.getByText("ada@example.com")).toBeTruthy())

    fireEvent.click(screen.getByRole("button", { name: "Delete ada@example.com" }))
    expect(screen.getByText(/Delete ada@example.com\?/)).toBeTruthy()
    expect(sent).toHaveLength(0)

    fireEvent.click(screen.getByRole("button", { name: "Delete" }))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toEqual({ intent: "users.delete", payload: { id: "u1" } })
  })

  // A source-reading test for the absence of `refetch(` was dropped here.
  // This package's tsconfig carries no "node" types and no @types/node
  // dependency - `tsc --noEmit` fails on `import("node:fs")` with
  // TS2591, even though the read itself works fine under vitest's esbuild
  // transform. Per the brief: dropped, and flagged for Task 11's
  // verification pass to re-check by other means (e.g. reading the built
  // source without a typed Node import, or a repo-wide grep step outside
  // the typechecked package).
})
