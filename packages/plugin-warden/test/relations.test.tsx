import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import type { ScopedClient } from "@forge-go/dashboard-plugin"
import { WardenRelationsPage } from "../src/pages/relations"
import {
  failingClient,
  recordingCommandClient,
  recordingQueryClient,
  renderPage,
  stubClient,
} from "./harness"

// Three tuples, one per shape that matters. `plain` is an ordinary member
// grant; `userset` names a set (group:eng#member) rather than one subject, so
// its string carries a second relation; `unattributed` has no creator.
const PLAIN = "document:readme#viewer@user:bob"
const USERSET = "document:spec#editor@group:eng#member"
const OTHER = "folder:q3#owner@user:ada"

const RELATIONS = {
  items: [
    {
      id: "rel_plain",
      namespacePath: "",
      objectType: "document",
      objectId: "readme",
      relation: "viewer",
      subjectType: "user",
      subjectId: "bob",
      createdBy: "admin",
      createdAt: "2026-09-01T00:00:00Z",
    },
    {
      id: "rel_userset",
      namespacePath: "eng/platform",
      objectType: "document",
      objectId: "spec",
      relation: "editor",
      subjectType: "group",
      subjectId: "eng",
      subjectRelation: "member",
      createdAt: "2026-09-02T00:00:00Z",
    },
    {
      id: "rel_other",
      namespacePath: "",
      objectType: "folder",
      objectId: "q3",
      relation: "owner",
      subjectType: "user",
      subjectId: "ada",
      createdBy: "admin",
      createdAt: "2026-09-03T00:00:00Z",
    },
  ],
  total: 3,
  limit: 25,
  offset: 0,
}

const EMPTY = { items: [], total: 0, limit: 25, offset: 0 }

const NAMESPACES = { namespaces: ["", "eng/platform"] }

function answers(extra = {}) {
  return {
    "relations.list": RELATIONS,
    "namespaces.list": NAMESPACES,
    ...extra,
  }
}

function client(extra = {}, commands = {}) {
  return stubClient(answers(extra), commands)
}

async function rowOf(tuple: string) {
  return (await screen.findByText(tuple)).closest("tr")!
}

/** A client that reads normally and refuses every command with `error`. */
function refusingCommands(error: ContractError): ScopedClient {
  return { ...client(), command: async () => { throw error } } as ScopedClient
}

async function openCreate() {
  await screen.findByText(PLAIN)
  fireEvent.click(screen.getByRole("button", { name: /new relation/i }))
  return within(await screen.findByRole("alertdialog"))
}

const CREATE = /^create relation$/i

function fill(dialog: ReturnType<typeof within>, values: Record<string, string>) {
  for (const [label, value] of Object.entries(values)) {
    fireEvent.change(dialog.getByLabelText(label), { target: { value } })
  }
}

const FIVE = {
  "Object type": "document",
  "Object id": "readme",
  Relation: "viewer",
  "Subject type": "user",
  "Subject id": "bob",
}

/** The filter inputs, by the label they carry and the wire field they feed. */
const FILTERS: [label: string, field: string][] = [
  ["Object type", "objectType"],
  ["Object id", "objectId"],
  ["Relation", "relation"],
  ["Subject type", "subjectType"],
  ["Subject id", "subjectId"],
  ["Subject relation", "subjectRelation"],
]

function listQueries(sent: { intent: string; params?: unknown }[]) {
  return sent.filter((q) => q.intent === "relations.list")
}

function lastList(sent: { intent: string; params?: unknown }[]) {
  return listQueries(sent).at(-1)?.params as Record<string, unknown> | undefined
}

describe("WardenRelationsPage", () => {
  it("lists relations with the server's total in the caption", async () => {
    // total 60 against three rows on screen: the caption counts the set, not
    // the page.
    renderPage(
      WardenRelationsPage,
      client({ "relations.list": { ...RELATIONS, total: 60 } })
    )
    expect(await screen.findByText(PLAIN)).toBeTruthy()
    expect(await screen.findByText(/60 relations/)).toBeTruthy()
  })

  it("renders a tuple in its Zanzibar form", async () => {
    // document:readme#viewer@user:bob is how this domain is written
    // everywhere else, including warden's own docs and the DSL. Six separate
    // columns would make an operator reassemble it in their head. Exact
    // match: a tuple missing its relation segment must not pass.
    renderPage(WardenRelationsPage, client())
    expect(await screen.findByText(PLAIN)).toBeTruthy()
    expect(screen.getByText(OTHER)).toBeTruthy()
  })

  it("renders a userset subject with its relation, and a plain one without", async () => {
    renderPage(WardenRelationsPage, client())
    expect(await screen.findByText(USERSET)).toBeTruthy()
    // The plain tuple carries no trailing #: an empty subjectRelation must
    // not leak into the string.
    expect((await screen.findByText(PLAIN)).textContent).toBe(PLAIN)
    expect(screen.queryByText(/user:bob#/)).toBeNull()
  })

  it("sets the tuple as a copyable identifier in monospace", async () => {
    renderPage(WardenRelationsPage, client())
    const cell = (await screen.findByText(PLAIN)).closest("td")!
    expect(cell.className).toContain("font-mono")
    expect(cell.className).toContain("text-xs")
    expect(cell.className).toContain("font-medium")
  })

  it("says a tuple is in scope below its namespace, and the filter shows only exact matches", async () => {
    // Tuples DO cascade at check time: warden hands the ancestor chain to
    // every tuple lookup a check makes (engine.go evaluateReBAC,
    // TestReBAC_NamespaceCascade). The list filter is exact-match. The page
    // once said tuples do not cascade, which told an operator a parent's
    // tuple grants nothing in a child when it does. That must not return.
    renderPage(WardenRelationsPage, client())
    await screen.findByText(PLAIN)
    const text = document.body.textContent ?? ""
    expect(text).toContain(
      "A tuple is in scope for checks in its own namespace and in every namespace below it, the same way roles and policies are."
    )
    expect(text).toContain(
      "Filtering by namespace shows only the tuples stored in exactly that namespace, so tuples stored in a parent namespace are not listed under it, although they are in scope there too."
    )
    expect(screen.queryByText(/does not cascade/i)).toBeNull()
    expect(screen.queryByText(/not in scope for a check in a child/i)).toBeNull()
  })

  it("offers no edit control, and says why", async () => {
    // relation.Store exposes no update, so there is nothing to offer. The
    // page says so rather than leaving the absence unexplained.
    renderPage(WardenRelationsPage, client())
    await screen.findByText(PLAIN)
    // \bedit\b, not /edit/: a tuple with an "editor" relation is not an
    // edit control.
    expect(screen.queryByRole("button", { name: /\bedit\b/i })).toBeNull()
    expect(screen.queryByRole("link", { name: /\bedit\b/i })).toBeNull()
    expect(screen.getByText(/cannot be edited, only created and deleted/i)).toBeTruthy()
    expect(screen.getByText(/store has no update/i)).toBeTruthy()
  })

  it("shows the creator when there is one and a labelled dash when there is not", async () => {
    renderPage(WardenRelationsPage, client())
    const plain = await rowOf(PLAIN)
    expect(within(plain).getByText("admin")).toBeTruthy()
    const userset = await rowOf(USERSET)
    expect(within(userset).getByLabelText("no creator")).toBeTruthy()
  })

  it("renders the tenant root as a slash and a real path as itself", async () => {
    renderPage(WardenRelationsPage, client())
    const table = within(await screen.findByRole("table"))
    await screen.findByText(PLAIN)
    expect(table.getAllByText("/").length).toBeGreaterThan(0)
    expect(table.getByText("eng/platform")).toBeTruthy()
    expect(table.queryByText("root")).toBeNull()
  })

  it("says which kind of empty an empty list is, and still counts", async () => {
    renderPage(WardenRelationsPage, client({ "relations.list": EMPTY }))
    expect(await screen.findByText(/0 relations/)).toBeTruthy()
    expect(await screen.findByText("No relations yet.")).toBeTruthy()
    fireEvent.change(screen.getByLabelText("Namespace"), { target: { value: "eng/platform" } })
    expect(await screen.findByText("No relations in eng/platform.")).toBeTruthy()
    expect(screen.queryByText("No relations yet.")).toBeNull()
    fireEvent.change(screen.getByLabelText("Namespace"), { target: { value: "" } })
    expect(await screen.findByText("No relations in the tenant root.")).toBeTruthy()
  })

  it("names the tuple pattern when a filter matched nothing", async () => {
    // A part filter that excludes everything is a third kind of empty. "No
    // relations yet" under it would say nothing exists when something does.
    renderPage(WardenRelationsPage, client({ "relations.list": EMPTY }))
    await screen.findByText("No relations yet.")
    fireEvent.change(screen.getByLabelText("Subject id"), { target: { value: "bob" } })
    expect(await screen.findByText(/No relations match “\*:\*#\*@\*:bob”\./)).toBeTruthy()
    expect(screen.queryByText("No relations yet.")).toBeNull()

    fireEvent.change(screen.getByLabelText("Object type"), { target: { value: "document" } })
    fireEvent.change(screen.getByLabelText("Subject relation"), { target: { value: "member" } })
    expect(
      await screen.findByText(/No relations match “document:\*#\*@\*:bob#member”\./)
    ).toBeTruthy()
  })

  it("surfaces a list failure instead of rendering an empty table", async () => {
    renderPage(
      WardenRelationsPage,
      failingClient(new ContractError("PERMISSION_DENIED", "no tenant in scope"))
    )
    expect(await screen.findAllByText(/no tenant in scope/i)).toBeTruthy()
    expect(screen.queryByText(PLAIN)).toBeNull()
  })

  describe("filtering", () => {
    it("sends no filter field at all until one is set", async () => {
      const { client: c, sent } = recordingQueryClient(answers())
      renderPage(WardenRelationsPage, c)
      await screen.findByText(PLAIN)
      const params = lastList(sent)
      expect(params).toEqual({ limit: 25, offset: 0 })
      // toEqual ignores undefined-valued keys, so assert the keys too.
      expect(Object.keys(params ?? {}).sort()).toEqual(["limit", "offset"])
    })

    it.each(FILTERS)(
      "sends the %s filter to the server and goes back to the first page",
      async (label, field) => {
        const { client: c, sent } = recordingQueryClient(
          answers({ "relations.list": { ...RELATIONS, total: 60 } })
        )
        renderPage(WardenRelationsPage, c)
        await screen.findByText(PLAIN)
        fireEvent.click(screen.getByRole("button", { name: /next page/i }))
        await waitFor(() => expect(lastList(sent)?.offset).toBe(25))

        // Padded, to pin that the wire carries the trimmed value.
        fireEvent.change(screen.getByLabelText(label), { target: { value: "  x1  " } })
        await waitFor(() => expect(lastList(sent)).toEqual({ [field]: "x1", limit: 25, offset: 0 }))

        // Clearing it takes the field back off the wire rather than sending "".
        fireEvent.change(screen.getByLabelText(label), { target: { value: "" } })
        await waitFor(() => expect(Object.keys(lastList(sent) ?? {}).sort()).toEqual(["limit", "offset"]))
      }
    )

    it("sends the parts together when several are set", async () => {
      const { client: c, sent } = recordingQueryClient(answers())
      renderPage(WardenRelationsPage, c)
      await screen.findByText(PLAIN)
      fireEvent.change(screen.getByLabelText("Object type"), { target: { value: "document" } })
      fireEvent.change(screen.getByLabelText("Subject type"), { target: { value: "user" } })
      fireEvent.change(screen.getByLabelText("Subject id"), { target: { value: "bob" } })
      await waitFor(() =>
        expect(lastList(sent)).toEqual({
          objectType: "document",
          subjectType: "user",
          subjectId: "bob",
          limit: 25,
          offset: 0,
        })
      )
    })

    it("combines a part filter with the namespace filter", async () => {
      const { client: c, sent } = recordingQueryClient(answers())
      renderPage(WardenRelationsPage, c)
      await screen.findByText(PLAIN)
      fireEvent.change(screen.getByLabelText("Namespace"), { target: { value: "eng/platform" } })
      fireEvent.change(screen.getByLabelText("Relation"), { target: { value: "editor" } })
      await waitFor(() =>
        expect(lastList(sent)).toEqual({
          namespacePath: "eng/platform",
          relation: "editor",
          limit: 25,
          offset: 0,
        })
      )
    })
  })

  it("sends the namespace filter as an absent field for all namespaces", async () => {
    const { client: c, sent } = recordingQueryClient(answers())
    renderPage(WardenRelationsPage, c)
    await screen.findByText(PLAIN)
    expect(lastList(sent)).toEqual({ limit: 25, offset: 0 })
    expect(Object.keys(lastList(sent) ?? {})).not.toContain("namespacePath")
  })

  it("resets paging when the namespace filter changes", async () => {
    const { client: c, sent } = recordingQueryClient(
      answers({ "relations.list": { ...RELATIONS, total: 60 } })
    )
    renderPage(WardenRelationsPage, c)
    await screen.findByText(PLAIN)
    fireEvent.click(screen.getByRole("button", { name: /next page/i }))
    await waitFor(() => expect(lastList(sent)?.offset).toBe(25))

    fireEvent.change(screen.getByLabelText("Namespace"), { target: { value: "eng/platform" } })
    await waitFor(() =>
      expect(lastList(sent)).toMatchObject({ namespacePath: "eng/platform", offset: 0 })
    )
  })

  describe("creating", () => {
    it("waits for all five parts of the triple before it can be confirmed", async () => {
      renderPage(WardenRelationsPage, client())
      const dialog = await openCreate()
      const confirm = dialog.getByRole("button", { name: CREATE }) as HTMLButtonElement
      expect(confirm.disabled).toBe(true)
      const labels = Object.keys(FIVE)
      for (const [i, label] of labels.entries()) {
        fill(dialog, { [label]: FIVE[label as keyof typeof FIVE] })
        expect(confirm.disabled, `after ${label}`).toBe(i < labels.length - 1)
      }
    })

    it.each(Object.keys(FIVE))("cannot be confirmed without %s", async (missing) => {
      // The server refuses a tuple missing any part. Each is checked alone,
      // because a form that only required the first and last would pass a
      // single all-or-nothing check.
      renderPage(WardenRelationsPage, client())
      const dialog = await openCreate()
      fill(dialog, { ...FIVE, [missing]: "   " })
      expect(
        (dialog.getByRole("button", { name: CREATE }) as HTMLButtonElement).disabled
      ).toBe(true)
    })

    it("does not require the subject relation", async () => {
      renderPage(WardenRelationsPage, client())
      const dialog = await openCreate()
      fill(dialog, FIVE)
      expect(dialog.getByLabelText(/Subject relation \(optional\)/)).toBeTruthy()
      expect(
        (dialog.getByRole("button", { name: CREATE }) as HTMLButtonElement).disabled
      ).toBe(false)
    })

    it("previews the tuple it will write", async () => {
      renderPage(WardenRelationsPage, client())
      const dialog = await openCreate()
      expect(dialog.getByText(/fill in the five parts/i)).toBeTruthy()
      fill(dialog, { ...FIVE, "Subject relation (optional)": "member" })
      expect(dialog.getByText("document:readme#viewer@user:bob#member")).toBeTruthy()
    })

    it("sends the exact create payload, every part the form collects", async () => {
      const { client: c, sent } = recordingCommandClient(answers(), {
        "relations.create": { id: "rel_new" },
      })
      renderPage(WardenRelationsPage, c)
      // Filter to a namespace first: the create lands in the one on screen.
      await screen.findByText(PLAIN)
      fireEvent.change(screen.getByLabelText("Namespace"), { target: { value: "eng/platform" } })
      const dialog = await openCreate()
      fill(dialog, {
        "Object type": " document ",
        "Object id": " spec ",
        Relation: " editor ",
        "Subject type": " group ",
        "Subject id": " eng ",
        "Subject relation (optional)": " member ",
      })
      fireEvent.click(dialog.getByRole("button", { name: CREATE }))

      await waitFor(() => expect(sent).toHaveLength(1))
      expect(sent[0]?.intent).toBe("relations.create")
      expect(sent[0]?.payload).toEqual({
        namespacePath: "eng/platform",
        objectType: "document",
        objectId: "spec",
        relation: "editor",
        subjectType: "group",
        subjectId: "eng",
        subjectRelation: "member",
      })
    })

    it("leaves an unset subject relation out of the payload rather than sending an empty string", async () => {
      const { client: c, sent } = recordingCommandClient(answers(), {
        "relations.create": { id: "rel_new" },
      })
      renderPage(WardenRelationsPage, c)
      const dialog = await openCreate()
      fill(dialog, FIVE)
      // Whitespace only counts as unset.
      fill(dialog, { "Subject relation (optional)": "   " })
      fireEvent.click(dialog.getByRole("button", { name: CREATE }))

      await waitFor(() => expect(sent).toHaveLength(1))
      const payload = sent[0]?.payload as Record<string, unknown>
      // toEqual ignores undefined-valued keys, so also assert the keys
      // themselves: "" and absent are different tuples to anything that
      // compares.
      expect(payload).toEqual({
        namespacePath: "",
        objectType: "document",
        objectId: "readme",
        relation: "viewer",
        subjectType: "user",
        subjectId: "bob",
      })
      expect(Object.keys(payload).sort()).toEqual([
        "namespacePath",
        "objectId",
        "objectType",
        "relation",
        "subjectId",
        "subjectType",
      ])
    })

    it("writes into the tenant root when no namespace is selected", async () => {
      const { client: c, sent } = recordingCommandClient(answers(), {
        "relations.create": { id: "rel_new" },
      })
      renderPage(WardenRelationsPage, c)
      const dialog = await openCreate()
      expect(dialog.getByText(/in the tenant root/i)).toBeTruthy()
      expect(dialog.getByText(/in scope for checks there and in every namespace below it/i)).toBeTruthy()
      fill(dialog, FIVE)
      fireEvent.click(dialog.getByRole("button", { name: CREATE }))
      await waitFor(() => expect(sent).toHaveLength(1))
      expect((sent[0]?.payload as { namespacePath: string }).namespacePath).toBe("")
    })

    it("closes the dialog once the create succeeds", async () => {
      const { client: c, sent } = recordingCommandClient(answers(), {
        "relations.create": { id: "rel_new" },
      })
      renderPage(WardenRelationsPage, c)
      const dialog = await openCreate()
      fill(dialog, FIVE)
      fireEvent.click(dialog.getByRole("button", { name: CREATE }))
      await waitFor(() => expect(sent).toHaveLength(1))
      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    })

    it("shows a duplicate-tuple refusal inside the dialog and keeps what was typed", async () => {
      // A duplicate is a CONFLICT from the real server. The code is set
      // explicitly here: the local fixture server reports every warden
      // refusal as BAD_REQUEST, so it cannot stand in for this. The dialog
      // must stay open and carry the message, because Base UI makes
      // everything outside an open dialog inert.
      renderPage(
        WardenRelationsPage,
        refusingCommands(
          new ContractError("CONFLICT", "that relation tuple already exists")
        )
      )
      const dialog = await openCreate()
      fill(dialog, FIVE)
      fireEvent.click(dialog.getByRole("button", { name: CREATE }))

      const alert = await dialog.findByRole("alert")
      expect(alert.textContent).toContain("that relation tuple already exists")
      expect(alert.textContent).toContain("CONFLICT")
      expect(screen.getByRole("alertdialog")).toBeTruthy()
      expect((dialog.getByLabelText("Object id") as HTMLInputElement).value).toBe("readme")
      expect((dialog.getByLabelText("Subject id") as HTMLInputElement).value).toBe("bob")
    })

    it("clears an earlier refusal when the dialog is opened again", async () => {
      renderPage(
        WardenRelationsPage,
        refusingCommands(new ContractError("CONFLICT", "that relation tuple already exists"))
      )
      const first = await openCreate()
      fill(first, FIVE)
      fireEvent.click(first.getByRole("button", { name: CREATE }))
      await first.findByRole("alert")

      fireEvent.click(first.getByRole("button", { name: /^cancel$/i }))
      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())

      const second = await openCreate()
      expect(second.queryByRole("alert")).toBeNull()
      expect((second.getByLabelText("Object type") as HTMLInputElement).value).toBe("")
    })

    it("shows the create as pending while the command is in flight", async () => {
      const pending = {
        ...client(),
        command: () => new Promise<never>(() => {}),
      } as ScopedClient
      renderPage(WardenRelationsPage, pending)
      const dialog = await openCreate()
      fill(dialog, FIVE)
      fireEvent.click(dialog.getByRole("button", { name: CREATE }))
      const working = (await dialog.findByRole("button", { name: /working/i })) as HTMLButtonElement
      expect(working.disabled).toBe(true)
    })
  })

  describe("deleting", () => {
    it("sends the relation id, and only the id", async () => {
      const { client: c, sent } = recordingCommandClient(answers(), { "relations.delete": {} })
      renderPage(WardenRelationsPage, c)
      await screen.findByText(PLAIN)
      fireEvent.click(screen.getByRole("button", { name: `Delete ${PLAIN}` }))
      fireEvent.click(await screen.findByRole("button", { name: /^Delete$/ }))
      await waitFor(() => expect(sent).toHaveLength(1))
      expect(sent[0]?.intent).toBe("relations.delete")
      expect(sent[0]?.payload).toEqual({ id: "rel_plain" })
    })

    it("names the whole tuple in the confirmation", async () => {
      renderPage(WardenRelationsPage, client())
      await screen.findByText(USERSET)
      fireEvent.click(screen.getByRole("button", { name: `Delete ${USERSET}` }))
      const dialog = within(await screen.findByRole("alertdialog"))
      expect(dialog.getByText(`Delete ${USERSET}?`)).toBeTruthy()
    })

    it("says a tuple written in a chosen namespace is in scope there and below it", async () => {
      renderPage(WardenRelationsPage, client())
      await screen.findByText(PLAIN)
      fireEvent.change(screen.getByLabelText("Namespace"), { target: { value: "eng/platform" } })
      const dialog = await openCreate()
      const described = (await screen.findByRole("alertdialog")).textContent ?? ""
      expect(described).toContain(
        "Writing a tuple in eng/platform. It is in scope for checks there and in every namespace below it."
      )
      expect(dialog.getByRole("button", { name: CREATE })).toBeTruthy()
    })

    it("shows the delete as pending while the command is in flight", async () => {
      // Without pending the confirm stays live, and a second click sends a
      // second delete that comes back NOT_FOUND over the first one's success.
      const pending = {
        ...client(),
        command: () => new Promise<never>(() => {}),
      } as ScopedClient
      renderPage(WardenRelationsPage, pending)
      await screen.findByText(PLAIN)
      fireEvent.click(screen.getByRole("button", { name: `Delete ${PLAIN}` }))
      const dialog = within(await screen.findByRole("alertdialog"))
      fireEvent.click(dialog.getByRole("button", { name: /^Delete$/ }))
      const working = (await dialog.findByRole("button", { name: /working/i })) as HTMLButtonElement
      expect(working.disabled).toBe(true)
    })

    it("shows a refused delete inside the dialog", async () => {
      renderPage(
        WardenRelationsPage,
        refusingCommands(new ContractError("NOT_FOUND", "no such relation"))
      )
      await screen.findByText(PLAIN)
      fireEvent.click(screen.getByRole("button", { name: `Delete ${PLAIN}` }))
      const dialog = within(await screen.findByRole("alertdialog"))
      fireEvent.click(dialog.getByRole("button", { name: /^Delete$/ }))
      const alert = await dialog.findByRole("alert")
      expect(alert.textContent).toContain("no such relation")
    })

    it("steps back a page when a delete empties the last one", async () => {
      const lastPage = {
        ...RELATIONS,
        items: [RELATIONS.items[0]],
        total: 26,
        limit: 25,
        offset: 25,
      }
      const { client: c, sent } = recordingQueryClient(answers({ "relations.list": lastPage }))
      const withDelete = { ...c, command: async () => ({}) } as typeof c
      renderPage(WardenRelationsPage, withDelete)
      await screen.findByText(PLAIN)
      fireEvent.click(screen.getByRole("button", { name: /next page/i }))
      await waitFor(() => expect(lastList(sent)?.offset).toBe(25))
      fireEvent.click(screen.getByRole("button", { name: `Delete ${PLAIN}` }))
      fireEvent.click(await screen.findByRole("button", { name: /^Delete$/ }))
      await waitFor(() => expect(lastList(sent)?.offset).toBe(0))
    })
  })
})

describe("WardenRelationsPage: the graph", () => {
  const GRAPH = {
    nodes: [
      {
        id: "rt_doc",
        namespacePath: "",
        name: "document",
        relations: [
          { name: "viewer", allowedSubjects: ["user"] },
          { name: "editor", allowedSubjects: ["group#member"] },
        ],
        permissions: [],
      },
      {
        id: "rt_doc_eng",
        namespacePath: "eng/platform",
        name: "document",
        relations: [{ name: "reviewer", allowedSubjects: ["user"] }],
        permissions: [],
      },
      {
        id: "rt_folder",
        namespacePath: "",
        name: "folder",
        relations: [{ name: "owner", allowedSubjects: ["user"] }],
        permissions: [],
      },
    ],
    edges: [],
    truncated: false,
  }

  it("opens each tuple's object and relation in the graph, at the tuple's namespace", async () => {
    renderPage(WardenRelationsPage, client())
    const plain = within(await rowOf(PLAIN)).getByRole("link", { name: /^Graph/ })
    expect(plain.textContent).toBe("Graph")
    expect(plain.getAttribute("href")).toBe("/relations/graph/document/readme/viewer")
    const userset = within(await rowOf(USERSET)).getByRole("link", { name: /^Graph/ })
    expect(userset.getAttribute("href")).toBe(
      "/relations/graph/document/spec/editor/in/eng%2Fplatform"
    )
  })

  it("does not read the schema for the form until the form is opened", async () => {
    const { client: c, sent } = recordingQueryClient(answers({ "resourceTypes.graph": GRAPH }))
    renderPage(WardenRelationsPage, c)
    await screen.findByText(PLAIN)
    expect(sent.map((q) => q.intent)).not.toContain("resourceTypes.graph")
  })

  it("says when the schema it offers is only the first 500 types", async () => {
    renderPage(
      WardenRelationsPage,
      client({ "resourceTypes.graph": { ...GRAPH, truncated: true } })
    )
    await screen.findByText(PLAIN)
    const details = screen.getByText("Draw a relation graph").closest("details")!
    details.open = true
    fireEvent(details, new Event("toggle"))
    expect(await within(details).findByText("Showing the first 500 resource types.")).toBeTruthy()
  })

  it("does not say it when the schema is whole", async () => {
    renderPage(WardenRelationsPage, client({ "resourceTypes.graph": GRAPH }))
    await screen.findByText(PLAIN)
    const details = screen.getByText("Draw a relation graph").closest("details")!
    details.open = true
    fireEvent(details, new Event("toggle"))
    await within(details).findByLabelText("Object type")
    expect(screen.queryByText("Showing the first 500 resource types.")).toBeNull()
  })

  describe("the form", () => {
    async function open() {
      renderPage(WardenRelationsPage, client({ "resourceTypes.graph": GRAPH }))
      await screen.findByText(PLAIN)
      const details = screen.getByText("Draw a relation graph").closest("details")!
      fireEvent.click(screen.getByText("Draw a relation graph"))
      // jsdom does not fire toggle on a click, so say it opened.
      details.open = true
      fireEvent(details, new Event("toggle"))
      return within(details)
    }

    it("offers the declared relations of the chosen type, and nothing before one is chosen", async () => {
      const form = await open()
      await waitFor(() => expect(form.getByLabelText("Object type")).toBeTruthy())
      const relation = form.getByLabelText("Relation") as HTMLSelectElement
      expect(relation.disabled).toBe(true)
      fireEvent.change(form.getByLabelText("Object type"), { target: { value: "document" } })
      const names = Array.from(relation.options).map((o) => o.textContent)
      // Both namespaces' document types, once each.
      expect(names).toEqual(["Choose a relation", "viewer", "editor", "reviewer"])
      expect(relation.disabled).toBe(false)
    })

    it("links to the graph once an object, a type and a relation are chosen", async () => {
      const form = await open()
      await waitFor(() => expect(form.getByLabelText("Object type")).toBeTruthy())
      expect(form.queryByRole("link", { name: "Show graph" })).toBeNull()
      expect((form.getByRole("button", { name: "Show graph" }) as HTMLButtonElement).disabled).toBe(
        true
      )
      fireEvent.change(form.getByLabelText("Object type"), { target: { value: "document" } })
      fireEvent.change(form.getByLabelText("Object id"), { target: { value: "readme" } })
      fireEvent.change(form.getByLabelText("Relation"), { target: { value: "editor" } })
      expect(form.getByRole("link", { name: "Show graph" }).getAttribute("href")).toBe(
        "/relations/graph/document/readme/editor"
      )
      fireEvent.change(form.getByLabelText("Namespace"), { target: { value: "eng/platform" } })
      expect(form.getByRole("link", { name: "Show graph" }).getAttribute("href")).toBe(
        "/relations/graph/document/readme/editor/in/eng%2Fplatform"
      )
    })

    it("drops the relation when the type changes to one that does not declare it", async () => {
      const form = await open()
      await waitFor(() => expect(form.getByLabelText("Object type")).toBeTruthy())
      fireEvent.change(form.getByLabelText("Object type"), { target: { value: "document" } })
      fireEvent.change(form.getByLabelText("Object id"), { target: { value: "readme" } })
      fireEvent.change(form.getByLabelText("Relation"), { target: { value: "editor" } })
      fireEvent.change(form.getByLabelText("Object type"), { target: { value: "folder" } })
      expect(form.queryByRole("link", { name: "Show graph" })).toBeNull()
      expect((form.getByLabelText("Relation") as HTMLSelectElement).value).toBe("")
    })
  })
})
