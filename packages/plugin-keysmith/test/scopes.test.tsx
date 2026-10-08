import { describe, expect, it } from "vitest"
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ContractError, queryStore } from "@forge-go/dashboard-plugin"
import type { ScopedClient } from "@forge-go/dashboard-plugin"
import { ScopesPage } from "../src/pages/scopes"
import type { ScopesList, ScopeSummary } from "../src/types"
import {
  failingClient,
  recordingCommandClient,
  recordingQueryClient,
  renderPage,
  stubClient,
} from "./harness"

const READ: ScopeSummary = {
  id: "kscp_read",
  name: "read",
  description: "Read anything",
}
const USERS: ScopeSummary = {
  id: "kscp_users",
  name: "read:users",
  parent: "read",
}
const BILLING: ScopeSummary = { id: "kscp_billing", name: "billing" }

function list(scopes: ScopeSummary[], hasMore = false): ScopesList {
  return { scopes, hasMore }
}

const LIST = list([BILLING, READ, USERS])

const PARENTS_LINE =
  "Parents are stored for your application. Keysmith does not use them when matching, so a key with read does not also get read:users."

/** The row whose Name cell is exactly `name`: a parent cell can carry it too. */
function rowFor(name: string): HTMLElement {
  const row = screen
    .getAllByRole("row")
    .find((r) => within(r).queryAllByRole("cell")[0]?.textContent === name)
  if (!row) throw new Error(`no row for ${name}`)
  return row
}

function cells(name: string): HTMLElement[] {
  return within(rowFor(name)).getAllByRole("cell")
}

/** Reads from `answers`, every command refused with `error`. */
function refusingClient(
  answers: Record<string, unknown>,
  error: ContractError
): ScopedClient {
  return {
    ...stubClient(answers),
    command: failingClient(error).command,
  } as ScopedClient
}

async function openCreate() {
  await screen.findByText("billing", { selector: "td, td *" })
  fireEvent.click(screen.getByRole("button", { name: "Create scope" }))
  return screen.findByRole("dialog", { name: "Create scope" })
}

function field(d: HTMLElement, label: string) {
  return within(d).getByLabelText(label) as HTMLInputElement
}

async function openDelete(name: string) {
  fireEvent.click(await screen.findByRole("button", { name: `Delete ${name}` }))
  return screen.findByRole("alertdialog", { name: `Delete ${name}?` })
}

describe("ScopesPage list", () => {
  it("says what parents mean, with the scope names in mono", async () => {
    renderPage(ScopesPage, stubClient({ "scopes.list": LIST }))
    expect(
      await screen.findByRole("heading", { level: 1, name: "Scopes" })
    ).toBeTruthy()
    const line = screen.getByText(
      (_, el) => el?.tagName === "P" && el.textContent === PARENTS_LINE
    )
    const mono = Array.from(line.querySelectorAll(".font-mono"))
    expect(mono.map((el) => el.textContent)).toEqual(["read", "read:users"])
    for (const el of mono) expect(el.className).toMatch(/text-xs/)
  })

  it("asks scopes.list for up to 200, the same params as the pickers", async () => {
    const { client, sent } = recordingQueryClient({ "scopes.list": LIST })
    renderPage(ScopesPage, client)
    await screen.findByText("billing", { selector: "td, td *" })
    expect(
      sent.filter((s) => s.intent === "scopes.list").map((s) => s.params)
    ).toEqual([{ limit: 200 }])
  })

  it("shows a scope with a parent, its name and parent in mono", async () => {
    renderPage(ScopesPage, stubClient({ "scopes.list": LIST }))
    await screen.findByText("billing", { selector: "td, td *" })
    const [name, parent, description] = cells("read:users")
    expect(name.textContent).toBe("read:users")
    expect(name.className).toMatch(/font-mono/)
    expect(name.className).toMatch(/text-xs/)
    expect(parent.textContent).toBe("read")
    expect(parent.className).toMatch(/font-mono/)
    expect(parent.className).toMatch(/text-xs/)
    expect(within(description).getByLabelText("no description")).toBeTruthy()
  })

  it("says a scope with no parent has none, and shows its description", async () => {
    renderPage(ScopesPage, stubClient({ "scopes.list": LIST }))
    await screen.findByText("billing", { selector: "td, td *" })
    const [, parent, description] = cells("read")
    expect(within(parent).getByLabelText("no parent")).toBeTruthy()
    expect(description.textContent).toBe("Read anything")
  })

  it("counts the rows in the caption", async () => {
    renderPage(ScopesPage, stubClient({ "scopes.list": LIST }))
    expect(await screen.findByText("3 scopes")).toBeTruthy()
  })

  it("uses the singular for one scope", async () => {
    renderPage(ScopesPage, stubClient({ "scopes.list": list([READ]) }))
    expect(await screen.findByText("1 scope")).toBeTruthy()
  })

  it("says when it is showing only the first 200", async () => {
    renderPage(ScopesPage, stubClient({ "scopes.list": list([READ], true) }))
    expect(
      await screen.findByText("Showing the first 200 scopes.")
    ).toBeTruthy()
  })

  it("does not say so when the list is complete", async () => {
    renderPage(ScopesPage, stubClient({ "scopes.list": LIST }))
    await screen.findByText("billing", { selector: "td, td *" })
    expect(screen.queryByText("Showing the first 200 scopes.")).toBeNull()
  })

  it("says so when there are no scopes, with a way to create one", async () => {
    renderPage(ScopesPage, stubClient({ "scopes.list": list([]) }))
    const empty = (await screen.findByText("No scopes yet.")).closest(
      "[role=status]"
    )
    expect(empty).not.toBeNull()
    expect(screen.queryByRole("table")).toBeNull()
    fireEvent.click(
      within(empty as HTMLElement).getByRole("button", { name: "Create scope" })
    )
    expect(
      await screen.findByRole("dialog", { name: "Create scope" })
    ).toBeTruthy()
  })

  it("shows the error state with the message when the list fails", async () => {
    renderPage(
      ScopesPage,
      failingClient(new ContractError("INTERNAL", "scope store is down"))
    )
    expect(await screen.findByText(/scope store is down/)).toBeTruthy()
    expect(screen.queryByRole("table")).toBeNull()
    expect(screen.getByRole("button", { name: "Create scope" })).toBeTruthy()
  })
})

describe("ScopesPage create", () => {
  it("offers No parent and every scope as the parent", async () => {
    renderPage(ScopesPage, stubClient({ "scopes.list": LIST }))
    const d = await openCreate()
    const parent = within(d).getByLabelText("Parent") as HTMLSelectElement
    expect(
      Array.from(parent.options).map((o) => [o.value, o.textContent])
    ).toEqual([
      ["", "No parent"],
      ["billing", "billing"],
      ["read", "read"],
      ["read:users", "read:users"],
    ])
    expect(parent.value).toBe("")
    expect(field(d, "Name").className).toMatch(/font-mono/)
  })

  it("sends the trimmed name and description with the chosen parent, then closes", async () => {
    const { client, sent } = recordingCommandClient(
      { "scopes.list": LIST },
      {
        "scopes.create": {
          scope: { id: "kscp_new", name: "billing:read", parent: "billing" },
        },
      }
    )
    renderPage(ScopesPage, client)
    const d = await openCreate()
    fireEvent.change(field(d, "Name"), {
      target: { value: "  billing:read  " },
    })
    fireEvent.change(within(d).getByLabelText("Parent"), {
      target: { value: "billing" },
    })
    fireEvent.change(field(d, "Description"), {
      target: { value: "  Read invoices  " },
    })
    fireEvent.click(within(d).getByRole("button", { name: "Create scope" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(sent).toEqual([
      {
        intent: "scopes.create",
        payload: {
          name: "billing:read",
          parent: "billing",
          description: "Read invoices",
        },
      },
    ])
  })

  it("sends an empty parent for No parent, which the server reads as none", async () => {
    const { client, sent } = recordingCommandClient(
      { "scopes.list": LIST },
      { "scopes.create": { scope: { id: "kscp_new", name: "write" } } }
    )
    renderPage(ScopesPage, client)
    const d = await openCreate()
    fireEvent.change(field(d, "Name"), { target: { value: "write" } })
    fireEvent.click(within(d).getByRole("button", { name: "Create scope" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(sent).toEqual([
      {
        intent: "scopes.create",
        payload: { name: "write", parent: "", description: "" },
      },
    ])
  })

  it("sends once on a double click", async () => {
    const { client, sent } = recordingCommandClient(
      { "scopes.list": LIST },
      { "scopes.create": { scope: { id: "kscp_new", name: "write" } } }
    )
    renderPage(ScopesPage, client)
    const d = await openCreate()
    fireEvent.change(field(d, "Name"), { target: { value: "write" } })
    const go = within(d).getByRole("button", { name: "Create scope" })
    fireEvent.click(go)
    fireEvent.click(go)
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(sent.map((s) => s.intent)).toEqual(["scopes.create"])
  })

  it("asks for a name before sending anything", async () => {
    const { client, sent } = recordingCommandClient({ "scopes.list": LIST })
    renderPage(ScopesPage, client)
    const d = await openCreate()
    fireEvent.change(field(d, "Name"), { target: { value: "   " } })
    fireEvent.click(within(d).getByRole("button", { name: "Create scope" }))
    expect((await within(d).findByRole("alert")).textContent).toBe(
      "name is required"
    )
    expect(field(d, "Name").getAttribute("aria-invalid")).toBe("true")
    expect(sent).toEqual([])
  })

  it.each([
    ["CONFLICT", "a scope with this name already exists", "Name"],
    ["BAD_REQUEST", "name cannot contain spaces", "Name"],
    ["BAD_REQUEST", "description is too long", "Description"],
    ["BAD_REQUEST", "parent is too long", "Parent"],
    [
      "BAD_REQUEST",
      'parent scope "gone" does not exist in this tenant',
      "Parent",
    ],
  ])(
    "shows a %s refusal, %s, as the server words it and marks the field",
    async (code, message, label) => {
      renderPage(
        ScopesPage,
        refusingClient(
          { "scopes.list": LIST },
          new ContractError(code, message)
        )
      )
      const d = await openCreate()
      fireEvent.change(field(d, "Name"), { target: { value: "read" } })
      fireEvent.click(within(d).getByRole("button", { name: "Create scope" }))
      expect((await within(d).findByRole("alert")).textContent).toBe(message)
      expect(within(d).getByLabelText(label).getAttribute("aria-invalid")).toBe(
        "true"
      )
      // Kept, so a retry is one edit away.
      expect(field(d, "Name").value).toBe("read")
      expect(screen.getByRole("dialog", { name: "Create scope" })).toBe(d)
    }
  )

  it("forgets the last error and what was typed when it opens again", async () => {
    renderPage(
      ScopesPage,
      refusingClient(
        { "scopes.list": LIST },
        new ContractError("CONFLICT", "a scope with this name already exists")
      )
    )
    const d = await openCreate()
    fireEvent.change(field(d, "Name"), { target: { value: "read" } })
    fireEvent.click(within(d).getByRole("button", { name: "Create scope" }))
    await within(d).findByRole("alert")
    fireEvent.click(within(d).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())

    fireEvent.click(screen.getByRole("button", { name: "Create scope" }))
    const again = await screen.findByRole("dialog", { name: "Create scope" })
    expect(within(again).queryByRole("alert")).toBeNull()
    expect(field(again, "Name").value).toBe("")
  })
})

describe("ScopesPage create while scopes cannot be loaded", () => {
  it("opens, says so, and still sends a scope with no parent", async () => {
    const sent: { intent: string; payload: unknown }[] = []
    const client = {
      ...failingClient(new ContractError("INTERNAL", "scope store is down")),
      command: async (intent: string, payload?: unknown) => {
        sent.push({ intent, payload })
        return { scope: { id: "kscp_new", name: "write" } }
      },
    } as ScopedClient
    renderPage(ScopesPage, client)
    await screen.findByText(/scope store is down/)
    fireEvent.click(screen.getByRole("button", { name: "Create scope" }))
    const d = await screen.findByRole("dialog", { name: "Create scope" })
    expect(
      await within(d).findByText("Scopes could not be loaded right now.")
    ).toBeTruthy()
    const parent = within(d).getByLabelText("Parent") as HTMLSelectElement
    expect(Array.from(parent.options).map((o) => o.value)).toEqual([""])

    fireEvent.change(field(d, "Name"), { target: { value: "write" } })
    fireEvent.click(within(d).getByRole("button", { name: "Create scope" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(sent).toEqual([
      {
        intent: "scopes.create",
        payload: { name: "write", parent: "", description: "" },
      },
    ])
  })
})

/** Reads from `answers`; every command waits until `release` is called. */
function holdingClient(answers: Record<string, unknown>) {
  const sent: { intent: string; payload: unknown }[] = []
  let release: (answer: unknown) => void = () => {}
  const client = {
    ...stubClient(answers),
    command: (intent: string, payload?: unknown) => {
      sent.push({ intent, payload })
      return new Promise<unknown>((resolve) => {
        release = resolve
      })
    },
  } as ScopedClient
  return { client, sent, release: (answer: unknown) => release(answer) }
}

/** Lets anything a dismissal set going (state, a close) run before looking. */
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50))
  })
}

describe("ScopesPage dialogs while a command is out", () => {
  it("keeps Create scope open on Escape and Cancel until the create lands", async () => {
    const held = holdingClient({ "scopes.list": LIST })
    renderPage(ScopesPage, held.client)
    const d = await openCreate()
    fireEvent.change(field(d, "Name"), { target: { value: "write" } })
    fireEvent.click(within(d).getByRole("button", { name: "Create scope" }))
    await waitFor(() => expect(held.sent).toHaveLength(1))

    fireEvent.keyDown(document.body, { key: "Escape" })
    fireEvent.click(within(d).getByRole("button", { name: "Cancel" }))
    await settle()
    expect(screen.getByRole("dialog", { name: "Create scope" })).toBe(d)
    expect(d.hasAttribute("data-closed")).toBe(false)
    expect(field(d, "Name").value).toBe("write")

    act(() => held.release({ scope: { id: "kscp_new", name: "write" } }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(held.sent).toHaveLength(1)
  })

  it("keeps Delete open on Escape and Cancel until the delete lands", async () => {
    const held = holdingClient({ "scopes.list": LIST })
    renderPage(ScopesPage, held.client)
    const d = await openDelete("read")
    fireEvent.click(within(d).getByRole("button", { name: "Delete" }))
    await waitFor(() => expect(held.sent).toHaveLength(1))

    fireEvent.keyDown(document.body, { key: "Escape" })
    fireEvent.click(within(d).getByRole("button", { name: "Cancel" }))
    await settle()
    expect(screen.getByRole("alertdialog", { name: "Delete read?" })).toBe(d)
    expect(d.hasAttribute("data-closed")).toBe(false)

    act(() => held.release({ id: READ.id }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(held.sent).toEqual([
      { intent: "scopes.delete", payload: { id: READ.id } },
    ])
  })
})

describe("ScopesPage delete", () => {
  const DESCRIPTION = "Every key that holds it loses it. This cannot be undone."

  it("asks first, naming the scope, then sends scopes.delete with its id and closes", async () => {
    const { client, sent } = recordingCommandClient(
      { "scopes.list": LIST },
      { "scopes.delete": { id: READ.id } }
    )
    renderPage(ScopesPage, client)
    const d = await openDelete("read")
    expect(within(d).getByText(DESCRIPTION)).toBeTruthy()
    fireEvent.click(within(d).getByRole("button", { name: "Delete" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(sent).toEqual([
      { intent: "scopes.delete", payload: { id: READ.id } },
    ])
  })

  it("sends once on a double click", async () => {
    const { client, sent } = recordingCommandClient(
      { "scopes.list": LIST },
      { "scopes.delete": { id: READ.id } }
    )
    renderPage(ScopesPage, client)
    const d = await openDelete("read")
    const go = within(d).getByRole("button", { name: "Delete" })
    fireEvent.click(go)
    fireEvent.click(go)
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(sent).toEqual([
      { intent: "scopes.delete", payload: { id: READ.id } },
    ])
  })

  it.each([
    "1 scope names this scope as its parent",
    "3 scopes name this scope as their parent",
    "more than 200 scopes name this scope as their parent",
    "2 policies allow this scope",
  ])(
    "shows the CONFLICT %s in the dialog's body and stays",
    async (message) => {
      renderPage(
        ScopesPage,
        refusingClient(
          { "scopes.list": LIST },
          new ContractError("CONFLICT", message)
        )
      )
      const d = await openDelete("read")
      fireEvent.click(within(d).getByRole("button", { name: "Delete" }))
      const alert = await within(d).findByRole("alert")
      expect(alert.textContent).toBe(message)
      expect(alert.closest("[data-slot=confirm-dialog-body]")).not.toBeNull()
      expect(within(d).getByText(DESCRIPTION).contains(alert)).toBe(false)
      expect(screen.getByRole("alertdialog", { name: "Delete read?" })).toBe(d)
    }
  )

  it("forgets the last error when it opens again", async () => {
    renderPage(
      ScopesPage,
      refusingClient(
        { "scopes.list": LIST },
        new ContractError("CONFLICT", "1 policy allows this scope")
      )
    )
    const d = await openDelete("read")
    fireEvent.click(within(d).getByRole("button", { name: "Delete" }))
    await within(d).findByRole("alert")
    fireEvent.click(within(d).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())

    const again = await openDelete("billing")
    expect(within(again).queryByRole("alert")).toBeNull()
  })
})

/**
 * A client that answers like the host, as in key-detail.test.tsx: a command's
 * `invalidates` reaches `queryStore.invalidate` before its answer comes back,
 * and a refusal invalidates nothing. Every scopes.list read after the first
 * waits until the test releases it, so the test can look at the page while it
 * refetches.
 */
type HostOutcome =
  | { answer: unknown; invalidates: string[]; next: ScopesList }
  | { error: ContractError }

function hostLikeClient(
  first: ScopesList,
  commands: Record<string, HostOutcome | HostOutcome[]>,
  options: { refetchError?: ContractError; next?: ScopesList } = {}
) {
  let current = first
  let reads = 0
  const sent: { intent: string; payload: unknown }[] = []
  const held: (() => void)[] = []
  const client = {
    extension: "keysmith",
    query: (intent: string) => {
      if (intent !== "scopes.list") {
        return Promise.reject(
          new ContractError("NOT_FOUND", `no handler for intent "${intent}"`)
        )
      }
      reads += 1
      if (reads === 1) return Promise.resolve(current)
      const answer = options.next ?? current
      const { refetchError } = options
      return new Promise((resolve, reject) =>
        held.push(() => (refetchError ? reject(refetchError) : resolve(answer)))
      )
    },
    command: async (intent: string, payload?: unknown) => {
      sent.push({ intent, payload })
      const plan = commands[intent]
      const c = Array.isArray(plan) ? plan.shift() : plan
      if (!c)
        throw new ContractError(
          "NOT_FOUND",
          `no handler for command "${intent}"`
        )
      if ("error" in c) throw c.error
      current = c.next
      queryStore.invalidate("keysmith", c.invalidates)
      return c.answer
    },
  } as unknown as ScopedClient
  return {
    client,
    sent,
    releaseReads: () => {
      for (const release of held.splice(0)) release()
    },
  }
}

function loading() {
  return screen.queryByRole("status", { name: "Loading Scopes", hidden: true })
}

describe("ScopesPage dialogs through a refetch", () => {
  const CHILDREN = new ContractError(
    "CONFLICT",
    "1 scope names this scope as its parent"
  )
  const TAKEN = new ContractError(
    "CONFLICT",
    "a scope with this name already exists"
  )

  // Nothing on this page refetches scopes.list under an open dialog by itself
  // when a command is refused, so the test invalidates it directly, as any
  // other command naming scopes.list would (a create in another tab, policies).
  it("keeps the delete dialog, its name and its error through a scopes.list refetch", async () => {
    // The refetch no longer lists the scope: the question keeps its wording.
    const host = hostLikeClient(
      LIST,
      { "scopes.delete": { error: CHILDREN } },
      { next: list([BILLING]) }
    )
    renderPage(ScopesPage, host.client)
    const d = await openDelete("read")
    fireEvent.click(within(d).getByRole("button", { name: "Delete" }))
    expect((await within(d).findByRole("alert")).textContent).toBe(
      CHILDREN.message
    )

    act(() => queryStore.invalidate("keysmith", ["scopes.list"]))
    await waitFor(() => expect(loading()).not.toBeNull())
    const during = screen.getByRole("alertdialog", { name: "Delete read?" })
    expect(within(during).getByRole("alert").textContent).toBe(CHILDREN.message)

    act(() => host.releaseReads())
    await waitFor(() => expect(loading()).toBeNull())
    const after = screen.getByRole("alertdialog", { name: "Delete read?" })
    expect(within(after).getByRole("alert").textContent).toBe(CHILDREN.message)
    expect(host.sent).toEqual([
      { intent: "scopes.delete", payload: { id: READ.id } },
    ])
  })

  it("keeps the create dialog, what was typed and its error through a refetch, then saves", async () => {
    const WRITE: ScopeSummary = {
      id: "kscp_write",
      name: "write",
      parent: "read",
    }
    const host = hostLikeClient(LIST, {
      "scopes.create": [
        { error: TAKEN },
        {
          answer: { scope: WRITE },
          invalidates: ["scopes.list", "overview"],
          next: list([BILLING, READ, USERS, WRITE]),
        },
      ],
    })
    renderPage(ScopesPage, host.client)
    const d = await openCreate()
    fireEvent.change(field(d, "Name"), { target: { value: "write" } })
    fireEvent.change(within(d).getByLabelText("Parent"), {
      target: { value: "read" },
    })
    fireEvent.click(within(d).getByRole("button", { name: "Create scope" }))
    expect((await within(d).findByRole("alert")).textContent).toBe(
      TAKEN.message
    )

    act(() => queryStore.invalidate("keysmith", ["scopes.list"]))
    await waitFor(() => expect(loading()).not.toBeNull())
    const during = screen.getByRole("dialog", { name: "Create scope" })
    expect(field(during, "Name").value).toBe("write")
    expect(
      (within(during).getByLabelText("Parent") as HTMLSelectElement).value
    ).toBe("read")
    expect(within(during).getByRole("alert").textContent).toBe(TAKEN.message)

    act(() => host.releaseReads())
    await waitFor(() => expect(loading()).toBeNull())
    const after = screen.getByRole("dialog", { name: "Create scope" })
    fireEvent.click(within(after).getByRole("button", { name: "Create scope" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    act(() => host.releaseReads())
    expect(
      await screen.findByText("write", { selector: "td, td *" })
    ).toBeTruthy()
    expect(host.sent.map((s) => s.payload)).toEqual([
      { name: "write", parent: "read", description: "" },
      { name: "write", parent: "read", description: "" },
    ])
  })

  it("keeps the chosen parent when a refetch fails and drops the list", async () => {
    const host = hostLikeClient(
      LIST,
      {
        "scopes.create": {
          answer: { scope: { id: "kscp_new", name: "write", parent: "read" } },
          invalidates: ["scopes.list", "overview"],
          next: LIST,
        },
      },
      { refetchError: new ContractError("INTERNAL", "scope store is down") }
    )
    renderPage(ScopesPage, host.client)
    const d = await openCreate()
    fireEvent.change(field(d, "Name"), { target: { value: "write" } })
    fireEvent.change(within(d).getByLabelText("Parent"), {
      target: { value: "read" },
    })

    act(() => queryStore.invalidate("keysmith", ["scopes.list"]))
    await waitFor(() => expect(loading()).not.toBeNull())
    act(() => host.releaseReads())
    await waitFor(() => expect(loading()).toBeNull())
    // The page lost its list and shows its error card.
    expect(screen.queryByRole("table", { hidden: true })).toBeNull()

    const after = screen.getByRole("dialog", { name: "Create scope" })
    const parent = within(after).getByLabelText("Parent") as HTMLSelectElement
    expect(parent.value).toBe("read")
    expect(Array.from(parent.options).map((o) => o.value)).toEqual(["", "read"])
    expect(
      within(after).getByText("Scopes could not be loaded right now.")
    ).toBeTruthy()
    fireEvent.click(within(after).getByRole("button", { name: "Create scope" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(host.sent.map((s) => s.payload)).toEqual([
      { name: "write", parent: "read", description: "" },
    ])
  })
})
