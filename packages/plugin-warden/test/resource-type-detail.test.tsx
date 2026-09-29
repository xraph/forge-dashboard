import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import type { ScopedClient } from "@forge-go/dashboard-plugin"
import {
  WardenResourceTypeDetailPage,
  analyseExpression,
  diagnosticsOf,
} from "../src/pages/resource-type-detail"
import type {
  ExpressionDiagnostic,
  PermissionDef,
  RelationDef,
  ResourceTypeDetail,
} from "../src/pages/resource-type-detail"
import {
  failingClient,
  pendingClient,
  recordingCommandClient,
  renderPage,
  stubClient,
} from "./harness"

// A healthy type. `viewer or editor` is the expression from the brief;
// `parent->read` is a traversal whose second hop names a relation on ANOTHER
// type, which this type cannot see and the server does not check.
const DETAIL: ResourceTypeDetail = {
  id: "rt_01a",
  namespacePath: "",
  name: "document",
  description: "a file",
  relationCount: 3,
  permissionCount: 3,
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-02T00:00:00Z",
  createdBy: "usr_1",
  updatedBy: "usr_2",
  relations: [
    { name: "viewer", allowedSubjects: ["user"] },
    { name: "editor", allowedSubjects: ["user", "group#member"] },
    { name: "parent", allowedSubjects: ["folder"] },
  ],
  permissions: [
    { name: "read", expression: "viewer or editor" },
    { name: "write", expression: "editor" },
    { name: "inherited", expression: "parent->read" },
  ],
}

function detailOf(over: Partial<ResourceTypeDetail>): ResourceTypeDetail {
  return { ...DETAIL, ...over }
}

function client(detail: ResourceTypeDetail = DETAIL, commands = {}) {
  return stubClient({ "resourceTypes.detail": detail }, commands)
}

function render(detail: ResourceTypeDetail = DETAIL, commands = {}) {
  return renderPage(WardenResourceTypeDetailPage, client(detail, commands), { id: "rt_01a" })
}

/** A client that reads the detail and refuses every command with `error`. */
function refusing(error: ContractError, detail: ResourceTypeDetail = DETAIL) {
  const { client: c, sent } = recordingCommandClient({ "resourceTypes.detail": detail })
  const client = {
    ...c,
    command: (intent: string, payload?: unknown) => {
      sent.push({ intent, payload })
      return Promise.reject(error)
    },
  } as ScopedClient
  return { client, sent }
}

const rowOf = async (text: string) => (await screen.findByText(text)).closest("tr")!

/** The same detail with one permission's expression replaced. */
function withExpression(name: string, expression: string): ResourceTypeDetail {
  return detailOf({
    permissions: DETAIL.permissions.map((p) => (p.name === name ? { ...p, expression } : p)),
  })
}

async function openEdit() {
  await screen.findByText("document")
  // Exact name: this type declares an `editor` relation, and /edit/i would
  // match an accessible name mentioning one.
  fireEvent.click(screen.getByRole("button", { name: "Edit" }))
  return screen.findByRole("button", { name: "Save changes" }) as Promise<HTMLButtonElement>
}

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement
const type = (label: string, value: string) =>
  fireEvent.change(field(label), { target: { value } })
const group = (label: string) => within(screen.getByRole("group", { name: label }))

function diag(over: Partial<ExpressionDiagnostic> = {}): ExpressionDiagnostic {
  return {
    permission: "read",
    line: 1,
    col: 11,
    message: "relation ghost is not declared on this type",
    ...over,
  }
}

function badExpression(...diagnostics: ExpressionDiagnostic[]) {
  return new ContractError(
    "BAD_REQUEST",
    "invalid permission expression: permission read at 1:11: relation ghost is not declared on this type",
    { diagnostics }
  )
}

describe("WardenResourceTypeDetailPage", () => {
  describe("reading", () => {
    it("renders each permission as a name and its expression", async () => {
      render()
      const row = await rowOf("viewer or editor")
      expect(within(row).getByText("read")).toBeTruthy()
      const inherited = await rowOf("parent->read")
      expect(within(inherited).getByText("inherited")).toBeTruthy()
    })

    it("shows an expression in monospace, because it is a raw value", async () => {
      render()
      const expr = await screen.findByText("viewer or editor")
      expect(expr.className).toContain("font-mono")
      expect(expr.className).toContain("text-xs")
    })

    it("sets the relation and permission names in the weight an operator scans for", async () => {
      render()
      const relation = (await screen.findAllByText("viewer"))[0]!.closest("td")!
      expect(relation.className).toContain("font-medium")
      const permission = (await screen.findByText("read")).closest("td")!
      expect(permission.className).toContain("font-medium")
    })

    it("lists each relation with the subject types it allows", async () => {
      render()
      const viewer = (await screen.findByText("viewer", { selector: "td" })).closest("tr")!
      expect(within(viewer).getByText("user")).toBeTruthy()
      const editor = (await screen.findByText("editor", { selector: "td" })).closest("tr")!
      expect(within(editor).getByText("user")).toBeTruthy()
      // A userset subject type keeps its relation.
      expect(within(editor).getByText("group#member")).toBeTruthy()
      // And a row shows only its own.
      expect(within(viewer).queryByText("group#member")).toBeNull()
    })

    it("does not render a relation that allows no subject types as a blank cell", async () => {
      // A real and broken state: nothing can be written to such a relation.
      render(
        detailOf({
          relations: [{ name: "orphan", allowedSubjects: [] }],
          permissions: [],
        })
      )
      const row = (await screen.findByText("orphan", { selector: "td" })).closest("tr")!
      expect(within(row).getByLabelText("no allowed subject types")).toBeTruthy()
    })

    it("counts both tables in their captions", async () => {
      render()
      expect(await screen.findByText(/3 relations/)).toBeTruthy()
      expect(await screen.findByText(/3 permissions/)).toBeTruthy()
    })

    it("still counts at zero, and says which kind of empty a type with no relations is", async () => {
      render(detailOf({ relations: [], permissions: [] }))
      expect(await screen.findByText("This type declares no relations.")).toBeTruthy()
      expect(await screen.findByText("This type declares no permissions.")).toBeTruthy()
      expect(screen.getAllByText(/^0 relations$/).length).toBeGreaterThan(0)
      expect(screen.getAllByText(/^0 permissions$/).length).toBeGreaterThan(0)
      // Not the generic empty state.
      expect(screen.queryByText(/no rows/i)).toBeNull()
    })

    it("names the two kinds of empty apart", async () => {
      // A type with relations but no permissions is a different situation
      // from one with neither, and the page must not blur them.
      render(detailOf({ permissions: [] }))
      expect(await screen.findByText("This type declares no permissions.")).toBeTruthy()
      expect(screen.queryByText("This type declares no relations.")).toBeNull()
    })

    it("treats a null list as an empty one rather than throwing", async () => {
      const broken = {
        ...DETAIL,
        relations: null,
        permissions: null,
      } as unknown as ResourceTypeDetail
      render(broken)
      expect(await screen.findByText("This type declares no relations.")).toBeTruthy()
      expect(screen.getByText("This type declares no permissions.")).toBeTruthy()
    })

    it("shows the type's own fields", async () => {
      render()
      expect(await screen.findByRole("heading", { name: "document" })).toBeTruthy()
      expect(screen.getByText("a file")).toBeTruthy()
      expect(screen.getByText("usr_1")).toBeTruthy()
      expect(screen.getByText("usr_2")).toBeTruthy()
    })

    it("renders the tenant root as a slash and a real path as itself", async () => {
      const { unmount } = render()
      await screen.findByText("document", { selector: "h1, h2, h3" }).catch(() => undefined)
      await screen.findByText("a file")
      expect(screen.getByText("/")).toBeTruthy()
      expect(screen.queryByText("root")).toBeNull()
      unmount()
      renderPage(
        WardenResourceTypeDetailPage,
        client(detailOf({ namespacePath: "eng/platform" })),
        { id: "rt_01a" }
      )
      expect(await screen.findByText("eng/platform")).toBeTruthy()
    })

    it("labels an absent description and absent authors instead of leaving blanks", async () => {
      render(detailOf({ description: undefined, createdBy: undefined, updatedBy: undefined }))
      expect(await screen.findByLabelText("no description")).toBeTruthy()
      expect(screen.getByLabelText("no creator")).toBeTruthy()
      expect(screen.getByLabelText("no updater")).toBeTruthy()
    })

    it("asks the server for this type's id", async () => {
      const seen: unknown[] = []
      const c = {
        ...client(),
        query: async (intent: string, params?: unknown) => {
          seen.push({ intent, params })
          return DETAIL
        },
      } as ScopedClient
      renderPage(WardenResourceTypeDetailPage, c, { id: "rt_01a" })
      await screen.findByText("a file")
      expect(seen[0]).toEqual({ intent: "resourceTypes.detail", params: { id: "rt_01a" } })
    })

    it("surfaces a failure instead of rendering an empty type", async () => {
      renderPage(
        WardenResourceTypeDetailPage,
        failingClient(new ContractError("NOT_FOUND", "no such resource type")),
        { id: "rt_01a" }
      )
      expect(await screen.findAllByText(/no such resource type/i)).toBeTruthy()
    })

    it("shows a loading state while the read is in flight", async () => {
      renderPage(WardenResourceTypeDetailPage, pendingClient(), { id: "rt_01a" })
      expect(await screen.findByRole("status", { name: /loading resource type/i })).toBeTruthy()
    })

    it("offers no delete: the list page owns that", async () => {
      render()
      await screen.findByText("a file")
      expect(screen.queryByRole("button", { name: /delete/i })).toBeNull()
    })
  })

  describe("expressions with something wrong in them", () => {
    // What an undeclared reference does at check time (warden dsl/eval.go): a
    // bare reference is a raw tuple lookup that never consults the type's
    // declared relations, and relations.create does not validate names against
    // a schema. So `ghost` matches a subject holding a stray ghost tuple and
    // is false for everyone else, and a not turns that false into true. The
    // warnings are about the reference, and must be true whatever surrounds it.
    const GHOST =
      "ghost is not declared on this type, so it is probably a typo. It only takes effect through a stray ghost tuple, so for almost every subject it is false."
    const GHOST_NEGATED =
      "Because ghost is negated here, that part of the expression is true for almost every subject, which can grant this permission far more widely than intended."

    async function rowFor(expression: string) {
      render(withExpression("read", expression))
      return within(await rowOf(expression))
    }

    it("warns about a bare undeclared reference, in words true of the reference", async () => {
      // The server refuses this on write, but a type written through the DSL
      // or the REST API can carry one.
      const row = await rowFor("ghost")
      expect(row.getByText(GHOST)).toBeTruthy()
      expect(row.queryByText(GHOST_NEGATED)).toBeNull()
    })

    it("does not call the permission dead when one term of an or is undeclared", async () => {
      // `viewer or ghost` still grants through viewer. The warning is about
      // ghost only, and must not say the expression cannot match.
      const row = await rowFor("viewer or ghost")
      expect(row.getByText(GHOST)).toBeTruthy()
      expect(row.queryByText(GHOST_NEGATED)).toBeNull()
      expect(row.queryByText(/never match/i)).toBeNull()
      expect(row.queryByText(/inert|dead|cannot match/i)).toBeNull()
    })

    it.each(["ghost or viewer", "viewer + ghost", "viewer and ghost", "viewer & ghost", "(ghost)", "ghost->read"])(
      "warns about the reference and claims nothing about the whole of %j",
      async (expression) => {
        const row = await rowFor(expression)
        expect(row.getByText(GHOST)).toBeTruthy()
        expect(row.queryByText(GHOST_NEGATED)).toBeNull()
        expect(row.queryByText(/never match/i)).toBeNull()
      }
    )

    it.each(["not ghost", "!ghost", "-ghost", "viewer and not ghost", "viewer and !ghost", "not (viewer or ghost)"])(
      "adds the broad-grant warning when the reference is negated, in %j",
      async (expression) => {
        const row = await rowFor(expression)
        expect(row.getByText(GHOST)).toBeTruthy()
        expect(row.getByText(GHOST_NEGATED)).toBeTruthy()
        // A negated undeclared reference is true, not inert.
        expect(row.queryByText(/never match/i)).toBeNull()
      }
    )

    it.each(["not not ghost", "!!ghost", "not (not ghost)", "viewer and not not ghost"])(
      "does not add the broad-grant warning under an even number of negations, in %j",
      async (expression) => {
        const row = await rowFor(expression)
        expect(row.getByText(GHOST)).toBeTruthy()
        expect(row.queryByText(GHOST_NEGATED)).toBeNull()
      }
    )

    it("adds it again for three negations", async () => {
      const row = await rowFor("not not not ghost")
      expect(row.getByText(GHOST_NEGATED)).toBeTruthy()
    })

    it("does not put the broad-grant warning on a different, non-negated reference", async () => {
      // `not ghost or spectre`: the not binds to ghost alone.
      const row = await rowFor("not ghost or spectre")
      expect(row.getByText(GHOST_NEGATED)).toBeTruthy()
      expect(row.getByText(/spectre is not declared/)).toBeTruthy()
      expect(row.queryByText(/Because spectre is negated/)).toBeNull()
    })

    it("warns about a negated first hop of a traversal", async () => {
      const row = await rowFor("not ghost->read")
      expect(row.getByText(GHOST)).toBeTruthy()
      expect(row.getByText(GHOST_NEGATED)).toBeTruthy()
    })

    it("marks only the expression that is wrong", async () => {
      render(withExpression("read", "viewer or ghost"))
      await screen.findByText("viewer or ghost")
      expect(screen.getAllByText(/is not declared on this type/)).toHaveLength(1)
      const write = await rowOf("write")
      expect(within(write).queryByText(/is not declared on this type/)).toBeNull()
    })

    it("marks every undeclared relation once, however often it is named", async () => {
      const row = await rowFor("ghost or viewer or ghost or spectre")
      expect(row.getAllByText(/ghost is not declared/)).toHaveLength(1)
      expect(row.getAllByText(/spectre is not declared/)).toHaveLength(1)
    })

    it("warns about negation once when a name is negated in one place and not another", async () => {
      const row = await rowFor("ghost or not ghost")
      expect(row.getAllByText(/ghost is not declared/)).toHaveLength(1)
      expect(row.getAllByText(GHOST_NEGATED)).toHaveLength(1)
    })

    it("does not warn about the second hop of a traversal", async () => {
      // parent->approve: `parent` is declared here. `approve` is a relation
      // or permission on whatever type the parent hop lands on, which this
      // type cannot know. The server checks the first hop only, so a page
      // that checked both would warn about an expression the server accepts.
      const row = await rowFor("parent->approve")
      expect(row.queryByText(/is not declared on this type/)).toBeNull()
      expect(screen.queryByText(/approve is not declared/)).toBeNull()
    })

    it("checks only the first step of a longer traversal", async () => {
      const row = await rowFor("parent->owner->read")
      expect(row.queryByText(/is not declared on this type/)).toBeNull()
    })

    it("does not flag a negated declared relation", async () => {
      const row = await rowFor("viewer and not editor")
      expect(row.queryByText(/negated here/)).toBeNull()
      expect(row.queryByText(/is not declared on this type/)).toBeNull()
    })

    it("says a permission name is not a relation, and is honest about what happens to it", async () => {
      // `write` is declared, but as a permission. The evaluator looks the name
      // up as a relation tuple, so it matches only a stray `write` tuple.
      const row = await rowFor("viewer or write")
      expect(
        row.getByText(
          "write is a permission on this type, not a relation, and an expression can only reference relations. It only takes effect through a stray write tuple, so for almost every subject it is false."
        )
      ).toBeTruthy()
      expect(row.queryByText(/never match/i)).toBeNull()
      expect(row.queryByText(/negated here/)).toBeNull()
    })

    it("warns about the broad grant when a permission name is negated", async () => {
      const row = await rowFor("not write")
      expect(row.getByText(/write is a permission on this type, not a relation/)).toBeTruthy()
      expect(
        row.getByText(
          "Because write is negated here, that part of the expression is true for almost every subject, which can grant this permission far more widely than intended."
        )
      ).toBeTruthy()
    })

    it("marks an expression that does not parse", async () => {
      // An expression that fails to compile is refused at check time and
      // never matches, so this one IS about the whole expression.
      const row = await rowFor("viewer or or")
      expect(row.getByText("This expression does not parse, so it can never match.")).toBeTruthy()
    })

    it("does not also blame a relation in an expression that does not parse", async () => {
      const row = await rowFor("ghost or")
      expect(row.getByText(/does not parse/)).toBeTruthy()
      expect(row.queryByText(/ghost is not declared/)).toBeNull()
      expect(row.queryByText(/negated here/)).toBeNull()
    })

    it("labels an empty expression instead of rendering a blank", async () => {
      render(withExpression("read", ""))
      const row = (await screen.findByText("read")).closest("tr")!
      expect(within(row).getByLabelText("no expression")).toBeTruthy()
      expect(within(row).getByText("This expression does not parse, so it can never match.")).toBeTruthy()
    })

    it("marks nothing on a healthy type", async () => {
      render()
      await screen.findByText("viewer or editor")
      expect(screen.queryByText(/is not declared on this type/)).toBeNull()
      expect(screen.queryByText(/negated here/)).toBeNull()
      expect(screen.queryByText(/does not parse/)).toBeNull()
    })
  })

  describe("analyseExpression", () => {
    const relations: RelationDef[] = [
      { name: "viewer", allowedSubjects: ["user"] },
      { name: "editor", allowedSubjects: ["user"] },
      { name: "parent", allowedSubjects: ["folder"] },
      { name: "billing-admin", allowedSubjects: ["user"] },
    ]
    const permissions: PermissionDef[] = [{ name: "read", expression: "viewer" }]
    const undeclared = (expression: string) =>
      analyseExpression(expression, relations, permissions).undeclared.map((u) => u.name)

    // The cases warden's own referencedRelations documents, and the ones its
    // parser's precedence and lexer make easy to get wrong.
    it.each([
      ["viewer", []],
      ["viewer or editor or parent->read", []],
      ["ghost", ["ghost"]],
      ["parent->read", []],
      ["ghost->read", ["ghost"]],
      ["parent->ghost", []],
      ["parent->ghost->deeper", []],
      ["viewer or ghost", ["ghost"]],
      ["viewer and ghost", ["ghost"]],
      ["not ghost", ["ghost"]],
      ["viewer and not (ghost or spectre)", ["ghost", "spectre"]],
      ["(viewer or editor) and parent->read", []],
      // `+`, `&`, `!` and `-` are the DSL's symbol spellings of or/and/not.
      ["viewer + ghost", ["ghost"]],
      ["viewer & ghost", ["ghost"]],
      ["!ghost", ["ghost"]],
      ["-ghost", ["ghost"]],
      // Identifiers may hold hyphens, but a hyphen before > is the arrow.
      ["billing-admin", []],
      ["billing-admin->read", []],
      ["parent->read or billing-ghost", ["billing-ghost"]],
      ["viewer or\n  ghost", ["ghost"]],
      ["viewer // ghost", []],
      ["viewer /* ghost */ or editor", []],
      // Names are case-sensitive.
      ["Viewer", ["Viewer"]],
      ["ghost or ghost", ["ghost"]],
    ])("finds the undeclared relations in %j", (expression, expected) => {
      const result = analyseExpression(expression, relations, permissions)
      expect(result.parses, expression).toBe(true)
      expect(undeclared(expression)).toEqual(expected)
    })

    it.each([
      [""],
      ["   "],
      ["or"],
      ["viewer or"],
      ["viewer or or editor"],
      ["viewer editor"],
      ["(viewer"],
      ["viewer)"],
      ["parent->"],
      ["parent->->read"],
      ["->read"],
      ["viewer ->"],
      ["1"],
      ["viewer or 2"],
      ['"viewer"'],
      ["viewer /* unterminated"],
      ["viewer @ editor"],
      // `-` is only ever a prefix (not). Between two operands it is nothing.
      ["viewer - ghost"],
      ["viewer -ghost"],
      ["viewer != editor"],
      ["viewer += editor"],
      // A DSL keyword is not an identifier, so it is not a relation name.
      ["role"],
      ["viewer or name"],
      ["true"],
    ])("reports %j as not parsing, with nothing to blame", (expression) => {
      const result = analyseExpression(expression, relations, permissions)
      expect(result.parses, expression).toBe(false)
      expect(result.undeclared, expression).toEqual([])
    })

    it("flags a sibling permission as a permission, and an unknown name as neither", () => {
      const result = analyseExpression("read or ghost", relations, permissions)
      expect(result.undeclared).toEqual([
        { name: "read", isPermission: true, negated: false },
        { name: "ghost", isPermission: false, negated: false },
      ])
    })

    // Negation is decided from the tree: one flip per not, and an even number
    // of flips is not negated. This mirrors NotExpr in dsl/eval.go.
    it.each([
      ["ghost", false],
      ["not ghost", true],
      ["!ghost", true],
      ["-ghost", true],
      ["not not ghost", false],
      ["!!ghost", false],
      ["- - ghost", false],
      ["not not not ghost", true],
      ["viewer and not ghost", true],
      ["not viewer and ghost", false],
      ["not (viewer or ghost)", true],
      ["not (viewer or not ghost)", false],
      ["not ghost->read", true],
      ["ghost or not ghost", true],
      ["not ghost or ghost", true],
    ])("says whether the reference in %j is negated", (expression, negated) => {
      const result = analyseExpression(expression, relations, permissions)
      expect(result.undeclared).toHaveLength(1)
      expect(result.undeclared[0]?.negated, expression).toBe(negated)
    })

    it("negates only the reference a not binds to", () => {
      const result = analyseExpression("not ghost or spectre", relations, permissions)
      expect(result.undeclared).toEqual([
        { name: "ghost", isPermission: false, negated: true },
        { name: "spectre", isPermission: false, negated: false },
      ])
    })

    it("never marks a declared relation as negated", () => {
      expect(analyseExpression("not viewer", relations, permissions).undeclared).toEqual([])
    })

    it("flags every name when the type declares no relations at all", () => {
      expect(analyseExpression("viewer or parent->read", [], []).undeclared.map((u) => u.name)).toEqual([
        "viewer",
        "parent",
      ])
    })
  })

  describe("diagnosticsOf", () => {
    it("reads the diagnostics off a contract error's details", () => {
      const d = diag()
      expect(diagnosticsOf(badExpression(d))).toEqual([d])
    })

    it("returns nothing for an error with no details, or other details", () => {
      expect(diagnosticsOf(undefined)).toEqual([])
      expect(diagnosticsOf(new ContractError("BAD_REQUEST", "x"))).toEqual([])
      expect(diagnosticsOf(new ContractError("BAD_REQUEST", "x", { field: "name" }))).toEqual([])
      expect(diagnosticsOf(new ContractError("BAD_REQUEST", "x", { diagnostics: "nope" }))).toEqual([])
    })

    it("skips an entry that is not a diagnostic and keeps the rest", () => {
      const error = new ContractError("BAD_REQUEST", "x", {
        diagnostics: [null, 7, { permission: 3, message: "m" }, { permission: "read" }, diag()],
      })
      expect(diagnosticsOf(error)).toEqual([diag()])
    })
  })

  describe("editing", () => {
    it("starts from what the type has now", async () => {
      render()
      await openEdit()
      expect(field("Description").value).toBe("a file")
      expect(field("Relation 1 name").value).toBe("viewer")
      expect(field("Relation 2 subject types").value).toBe("user, group#member")
      expect(field("Permission 1 name").value).toBe("read")
      expect(field("Permission 1 expression").value).toBe("viewer or editor")
      expect(field("Permission 3 expression").value).toBe("parent->read")
    })

    it("cannot be saved until something changes", async () => {
      render()
      const save = await openEdit()
      expect(save.disabled).toBe(true)
      type("Description", "a document")
      expect(save.disabled).toBe(false)
      // Put back exactly as it was, and there is nothing to save again.
      type("Description", "a file")
      expect(save.disabled).toBe(true)
    })

    it("says the name and namespace cannot change", async () => {
      render()
      await openEdit()
      expect(screen.getByText(/name and namespace cannot change/i)).toBeTruthy()
      expect(screen.queryByLabelText("Name")).toBeNull()
    })

    it("sends only the description when only the description changed", async () => {
      const { client: c, sent } = recordingCommandClient(
        { "resourceTypes.detail": DETAIL },
        { "resourceTypes.update": { id: "rt_01a" } }
      )
      renderPage(WardenResourceTypeDetailPage, c, { id: "rt_01a" })
      const save = await openEdit()
      type("Description", " a document ")
      fireEvent.click(save)

      await waitFor(() => expect(sent).toHaveLength(1))
      expect(sent[0]?.intent).toBe("resourceTypes.update")
      const payload = sent[0]?.payload as Record<string, unknown>
      expect(payload).toEqual({ id: "rt_01a", description: "a document" })
      // toEqual ignores undefined-valued keys, and an untouched list sent as
      // undefined is still not the same as an absent one. Assert the keys.
      expect(Object.keys(payload).sort()).toEqual(["description", "id"])
    })

    it("leaves an untouched permissions list ABSENT, not an empty one", async () => {
      // The server reads a present empty list as "remove them all". An
      // untouched list sent as [] would wipe every permission on a save that
      // only meant to change the relations.
      const { client: c, sent } = recordingCommandClient(
        { "resourceTypes.detail": DETAIL },
        { "resourceTypes.update": { id: "rt_01a" } }
      )
      renderPage(WardenResourceTypeDetailPage, c, { id: "rt_01a" })
      const save = await openEdit()
      type("Relation 3 subject types", "folder, workspace")
      fireEvent.click(save)

      await waitFor(() => expect(sent).toHaveLength(1))
      const payload = sent[0]?.payload as Record<string, unknown>
      expect(payload).toEqual({
        id: "rt_01a",
        relations: [
          { name: "viewer", allowedSubjects: ["user"] },
          { name: "editor", allowedSubjects: ["user", "group#member"] },
          { name: "parent", allowedSubjects: ["folder", "workspace"] },
        ],
      })
      expect(Object.keys(payload).sort()).toEqual(["id", "relations"])
      expect(Object.keys(payload)).not.toContain("permissions")
      expect(Object.keys(payload)).not.toContain("description")
    })

    it("leaves an untouched relations list ABSENT when only a permission changed", async () => {
      const { client: c, sent } = recordingCommandClient(
        { "resourceTypes.detail": DETAIL },
        { "resourceTypes.update": { id: "rt_01a" } }
      )
      renderPage(WardenResourceTypeDetailPage, c, { id: "rt_01a" })
      const save = await openEdit()
      type("Permission 2 expression", "editor or viewer")
      fireEvent.click(save)

      await waitFor(() => expect(sent).toHaveLength(1))
      const payload = sent[0]?.payload as Record<string, unknown>
      // The whole permissions list goes, not just the row that changed: the
      // server replaces the list, it does not merge into it.
      expect(payload).toEqual({
        id: "rt_01a",
        permissions: [
          { name: "read", expression: "viewer or editor" },
          { name: "write", expression: "editor or viewer" },
          { name: "inherited", expression: "parent->read" },
        ],
      })
      expect(Object.keys(payload).sort()).toEqual(["id", "permissions"])
    })

    it("sends an EMPTY permissions list when the operator removed every permission", async () => {
      const { client: c, sent } = recordingCommandClient(
        { "resourceTypes.detail": DETAIL },
        { "resourceTypes.update": { id: "rt_01a" } }
      )
      renderPage(WardenResourceTypeDetailPage, c, { id: "rt_01a" })
      const save = await openEdit()
      // Removing a row renumbers the ones after it, so always remove the first.
      for (let n = 0; n < 3; n++) {
        fireEvent.click(screen.getByRole("button", { name: "Remove permission 1" }))
      }
      expect(screen.queryByLabelText("Permission 1 name")).toBeNull()
      fireEvent.click(save)

      await waitFor(() => expect(sent).toHaveLength(1))
      const payload = sent[0]?.payload as Record<string, unknown>
      expect(payload).toEqual({ id: "rt_01a", permissions: [] })
      expect(Object.keys(payload).sort()).toEqual(["id", "permissions"])
    })

    it("sends an empty relations list when every relation was removed", async () => {
      const { client: c, sent } = recordingCommandClient(
        { "resourceTypes.detail": DETAIL },
        { "resourceTypes.update": { id: "rt_01a" } }
      )
      renderPage(WardenResourceTypeDetailPage, c, { id: "rt_01a" })
      const save = await openEdit()
      for (let n = 0; n < 3; n++) {
        fireEvent.click(screen.getByRole("button", { name: "Remove relation 1" }))
      }
      fireEvent.click(save)
      await waitFor(() => expect(sent).toHaveLength(1))
      expect(sent[0]?.payload).toEqual({ id: "rt_01a", relations: [] })
    })

    it("sends an empty description when the operator cleared it, since that is a change", async () => {
      const { client: c, sent } = recordingCommandClient(
        { "resourceTypes.detail": DETAIL },
        { "resourceTypes.update": { id: "rt_01a" } }
      )
      renderPage(WardenResourceTypeDetailPage, c, { id: "rt_01a" })
      const save = await openEdit()
      type("Description", "")
      fireEvent.click(save)
      await waitFor(() => expect(sent).toHaveLength(1))
      expect(sent[0]?.payload).toEqual({ id: "rt_01a", description: "" })
    })

    it("sends everything that changed, together", async () => {
      const { client: c, sent } = recordingCommandClient(
        { "resourceTypes.detail": DETAIL },
        { "resourceTypes.update": { id: "rt_01a" } }
      )
      renderPage(WardenResourceTypeDetailPage, c, { id: "rt_01a" })
      const save = await openEdit()
      type("Description", "docs")
      type("Relation 1 subject types", "user, team")
      type("Permission 1 expression", "viewer")
      fireEvent.click(save)
      await waitFor(() => expect(sent).toHaveLength(1))
      const payload = sent[0]?.payload as Record<string, unknown>
      expect(Object.keys(payload).sort()).toEqual(["description", "id", "permissions", "relations"])
    })

    it("adds a relation and a permission, trimming names and splitting subject types", async () => {
      const { client: c, sent } = recordingCommandClient(
        { "resourceTypes.detail": detailOf({ relations: [], permissions: [] }) },
        { "resourceTypes.update": { id: "rt_01a" } }
      )
      renderPage(WardenResourceTypeDetailPage, c, { id: "rt_01a" })
      const save = await openEdit()
      fireEvent.click(screen.getByRole("button", { name: "Add relation" }))
      type("Relation 1 name", " owner ")
      type("Relation 1 subject types", " user ,, group#member , ")
      fireEvent.click(screen.getByRole("button", { name: "Add permission" }))
      type("Permission 1 name", " manage ")
      type("Permission 1 expression", " owner ")
      fireEvent.click(save)

      await waitFor(() => expect(sent).toHaveLength(1))
      expect(sent[0]?.payload).toEqual({
        id: "rt_01a",
        relations: [{ name: "owner", allowedSubjects: ["user", "group#member"] }],
        permissions: [{ name: "manage", expression: "owner" }],
      })
    })

    it("sends a relation with no subject types as an empty list, not as an absent key", async () => {
      const { client: c, sent } = recordingCommandClient(
        { "resourceTypes.detail": detailOf({ relations: [], permissions: [] }) },
        { "resourceTypes.update": { id: "rt_01a" } }
      )
      renderPage(WardenResourceTypeDetailPage, c, { id: "rt_01a" })
      const save = await openEdit()
      fireEvent.click(screen.getByRole("button", { name: "Add relation" }))
      type("Relation 1 name", "owner")
      fireEvent.click(save)
      await waitFor(() => expect(sent).toHaveLength(1))
      expect(sent[0]?.payload).toEqual({
        id: "rt_01a",
        relations: [{ name: "owner", allowedSubjects: [] }],
      })
    })

    it("drops a row the operator added and never filled in", async () => {
      const { client: c, sent } = recordingCommandClient(
        { "resourceTypes.detail": DETAIL },
        { "resourceTypes.update": { id: "rt_01a" } }
      )
      renderPage(WardenResourceTypeDetailPage, c, { id: "rt_01a" })
      const save = await openEdit()
      fireEvent.click(screen.getByRole("button", { name: "Add permission" }))
      // Adding a blank row is not a change.
      expect(save.disabled).toBe(true)
      type("Description", "docs")
      fireEvent.click(save)
      await waitFor(() => expect(sent).toHaveLength(1))
      expect(sent[0]?.payload).toEqual({ id: "rt_01a", description: "docs" })
    })

    it("cannot be saved while a row has content and no name", async () => {
      render()
      const save = await openEdit()
      fireEvent.click(screen.getByRole("button", { name: "Add permission" }))
      type("Permission 4 expression", "viewer")
      expect(save.disabled).toBe(true)
      expect(screen.getByText("Every relation and permission needs a name.")).toBeTruthy()
      type("Permission 4 name", "peek")
      expect(save.disabled).toBe(false)
      expect(screen.queryByText("Every relation and permission needs a name.")).toBeNull()
    })

    it("closes the form and returns to the tables once the save succeeds", async () => {
      const { client: c, sent } = recordingCommandClient(
        { "resourceTypes.detail": DETAIL },
        { "resourceTypes.update": { id: "rt_01a" } }
      )
      renderPage(WardenResourceTypeDetailPage, c, { id: "rt_01a" })
      const save = await openEdit()
      type("Description", "docs")
      fireEvent.click(save)
      await waitFor(() => expect(sent).toHaveLength(1))
      expect(await screen.findByRole("button", { name: "Edit" })).toBeTruthy()
      expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull()
    })

    it("closes the form on cancel without sending anything", async () => {
      const { client: c, sent } = recordingCommandClient({ "resourceTypes.detail": DETAIL })
      renderPage(WardenResourceTypeDetailPage, c, { id: "rt_01a" })
      await openEdit()
      type("Description", "docs")
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
      expect(await screen.findByRole("button", { name: "Edit" })).toBeTruthy()
      expect(sent).toHaveLength(0)
    })

    it("forgets an abandoned edit when the form is opened again", async () => {
      render()
      await openEdit()
      type("Description", "docs")
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
      fireEvent.click(await screen.findByRole("button", { name: "Edit" }))
      expect(field("Description").value).toBe("a file")
    })

    it("shows the save as pending while the command is in flight", async () => {
      const c = {
        ...client(),
        command: () => new Promise<never>(() => {}),
      } as ScopedClient
      renderPage(WardenResourceTypeDetailPage, c, { id: "rt_01a" })
      const save = await openEdit()
      type("Description", "docs")
      fireEvent.click(save)
      const working = (await screen.findByRole("button", { name: "Saving…" })) as HTMLButtonElement
      expect(working.disabled).toBe(true)
      expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true)
    })

    it("shows an ordinary refusal in the form and keeps what was typed", async () => {
      const { client: c } = refusing(
        new ContractError("PERMISSION_DENIED", "you may not change resource types")
      )
      renderPage(WardenResourceTypeDetailPage, c, { id: "rt_01a" })
      const save = await openEdit()
      type("Description", "docs")
      fireEvent.click(save)
      const alert = await screen.findByRole("alert")
      expect(alert.textContent).toContain("you may not change resource types")
      expect(alert.textContent).toContain("PERMISSION_DENIED")
      expect(field("Description").value).toBe("docs")
    })

    it("falls back to the ordinary alert for a refusal whose details are not diagnostics", async () => {
      const { client: c } = refusing(
        new ContractError("BAD_REQUEST", "relation viewer is declared twice", { field: "relations" })
      )
      renderPage(WardenResourceTypeDetailPage, c, { id: "rt_01a" })
      const save = await openEdit()
      type("Relation 1 subject types", "user, team")
      fireEvent.click(save)
      const alert = await screen.findByRole("alert")
      expect(alert.textContent).toContain("relation viewer is declared twice")
    })
  })

  describe("the server's expression diagnostics", () => {
    // The local fixture server cannot deliver `details` to the page: a wiring
    // gap in server.mjs drops them and reports every warden refusal as
    // BAD_REQUEST. So these use a client that throws with explicit details,
    // and a fixture check would prove nothing about this path.
    async function refuse(
      error: ContractError,
      edit: () => void,
      detail: ResourceTypeDetail = DETAIL
    ) {
      const { client: c, sent } = refusing(error, detail)
      renderPage(WardenResourceTypeDetailPage, c, { id: "rt_01a" })
      const save = await openEdit()
      edit()
      fireEvent.click(save)
      await waitFor(() => expect(sent).toHaveLength(1))
      return { sent, save }
    }

    it("shows the diagnostic against the expression that failed", async () => {
      // resourceTypes.update refuses an unparseable or dangling expression
      // with a diagnostic carrying a column. Showing it against the right
      // expression is the whole value of having it.
      await refuse(badExpression(diag({ permission: "read" })), () =>
        type("Permission 1 expression", "viewer or ghost")
      )
      const row = await waitFor(() => {
        const g = group("Permission 1")
        g.getByText(/relation ghost is not declared on this type/)
        return g
      })
      expect(row.getByText(/relation ghost is not declared on this type/)).toBeTruthy()
    })

    it("anchors the diagnostic by permission name, not to the first row or the last", async () => {
      // Two permissions are wrong, and the diagnostics name them out of
      // order. Each must land on the row it names, and the healthy row in the
      // middle must carry neither.
      await refuse(
        badExpression(
          diag({ permission: "inherited", col: 1, message: "relation spectre is not declared on this type" }),
          diag({ permission: "read", col: 11, message: "relation ghost is not declared on this type" })
        ),
        () => {
          type("Permission 1 expression", "viewer or ghost")
          type("Permission 3 expression", "spectre")
        }
      )
      await screen.findByText(/relation ghost is not declared/)
      const first = group("Permission 1")
      const second = group("Permission 2")
      const third = group("Permission 3")
      expect(first.getByText(/relation ghost is not declared/)).toBeTruthy()
      expect(first.queryByText(/spectre/)).toBeNull()
      expect(second.queryByText(/not declared/)).toBeNull()
      expect(third.getByText(/relation spectre is not declared/)).toBeTruthy()
      expect(third.queryByText(/ghost/)).toBeNull()
    })

    it("puts the diagnostic on the row and not in a banner", async () => {
      await refuse(badExpression(diag()), () => type("Permission 1 expression", "viewer or ghost"))
      await screen.findByText(/relation ghost is not declared/)
      // Exactly one place says it: the row. The alert says only that the save
      // did not happen, so no problem is reported twice.
      expect(screen.getAllByText(/relation ghost is not declared/)).toHaveLength(1)
      const alert = screen.getByRole("alert")
      expect(alert.textContent).toContain("Not saved")
      expect(alert.textContent).not.toContain("ghost")
      expect(alert.closest('[role="group"]')).toBeNull()
      expect(group("Permission 1").getByText(/relation ghost is not declared/)).toBeTruthy()
    })

    it("marks the input invalid and ties the message to it", async () => {
      await refuse(badExpression(diag()), () => type("Permission 1 expression", "viewer or ghost"))
      await screen.findByText(/relation ghost is not declared/)
      const input = field("Permission 1 expression")
      expect(input.getAttribute("aria-invalid")).toBe("true")
      const describedBy = input.getAttribute("aria-describedby")
      expect(describedBy).toBeTruthy()
      expect(document.getElementById(describedBy!)?.textContent).toContain("relation ghost is not declared")
      // The rows that were fine are not marked.
      expect(field("Permission 2 expression").getAttribute("aria-invalid")).toBeNull()
    })

    it("points at a column, and does not present line 1 as though it meant something", async () => {
      await refuse(badExpression(diag({ line: 1, col: 11 })), () =>
        type("Permission 1 expression", "viewer or ghost")
      )
      const message = await screen.findByText(/relation ghost is not declared/)
      expect(message.textContent).toBe("At column 11: relation ghost is not declared on this type")
      expect(screen.queryByText(/line 1/i)).toBeNull()
    })

    it("does mention the line when it is something other than the first", async () => {
      await refuse(badExpression(diag({ line: 2, col: 3 })), () =>
        type("Permission 1 expression", "viewer or\n  ghost")
      )
      const message = await screen.findByText(/relation ghost is not declared/)
      expect(message.textContent).toBe("At line 2, column 3: relation ghost is not declared on this type")
    })

    it("draws a pointer under the column while the text is still what was sent", async () => {
      await refuse(badExpression(diag({ col: 11 })), () =>
        type("Permission 1 expression", "viewer or ghost")
      )
      await screen.findByText(/relation ghost is not declared/)
      const pointer = document.querySelector("pre")!
      expect(pointer.textContent).toBe("viewer or ghost\n          ^")
      // Ten spaces, so the caret is under the 11th character: the g.
      expect(pointer.textContent!.split("\n")[1]).toBe(" ".repeat(10) + "^")
      expect(pointer.getAttribute("aria-hidden")).toBe("true")
    })

    it("drops the pointer once the operator edits the expression, because it would point at the wrong place", async () => {
      await refuse(badExpression(diag({ col: 11 })), () =>
        type("Permission 1 expression", "viewer or ghost")
      )
      await screen.findByText(/relation ghost is not declared/)
      type("Permission 1 expression", "viewer or gh")
      expect(document.querySelector("pre")).toBeNull()
      // The message is still there: it is still true of what was sent.
      expect(screen.getByText(/relation ghost is not declared/)).toBeTruthy()
    })

    it("anchors a diagnostic to a permission whose expression was not touched", async () => {
      // Only the relations changed, so permissions was not sent. The server
      // still validated the stored permissions against the new relations, and
      // a stored expression that referenced the removed relation is refused.
      // The row exists in the form, so the diagnostic belongs on it.
      const { sent } = await refuse(
        badExpression(diag({ permission: "write", col: 1, message: "relation editor is not declared on this type" })),
        () => fireEvent.click(screen.getByRole("button", { name: "Remove relation 2" }))
      )
      const payload = sent[0]?.payload as Record<string, unknown>
      expect(Object.keys(payload)).not.toContain("permissions")
      await screen.findByText(/relation editor is not declared/)
      expect(group("Permission 2").getByText(/relation editor is not declared/)).toBeTruthy()
      expect(group("Permission 1").queryByText(/not declared/)).toBeNull()
    })

    it("shows several diagnostics against one expression", async () => {
      await refuse(
        badExpression(
          diag({ col: 1, message: "relation a is not declared on this type" }),
          diag({ col: 6, message: "relation b is not declared on this type" })
        ),
        () => type("Permission 1 expression", "a or b")
      )
      await screen.findByText(/relation a is not declared/)
      const row = group("Permission 1")
      expect(row.getByText(/relation a is not declared/)).toBeTruthy()
      expect(row.getByText(/relation b is not declared/)).toBeTruthy()
      expect(screen.getByRole("alert").textContent).toContain("2 expressions")
    })

    it("does not lose a diagnostic that names a permission the form no longer has", async () => {
      await refuse(
        badExpression(diag({ permission: "ghostly", col: 1, message: "expected expression, got EOF" })),
        () => type("Description", "docs")
      )
      // Nothing on any row names `ghostly`, so it is listed rather than dropped.
      expect(await screen.findByText(/ghostly, column 1: expected expression, got EOF/)).toBeTruthy()
      for (const n of [1, 2, 3]) {
        expect(group(`Permission ${n}`).queryByText(/expected expression/)).toBeNull()
      }
    })

    it("keeps everything the operator typed", async () => {
      await refuse(badExpression(diag()), () => {
        type("Description", "docs")
        type("Permission 1 expression", "viewer or ghost")
      })
      await screen.findByText(/relation ghost is not declared/)
      expect(field("Description").value).toBe("docs")
      expect(field("Permission 1 expression").value).toBe("viewer or ghost")
      expect(screen.getByRole("button", { name: "Save changes" })).toBeTruthy()
    })

    it("clears the diagnostics when the operator saves again", async () => {
      // First attempt refused, second attempt pending: the old diagnostics
      // describe a save that is no longer the current one.
      let calls = 0
      const c = {
        ...client(),
        command: () => {
          calls++
          return calls === 1
            ? Promise.reject(badExpression(diag()))
            : new Promise<never>(() => {})
        },
      } as ScopedClient
      renderPage(WardenResourceTypeDetailPage, c, { id: "rt_01a" })
      const save = await openEdit()
      type("Permission 1 expression", "viewer or ghost")
      fireEvent.click(save)
      await screen.findByText(/relation ghost is not declared/)
      type("Permission 1 expression", "viewer")
      fireEvent.click(save)
      await screen.findByRole("button", { name: "Saving…" })
      expect(screen.queryByText(/relation ghost is not declared/)).toBeNull()
    })

    it("does not present a diagnostic when the refusal carries none for this form", async () => {
      // Details present but empty: an ordinary refusal, in the ordinary alert.
      await refuse(
        new ContractError("BAD_REQUEST", "a permission needs a name", { diagnostics: [] }),
        () => type("Description", "docs")
      )
      const alert = await screen.findByRole("alert")
      expect(alert.textContent).toContain("a permission needs a name")
    })
  })
})
