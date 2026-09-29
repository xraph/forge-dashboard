import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import type { ScopedClient } from "@forge-go/dashboard-plugin"
import { WardenAssignmentsPage } from "../src/pages/assignments"
import {
  failingClient,
  recordingCommandClient,
  recordingQueryClient,
  renderPage,
  stubClient,
} from "./harness"

// Three rows, one per state that matters. `gone` lapsed in the past and the
// server says so; `soon` expires far in the future; `forever` has no expiry.
// Each holds a different role so a slug appears once and can be found by text.
const ASSIGNMENTS = {
  items: [
    {
      id: "asg_gone",
      namespacePath: "eng/platform",
      roleId: "role_auditor",
      roleSlug: "auditor",
      roleName: "Auditor",
      subjectKind: "user",
      subjectId: "gone",
      resourceType: "document",
      resourceId: "d-9",
      expiresAt: "2020-01-01T00:00:00Z",
      expired: true,
      grantedBy: "admin",
      createdAt: "2019-12-01T00:00:00Z",
    },
    {
      id: "asg_soon",
      namespacePath: "",
      roleId: "role_reader",
      roleSlug: "reader",
      roleName: "Reader",
      subjectKind: "api_key",
      subjectId: "soon",
      expiresAt: "2099-01-01T00:00:00Z",
      expired: false,
      createdAt: "2026-09-01T00:00:00Z",
    },
    {
      id: "asg_forever",
      namespacePath: "",
      roleId: "role_admin",
      roleSlug: "admin",
      roleName: "Admin",
      subjectKind: "service",
      subjectId: "forever",
      expired: false,
      createdAt: "2026-09-01T00:00:00Z",
    },
  ],
  total: 3,
  limit: 25,
  offset: 0,
}

const EMPTY = { items: [], total: 0, limit: 25, offset: 0 }

const ROLES = {
  items: [
    { id: "role_reader", slug: "reader", name: "Reader", namespacePath: "" },
    { id: "role_auditor", slug: "auditor", name: "Auditor", namespacePath: "" },
  ],
  total: 2,
  limit: 200,
  offset: 0,
}

const NAMESPACES = { namespaces: ["", "eng/platform"] }

function answers(extra = {}) {
  return {
    "assignments.list": ASSIGNMENTS,
    "roles.list": ROLES,
    "namespaces.list": NAMESPACES,
    ...extra,
  }
}

function client(extra = {}, commands = {}) {
  return stubClient(answers(extra), commands)
}

async function rowOf(subject: string) {
  return (await screen.findByText(subject)).closest("tr")!
}

/** A client that reads normally and refuses every command with `error`. */
function refusingCommands(error: ContractError): ScopedClient {
  return { ...client(), command: async () => { throw error } } as ScopedClient
}

async function openCreate() {
  await screen.findByText("user:gone")
  fireEvent.click(screen.getByRole("button", { name: /new assignment/i }))
  return within(await screen.findByRole("alertdialog"))
}

function fillRequired(dialog: ReturnType<typeof within>) {
  fireEvent.change(dialog.getByLabelText("Role"), { target: { value: "role_reader" } })
  fireEvent.change(dialog.getByLabelText("Subject id"), { target: { value: "ada" } })
}

describe("WardenAssignmentsPage", () => {
  it("lists assignments with the server's total in the caption", async () => {
    // total 60 against three rows on screen: the caption counts the set, not
    // the page.
    renderPage(
      WardenAssignmentsPage,
      client({ "assignments.list": { ...ASSIGNMENTS, total: 60 } })
    )
    expect(await screen.findByText("user:gone")).toBeTruthy()
    expect(await screen.findByText(/60 assignments/)).toBeTruthy()
  })

  it("renders each subject as kind:id", async () => {
    renderPage(WardenAssignmentsPage, client())
    expect(await screen.findByText("api_key:soon")).toBeTruthy()
    expect(screen.getByText("service:forever")).toBeTruthy()
  })

  it("marks an expired assignment as granting nothing", async () => {
    // The whole reason this page exists in this shape. The engine filters
    // expired assignments when it resolves roles, so an expired row grants
    // nothing, but the listing does not filter them. A row shown plainly
    // would tell an operator somebody has access they do not have.
    renderPage(WardenAssignmentsPage, client())
    const row = await rowOf("user:gone")
    const badge = within(row).getByText(/expired/i)
    expect(badge.getAttribute("data-slot")).toBe("badge")
    expect(badge.textContent).toBe("Expired")
  })

  it("does not mark a future expiry or a permanent binding", async () => {
    renderPage(WardenAssignmentsPage, client())
    const soon = await rowOf("api_key:soon")
    expect(within(soon).queryByText(/expired/i)).toBeNull()
    const forever = await rowOf("service:forever")
    expect(within(forever).queryByText(/expired/i)).toBeNull()
  })

  it("badges only the exception: one badge on the page, none on live rows", async () => {
    // Most assignments are live, so a badge on each would be noise that hides
    // the row somebody is scanning for.
    renderPage(WardenAssignmentsPage, client())
    const table = await screen.findByRole("table")
    await screen.findByText("user:gone")
    expect(table.querySelectorAll('[data-slot="badge"]')).toHaveLength(1)
  })

  it("says a live assignment is active to a screen reader, without a badge", async () => {
    renderPage(WardenAssignmentsPage, client())
    const soon = await rowOf("api_key:soon")
    const active = within(soon).getByText("Active")
    expect(active.getAttribute("data-slot")).toBeNull()
    expect(active.className).toContain("sr-only")
  })

  it("shows a permanent binding as permanent rather than blank", async () => {
    // A blank expiry cell reads as "still loading" or "broken", and is
    // silent to a screen reader.
    renderPage(WardenAssignmentsPage, client())
    const forever = await rowOf("service:forever")
    expect(within(forever).getByText(/never/i)).toBeTruthy()
  })

  it("shows a date, not the word Never, when there is an expiry", async () => {
    renderPage(WardenAssignmentsPage, client())
    const soon = await rowOf("api_key:soon")
    expect(within(soon).queryByText(/never/i)).toBeNull()
    const gone = await rowOf("user:gone")
    expect(within(gone).queryByText(/never/i)).toBeNull()
  })

  it("names the role by slug, not by id, and links to it", async () => {
    renderPage(WardenAssignmentsPage, client())
    const link = await screen.findByText("reader")
    expect(link.closest("a")?.getAttribute("href")).toBe("/roles/role_reader")
    expect(screen.queryByText(/^role_/)).toBeNull()
  })

  it("falls back to the role id when the server could not resolve a slug", async () => {
    renderPage(
      WardenAssignmentsPage,
      client({
        "assignments.list": {
          ...ASSIGNMENTS,
          items: [{ ...ASSIGNMENTS.items[1], roleSlug: "", roleName: "" }],
          total: 1,
        },
      })
    )
    const link = await screen.findByText("role_reader")
    expect(link.closest("a")?.getAttribute("href")).toBe("/roles/role_reader")
  })

  it("shows the scope when there is one and a labelled dash when there is not", async () => {
    renderPage(WardenAssignmentsPage, client())
    const gone = await rowOf("user:gone")
    expect(within(gone).getByText("document:d-9")).toBeTruthy()
    const soon = await rowOf("api_key:soon")
    expect(within(soon).getByLabelText("no scope")).toBeTruthy()
  })

  it("renders the tenant root as a slash and a real path as itself", async () => {
    renderPage(WardenAssignmentsPage, client())
    const table = within(await screen.findByRole("table"))
    await screen.findByText("user:gone")
    expect(table.getAllByText("/").length).toBeGreaterThan(0)
    expect(table.getByText("eng/platform")).toBeTruthy()
    expect(table.queryByText("root")).toBeNull()
  })

  it("says which kind of empty an empty list is, and still counts", async () => {
    renderPage(WardenAssignmentsPage, client({ "assignments.list": EMPTY }))
    expect(await screen.findByText(/0 assignments/)).toBeTruthy()
    expect(await screen.findByText("No assignments yet.")).toBeTruthy()
    fireEvent.change(screen.getByLabelText("Namespace"), { target: { value: "eng/platform" } })
    expect(await screen.findByText("No assignments in eng/platform.")).toBeTruthy()
    expect(screen.queryByText("No assignments yet.")).toBeNull()
    fireEvent.change(screen.getByLabelText("Namespace"), { target: { value: "" } })
    expect(await screen.findByText("No assignments in the tenant root.")).toBeTruthy()
  })

  it("offers no edit control, and says why", async () => {
    // assignment.Store exposes no update, so there is nothing to offer. The
    // page says so rather than leaving the absence unexplained.
    renderPage(WardenAssignmentsPage, client())
    await screen.findByText("user:gone")
    expect(screen.queryByRole("button", { name: /edit/i })).toBeNull()
    expect(screen.queryByRole("link", { name: /edit/i })).toBeNull()
    expect(screen.getByText(/cannot be edited, only created and deleted/i)).toBeTruthy()
    expect(screen.getByText(/store has no update/i)).toBeTruthy()
  })

  it("surfaces a list failure instead of rendering an empty table", async () => {
    renderPage(
      WardenAssignmentsPage,
      failingClient(new ContractError("PERMISSION_DENIED", "no tenant in scope"))
    )
    expect(await screen.findAllByText(/no tenant in scope/i)).toBeTruthy()
    expect(screen.queryByText("user:gone")).toBeNull()
  })

  it("sends the namespace filter as an absent field for all namespaces", async () => {
    const { client: c, sent } = recordingQueryClient(answers())
    renderPage(WardenAssignmentsPage, c)
    await screen.findByText("user:gone")
    const list = sent.find((q) => q.intent === "assignments.list")
    expect(list).toBeTruthy()
    expect(list?.params as Record<string, unknown>).toEqual({ limit: 25, offset: 0 })
  })

  it("resets paging when the namespace filter changes", async () => {
    const { client: c, sent } = recordingQueryClient(
      answers({ "assignments.list": { ...ASSIGNMENTS, total: 60 } })
    )
    renderPage(WardenAssignmentsPage, c)
    await screen.findByText("user:gone")
    fireEvent.click(screen.getByRole("button", { name: /next page/i }))
    await waitFor(() =>
      expect(
        sent.some(
          (q) => q.intent === "assignments.list" && (q.params as { offset?: number }).offset === 25
        )
      ).toBe(true)
    )

    fireEvent.change(screen.getByLabelText("Namespace"), { target: { value: "eng/platform" } })
    await waitFor(() => {
      const last = sent.filter((q) => q.intent === "assignments.list").at(-1)
      expect(last?.params).toMatchObject({ namespacePath: "eng/platform", offset: 0 })
    })
  })

  describe("creating", () => {
    it("does not fetch the role list until the dialog opens", async () => {
      const { client: c, sent } = recordingQueryClient(answers())
      renderPage(WardenAssignmentsPage, c)
      await screen.findByText("user:gone")
      expect(sent.some((q) => q.intent === "roles.list")).toBe(false)
      fireEvent.click(screen.getByRole("button", { name: /new assignment/i }))
      await waitFor(() => expect(sent.some((q) => q.intent === "roles.list")).toBe(true))
    })

    it("offers the roles by slug and sends the id", async () => {
      renderPage(WardenAssignmentsPage, client())
      const dialog = await openCreate()
      const select = (await dialog.findByLabelText("Role")) as HTMLSelectElement
      await waitFor(() => expect(within(select).getByText("reader")).toBeTruthy())
      const options = Array.from(select.options).map((o) => [o.value, o.textContent])
      expect(options).toContainEqual(["role_reader", "reader"])
      expect(options).toContainEqual(["role_auditor", "auditor"])
    })

    it("offers subject kind as a select over the closed set, not free text", async () => {
      // The server compares the kind verbatim, so a typo stores an
      // assignment that no check will ever match.
      renderPage(WardenAssignmentsPage, client())
      const dialog = await openCreate()
      const kind = dialog.getByLabelText("Subject kind") as HTMLSelectElement
      expect(kind.tagName).toBe("SELECT")
      expect(Array.from(kind.options).map((o) => o.value)).toEqual([
        "user",
        "api_key",
        "service",
        "service_acct",
      ])
    })

    it("waits for a role and a subject id before it can be confirmed", async () => {
      renderPage(WardenAssignmentsPage, client())
      const dialog = await openCreate()
      const confirm = dialog.getByRole("button", { name: /^create assignment$/i }) as HTMLButtonElement
      expect(confirm.disabled).toBe(true)
      await waitFor(() => expect(within(dialog.getByLabelText("Role")).getByText("reader")).toBeTruthy())
      fireEvent.change(dialog.getByLabelText("Role"), { target: { value: "role_reader" } })
      expect(confirm.disabled).toBe(true)
      fireEvent.change(dialog.getByLabelText("Subject id"), { target: { value: "   " } })
      expect(confirm.disabled).toBe(true)
      fireEvent.change(dialog.getByLabelText("Subject id"), { target: { value: "ada" } })
      expect(confirm.disabled).toBe(false)
    })

    it("sends the exact create payload, every field the form collects", async () => {
      const { client: c, sent } = recordingCommandClient(answers(), {
        "assignments.create": { id: "asg_new" },
      })
      renderPage(WardenAssignmentsPage, c)
      // Filter to a namespace first: the create lands in the one on screen.
      await screen.findByText("user:gone")
      fireEvent.change(screen.getByLabelText("Namespace"), { target: { value: "eng/platform" } })
      const dialog = await openCreate()
      await waitFor(() => expect(within(dialog.getByLabelText("Role")).getByText("auditor")).toBeTruthy())
      fireEvent.change(dialog.getByLabelText("Role"), { target: { value: "role_auditor" } })
      fireEvent.change(dialog.getByLabelText("Subject kind"), { target: { value: "service_acct" } })
      fireEvent.change(dialog.getByLabelText("Subject id"), { target: { value: "  ci-runner " } })
      fireEvent.change(dialog.getByLabelText(/Resource type/), { target: { value: " document " } })
      fireEvent.change(dialog.getByLabelText(/Resource id/), { target: { value: " d-42 " } })
      fireEvent.change(dialog.getByLabelText(/Expires/), { target: { value: "2031-01-15T10:30" } })
      fireEvent.click(dialog.getByRole("button", { name: /^create assignment$/i }))

      await waitFor(() => expect(sent).toHaveLength(1))
      expect(sent[0]?.intent).toBe("assignments.create")
      const payload = sent[0]?.payload as Record<string, unknown>
      // The instant, checked against the wall-clock time typed rather than
      // against the code's own formatting: 10:30 local on that date.
      expect(new Date(payload.expiresAt as string).getTime()).toBe(
        new Date(2031, 0, 15, 10, 30).getTime()
      )
      expect(payload.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
      expect(payload).toEqual({
        roleId: "role_auditor",
        subjectKind: "service_acct",
        subjectId: "ci-runner",
        namespacePath: "eng/platform",
        resourceType: "document",
        resourceId: "d-42",
        expiresAt: payload.expiresAt,
      })
    })

    it("leaves unset optional fields out of the payload rather than sending empty strings", async () => {
      const { client: c, sent } = recordingCommandClient(answers(), {
        "assignments.create": { id: "asg_new" },
      })
      renderPage(WardenAssignmentsPage, c)
      const dialog = await openCreate()
      await waitFor(() => expect(within(dialog.getByLabelText("Role")).getByText("reader")).toBeTruthy())
      fillRequired(dialog)
      fireEvent.click(dialog.getByRole("button", { name: /^create assignment$/i }))

      await waitFor(() => expect(sent).toHaveLength(1))
      const payload = sent[0]?.payload as Record<string, unknown>
      // toEqual ignores undefined-valued keys, so also assert the keys
      // themselves are missing: "" and absent are different values to a
      // server that parses expiresAt.
      expect(payload).toEqual({
        roleId: "role_reader",
        subjectKind: "user",
        subjectId: "ada",
        namespacePath: "",
      })
      expect(Object.keys(payload).sort()).toEqual([
        "namespacePath",
        "roleId",
        "subjectId",
        "subjectKind",
      ])
    })

    it("closes the dialog once the create succeeds", async () => {
      const { client: c, sent } = recordingCommandClient(answers(), {
        "assignments.create": { id: "asg_new" },
      })
      renderPage(WardenAssignmentsPage, c)
      const dialog = await openCreate()
      await waitFor(() => expect(within(dialog.getByLabelText("Role")).getByText("reader")).toBeTruthy())
      fillRequired(dialog)
      fireEvent.click(dialog.getByRole("button", { name: /^create assignment$/i }))
      await waitFor(() => expect(sent).toHaveLength(1))
      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    })

    it("shows the member-cap refusal inside the dialog and keeps what was typed", async () => {
      // The cap is a CONFLICT from the real server. The dialog must stay open
      // and carry the message, because Base UI makes everything outside an
      // open dialog inert.
      renderPage(
        WardenAssignmentsPage,
        refusingCommands(
          new ContractError("CONFLICT", '"reader" is capped at 2 members and already has 2')
        )
      )
      const dialog = await openCreate()
      await waitFor(() => expect(within(dialog.getByLabelText("Role")).getByText("reader")).toBeTruthy())
      fillRequired(dialog)
      fireEvent.click(dialog.getByRole("button", { name: /^create assignment$/i }))

      const alert = await dialog.findByRole("alert")
      expect(alert.textContent).toContain("capped at 2 members and already has 2")
      expect(alert.textContent).toContain("CONFLICT")
      expect(screen.getByRole("alertdialog")).toBeTruthy()
      expect((dialog.getByLabelText("Subject id") as HTMLInputElement).value).toBe("ada")
      expect((dialog.getByLabelText("Role") as HTMLSelectElement).value).toBe("role_reader")
    })

    it("clears an earlier refusal when the dialog is opened again", async () => {
      renderPage(
        WardenAssignmentsPage,
        refusingCommands(new ContractError("CONFLICT", "capped at 2 members and already has 2"))
      )
      const first = await openCreate()
      await waitFor(() => expect(within(first.getByLabelText("Role")).getByText("reader")).toBeTruthy())
      fillRequired(first)
      fireEvent.click(first.getByRole("button", { name: /^create assignment$/i }))
      await first.findByRole("alert")

      fireEvent.click(first.getByRole("button", { name: /^cancel$/i }))
      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())

      const second = await openCreate()
      expect(second.queryByRole("alert")).toBeNull()
      expect((second.getByLabelText("Subject id") as HTMLInputElement).value).toBe("")
    })

    it("shows the create as pending while the command is in flight", async () => {
      const pending = {
        ...client(),
        command: () => new Promise<never>(() => {}),
      } as ScopedClient
      renderPage(WardenAssignmentsPage, pending)
      const dialog = await openCreate()
      await waitFor(() => expect(within(dialog.getByLabelText("Role")).getByText("reader")).toBeTruthy())
      fillRequired(dialog)
      fireEvent.click(dialog.getByRole("button", { name: /^create assignment$/i }))
      const working = (await dialog.findByRole("button", { name: /working/i })) as HTMLButtonElement
      expect(working.disabled).toBe(true)
    })

    it("says so when there are no roles to assign", async () => {
      renderPage(
        WardenAssignmentsPage,
        client({ "roles.list": { items: [], total: 0, limit: 200, offset: 0 } })
      )
      const dialog = await openCreate()
      expect(await dialog.findByText(/no roles exist yet/i)).toBeTruthy()
    })

    it("says so inside the dialog when the role list cannot be loaded", async () => {
      const c = {
        ...client(),
        query: async (intent: string) => {
          if (intent === "roles.list") throw new ContractError("PERMISSION_DENIED", "cannot list roles")
          return answers()[intent as keyof ReturnType<typeof answers>]
        },
      } as ScopedClient
      renderPage(WardenAssignmentsPage, c)
      const dialog = await openCreate()
      expect(await dialog.findByText(/cannot list roles/i)).toBeTruthy()
    })
  })

  describe("deleting", () => {
    it("sends the assignment id, and only the id", async () => {
      const { client: c, sent } = recordingCommandClient(answers(), { "assignments.delete": {} })
      renderPage(WardenAssignmentsPage, c)
      await screen.findByText("api_key:soon")
      fireEvent.click(screen.getByRole("button", { name: "Delete api_key:soon from reader" }))
      fireEvent.click(await screen.findByRole("button", { name: /^Delete$/ }))
      await waitFor(() => expect(sent).toHaveLength(1))
      expect(sent[0]?.intent).toBe("assignments.delete")
      expect(sent[0]?.payload).toEqual({ id: "asg_soon" })
    })

    it("names the subject and the role in the confirmation", async () => {
      renderPage(WardenAssignmentsPage, client())
      await screen.findByText("api_key:soon")
      fireEvent.click(screen.getByRole("button", { name: "Delete api_key:soon from reader" }))
      const dialog = within(await screen.findByRole("alertdialog"))
      expect(dialog.getByText("Delete api_key:soon from reader?")).toBeTruthy()
    })

    it("tells the operator an expired assignment already grants nothing", async () => {
      renderPage(WardenAssignmentsPage, client())
      await screen.findByText("user:gone")
      fireEvent.click(screen.getByRole("button", { name: "Delete user:gone from auditor" }))
      const dialog = within(await screen.findByRole("alertdialog"))
      expect(dialog.getByText(/already expired and grants nothing/i)).toBeTruthy()
    })

    it("shows a refused delete inside the dialog", async () => {
      renderPage(
        WardenAssignmentsPage,
        refusingCommands(new ContractError("NOT_FOUND", "no such assignment"))
      )
      await screen.findByText("api_key:soon")
      fireEvent.click(screen.getByRole("button", { name: "Delete api_key:soon from reader" }))
      const dialog = within(await screen.findByRole("alertdialog"))
      fireEvent.click(dialog.getByRole("button", { name: /^Delete$/ }))
      const alert = await dialog.findByRole("alert")
      expect(alert.textContent).toContain("no such assignment")
    })

    it("steps back a page when a delete empties the last one", async () => {
      const lastPage = {
        ...ASSIGNMENTS,
        items: [ASSIGNMENTS.items[1]],
        total: 26,
        limit: 25,
        offset: 25,
      }
      const { client: c, sent } = recordingQueryClient(answers({ "assignments.list": lastPage }))
      const withDelete = { ...c, command: async () => ({}) } as typeof c
      renderPage(WardenAssignmentsPage, withDelete)
      await screen.findByText("api_key:soon")
      fireEvent.click(screen.getByRole("button", { name: /next page/i }))
      await waitFor(() =>
        expect(
          sent.some(
            (q) => q.intent === "assignments.list" && (q.params as { offset?: number }).offset === 25
          )
        ).toBe(true)
      )
      fireEvent.click(screen.getByRole("button", { name: "Delete api_key:soon from reader" }))
      fireEvent.click(await screen.findByRole("button", { name: /^Delete$/ }))
      await waitFor(() => {
        const last = sent.filter((q) => q.intent === "assignments.list").at(-1)
        expect((last?.params as { offset?: number }).offset).toBe(0)
      })
    })
  })
})
