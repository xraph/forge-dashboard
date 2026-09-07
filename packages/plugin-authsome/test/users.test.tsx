import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { AuthUsersPage } from "../src/pages/users"
import type { UserRecord, UserSummary } from "../src/pages/users"
import { failingClient, pendingClient, renderPage, stubClient } from "./harness"

const START = "2026-09-06T09:00:00.000Z"

function user(over: Partial<UserSummary> = {}): UserSummary {
  return {
    id: "usr_1",
    email: "ada@example.com",
    emailVerified: true,
    firstName: "Ada",
    lastName: "Lovelace",
    username: "ada",
    banned: false,
    createdAt: START,
    ...over,
  }
}

/**
 * A tiny stand-in for the fixture's in-memory auth state: the ban flag lives
 * here, the ban command flips it, and `users.list` reads it at call time. A
 * refetch therefore returns different data from the first read, which is the
 * only way "the list reflected the mutation" can be observed rather than
 * asserted.
 */
function mutableUsers(
  seed: UserSummary[] = [
    user(),
    user({
      id: "usr_2",
      email: "grace@example.com",
      firstName: "Grace",
      lastName: "Hopper",
      username: "grace",
    }),
  ]
) {
  const state = new Map(seed.map((u) => [u.id, { ...u }]))

  return stubClient(
    {
      "users.list": () => ({
        users: [...state.values()].map((u) => ({ ...u })),
        total: state.size,
      }),
      "users.detail": (params?: unknown) => {
        const id = (params as { id?: string } | undefined)?.id
        const found = id ? state.get(id) : undefined
        if (!found) throw new ContractError("NOT_FOUND", `user ${id} not found`)
        return {
          ...found,
          displayName: `${found.firstName} ${found.lastName}`,
          banReason: found.banned ? "spam" : "",
          updatedAt: START,
        } satisfies UserRecord
      },
    },
    {
      "users.ban": (payload?: unknown) => {
        const id = (payload as { id: string }).id
        const found = state.get(id)!
        found.banned = true
        return { ok: true, id }
      },
      "users.unban": (payload?: unknown) => {
        const id = (payload as { id: string }).id
        const found = state.get(id)!
        found.banned = false
        return { ok: true, id }
      },
    }
  )
}

describe("AuthUsersPage", () => {
  it("renders a row per user with the fields it was given", async () => {
    const { client } = mutableUsers()
    renderPage(AuthUsersPage, client)

    expect(await screen.findByText("ada@example.com")).toBeDefined()
    expect(screen.getByText("grace@example.com")).toBeDefined()
    expect(screen.getByText("Ada Lovelace")).toBeDefined()
    expect(screen.getByText("usr_2")).toBeDefined()
    expect(screen.getByText("2 of 2")).toBeDefined()
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
      failingClient(
        new ContractError("PERMISSION_DENIED", "users.read required")
      )
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

  /**
   * Step 3's actual requirement, and the first place in this rewrite where a
   * write and a read have to agree.
   *
   * `useQuery` is not a cache: nothing invalidates on its own. The manifest
   * says `users.ban` invalidates `users.list`, and the only thing that makes
   * that true in a browser is the page calling `refetch` after the command
   * succeeds. So this asserts two separate facts - the list was read a second
   * time, and what came back the second time is what is now on screen. Delete
   * the `list.refetch()` in `src/pages/users.tsx` and both fail: the row keeps
   * saying "active" and only one `users.list` is ever recorded.
   */
  it("refetches the list after a successful ban, and the row changes", async () => {
    const { client, intents, payloads } = mutableUsers()
    renderPage(AuthUsersPage, client)

    const banButton = await screen.findByRole("button", {
      name: "Ban ada@example.com",
    })
    // Two rows, both active before the mutation.
    expect(screen.getAllByText("active")).toHaveLength(2)

    fireEvent.click(banButton)

    expect(
      await screen.findByRole("button", { name: "Unban ada@example.com" })
    ).toBeDefined()
    expect(screen.getByText("banned")).toBeDefined()
    expect(screen.getAllByText("active")).toHaveLength(1)

    expect(payloads).toEqual([
      { intent: "users.ban", payload: { id: "usr_1" } },
    ])
    expect(intents).toEqual(["users.list", "users.ban", "users.list"])
  })

  it("unbans through the other command, and refetches the same way", async () => {
    const { client, intents, payloads } = mutableUsers([user({ banned: true })])
    renderPage(AuthUsersPage, client)

    fireEvent.click(
      await screen.findByRole("button", { name: "Unban ada@example.com" })
    )

    expect(
      await screen.findByRole("button", { name: "Ban ada@example.com" })
    ).toBeDefined()
    expect(payloads).toEqual([
      { intent: "users.unban", payload: { id: "usr_1" } },
    ])
    expect(intents).toEqual(["users.list", "users.unban", "users.list"])
  })

  /**
   * The other half of the invalidation. A refetch that fires whether or not
   * the command worked would still pass the test above, so this pins the gate:
   * a failed ban shows the server's reason and leaves the list alone.
   */
  it("does not refetch when the ban fails, and shows the reason", async () => {
    const { client, intents } = stubClient(
      { "users.list": { users: [user()], total: 1 } },
      {
        "users.ban": new ContractError(
          "PERMISSION_DENIED",
          "users.ban required"
        ),
      }
    )
    renderPage(AuthUsersPage, client)

    fireEvent.click(
      await screen.findByRole("button", { name: "Ban ada@example.com" })
    )

    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toContain("Ban failed")
    expect(alert.textContent).toContain("users.ban required")
    expect(intents).toEqual(["users.list", "users.ban"])
  })

  it("reads users.detail only once a row is selected, and re-reads it after a ban", async () => {
    const { client, intents } = mutableUsers([user()])
    renderPage(AuthUsersPage, client)

    await screen.findByText("ada@example.com")
    // Nothing selected yet, so no detail read has gone out with an undefined
    // id. That is what mounting the detail hook lazily buys.
    expect(intents).toEqual(["users.list"])

    fireEvent.click(screen.getByRole("button", { name: "Details" }))
    expect(await screen.findByText("User detail")).toBeDefined()
    expect(intents).toEqual(["users.list", "users.detail"])

    fireEvent.click(screen.getByRole("button", { name: "Ban ada@example.com" }))
    await waitFor(() =>
      expect(intents.filter((i) => i === "users.detail")).toHaveLength(2)
    )
    // The manifest declares both invalidations; both happened.
    expect(intents.filter((i) => i === "users.list")).toHaveLength(2)
    await waitFor(() => expect(screen.getByText("spam")).toBeDefined())
  })
})
