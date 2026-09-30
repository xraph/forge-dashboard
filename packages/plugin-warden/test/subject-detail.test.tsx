import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { WardenSubjectDetailPage } from "../src/pages/subject-detail"
import type { SubjectDetail } from "../src/pages/subject-detail"
import { failingClient, recordingQueryClient, renderPage } from "./harness"

const EMPTY: SubjectDetail = {
  roles: [],
  assignments: [],
  assignmentsTruncated: false,
  relations: [],
  relationsTruncated: false,
  policies: [],
  recentChecks: [],
}

const NAMESPACES = { namespaces: ["", "acme", "acme/eng"] }

const CHECK = {
  id: "chk_1",
  namespacePath: "",
  subjectKind: "user",
  subjectId: "alice",
  action: "read",
  resourceType: "document",
  resourceId: "doc1",
  decision: "allow",
  evalTimeNs: 1800,
  cached: false,
  createdAt: "2026-09-29T10:00:00Z",
}

const FULL: SubjectDetail = {
  roles: [
    {
      id: "role_editor",
      slug: "editor",
      name: "Editor",
      namespacePath: "acme",
      via: "assigned",
      inheritedBy: [],
      permissions: [
        { name: "document:write", resource: "document", action: "write" },
        { name: "document:*", resource: "document", action: "*" },
      ],
    },
    {
      id: "role_reader",
      slug: "reader",
      name: "Reader",
      namespacePath: "acme",
      via: "inherited",
      inheritedBy: ["editor", "auditor"],
      permissions: [{ name: "document:read", resource: "document", action: "read" }],
    },
    {
      id: "role_bare",
      slug: "bare",
      name: "Bare",
      namespacePath: "",
      via: "assigned",
      inheritedBy: [],
      permissions: [],
    },
  ],
  assignments: [
    {
      id: "asg_1",
      namespacePath: "acme",
      roleId: "role_editor",
      roleSlug: "editor",
      expired: false,
      expiringSoon: false,
    },
    {
      id: "asg_2",
      namespacePath: "acme/eng",
      roleId: "role_reader",
      roleSlug: "reader",
      resourceType: "document",
      resourceId: "doc9",
      expiresAt: "2026-10-01T00:00:00Z",
      expired: false,
      expiringSoon: true,
    },
    {
      id: "asg_3",
      namespacePath: "",
      roleId: "role_bare",
      roleSlug: "bare",
      expiresAt: "2026-01-01T00:00:00Z",
      expired: true,
      expiringSoon: false,
    },
  ],
  assignmentsTruncated: false,
  relations: [
    {
      id: "rel_1",
      namespacePath: "acme",
      objectType: "folder",
      objectId: "f1",
      relation: "viewer",
    },
  ],
  relationsTruncated: false,
  policies: [
    { id: "pol_a", name: "allow-all", effect: "allow", priority: 10, namespacePath: "", selectedBy: "everyone" },
    { id: "pol_b", name: "block-users", effect: "deny", priority: 20, namespacePath: "acme", selectedBy: "kind" },
    { id: "pol_c", name: "block-alice", effect: "deny", priority: 30, namespacePath: "acme", selectedBy: "id" },
    { id: "pol_d", name: "editors-only", effect: "allow", priority: 40, namespacePath: "acme", selectedBy: "role:editor" },
  ],
  recentChecks: [CHECK],
}

const PARAMS = { kind: "user", id: "alice" }

function setup(detail: SubjectDetail = FULL, params = PARAMS) {
  const rec = recordingQueryClient({
    "subjects.detail": detail,
    "namespaces.list": NAMESPACES,
  })
  const view = renderPage(WardenSubjectDetailPage, rec.client, params)
  return { ...rec, view }
}

function section(heading: string): HTMLElement {
  const h = screen.getByRole("heading", { name: heading })
  const el = h.closest("section")
  if (!el) throw new Error(`no section around "${heading}"`)
  return el
}

describe("WardenSubjectDetailPage header", () => {
  it("names the subject in mono and starts at the root, sent as an empty path", async () => {
    const { sent } = setup()
    const title = await screen.findByRole("heading", { level: 1, name: "user:alice" })
    expect(title.className).toContain("font-mono")
    expect(await screen.findByText("Showing access at /.")).toBeTruthy()
    const detail = sent.filter((s) => s.intent === "subjects.detail")
    expect(detail[0]?.params).toEqual({
      subjectKind: "user",
      subjectId: "alice",
      namespacePath: "",
    })
  })

  it("sends the route params exactly as given", async () => {
    const { sent } = setup(EMPTY, { kind: "api key", id: "a/b c" })
    await screen.findByText("Showing access at /.")
    expect(sent.find((s) => s.intent === "subjects.detail")?.params).toEqual({
      subjectKind: "api key",
      subjectId: "a/b c",
      namespacePath: "",
    })
  })

  it("offers the namespaces as suggestions, the root as /", async () => {
    setup()
    await screen.findByText("Showing access at /.")
    const input = screen.getByLabelText("Namespace") as HTMLInputElement
    const list = document.getElementById(input.getAttribute("list") ?? "")
    await waitFor(() => {
      const values = Array.from(
        document.getElementById(input.getAttribute("list") ?? "")?.querySelectorAll("option") ?? [],
      ).map((o) => o.getAttribute("value"))
      expect(values).toEqual(["/", "acme", "acme/eng"])
    })
    expect(list).toBeTruthy()
    expect(input.value).toBe("/")
  })

  it("sends a new subjects.detail when a suggested namespace is chosen", async () => {
    const { sent } = setup()
    await screen.findByText("Showing access at /.")
    await waitFor(() =>
      expect(sent.some((s) => s.intent === "namespaces.list")).toBe(true),
    )
    fireEvent.change(screen.getByLabelText("Namespace"), { target: { value: "acme/eng" } })
    expect(await screen.findByText("Showing access at acme/eng.")).toBeTruthy()
    const detail = sent.filter((s) => s.intent === "subjects.detail")
    expect(detail.at(-1)?.params).toEqual({
      subjectKind: "user",
      subjectId: "alice",
      namespacePath: "acme/eng",
    })
    expect(screen.getByRole("heading", { name: "Roles at acme/eng" })).toBeTruthy()
  })

  it("does not ask while a namespace is half typed, and asks on blur", async () => {
    const { sent } = setup()
    await screen.findByText("Showing access at /.")
    const before = sent.filter((s) => s.intent === "subjects.detail").length
    const input = screen.getByLabelText("Namespace")
    fireEvent.change(input, { target: { value: "acme/en" } })
    expect(sent.filter((s) => s.intent === "subjects.detail").length).toBe(before)
    fireEvent.blur(input)
    expect(await screen.findByText("Showing access at acme/en.")).toBeTruthy()
    expect(sent.filter((s) => s.intent === "subjects.detail").at(-1)?.params).toMatchObject({
      namespacePath: "acme/en",
    })
  })

  it("sends the root as an empty path when / is typed back", async () => {
    const { sent } = setup()
    await screen.findByText("Showing access at /.")
    const input = screen.getByLabelText("Namespace")
    fireEvent.change(input, { target: { value: "acme" } })
    await screen.findByText("Showing access at acme.")
    fireEvent.change(input, { target: { value: "/" } })
    await screen.findByText("Showing access at /.")
    expect(sent.filter((s) => s.intent === "subjects.detail").at(-1)?.params).toMatchObject({
      namespacePath: "",
    })
  })

  it("links to the playground", async () => {
    setup()
    const link = await screen.findByRole("link", { name: "Run a check as this subject" })
    expect(link.getAttribute("href")).toBe("/playground")
  })
})

describe("roles section", () => {
  it("lists each role with its link, namespace, how it was reached and permission chips", async () => {
    setup()
    const roles = within(await screen.findByRole("region", { name: "3 roles" }))
    const editor = within(roles.getByText("editor").closest("tr") as HTMLElement)
    expect(editor.getByRole("link", { name: "editor" }).getAttribute("href")).toBe(
      "/roles/role_editor",
    )
    expect(editor.getByText("acme")).toBeTruthy()
    expect(editor.getByText("assigned")).toBeTruthy()
    const chip = editor.getByText("document:write")
    expect(chip.className).toContain("font-mono")
    expect(editor.getByText("document:*")).toBeTruthy()

    const reader = within(roles.getByText("reader").closest("tr") as HTMLElement)
    expect(reader.getByText("inherited from editor, auditor")).toBeTruthy()
    expect(reader.getByText("document:read")).toBeTruthy()
  })

  it("says a role with no permissions has none, and an assigned role is not called inherited", async () => {
    setup()
    const roles = within(await screen.findByRole("region", { name: "3 roles" }))
    const bare = within(roles.getByText("bare").closest("tr") as HTMLElement)
    expect(bare.getByLabelText("no permissions")).toBeTruthy()
    expect(bare.queryByText(/inherited/)).toBeNull()
  })

  it("is headed by the namespace and explains resource-scoped roles", async () => {
    setup()
    const s = await screen.findByRole("heading", { name: "Roles at /" })
    expect(s).toBeTruthy()
    const note = screen.getByText(
      "Roles assigned for one resource only are listed under assignments. They grant only for checks on that resource.",
    )
    expect(note.className).toContain("text-muted-foreground")
  })

  it("names the empty case", async () => {
    setup(EMPTY)
    expect(await screen.findByText("This subject holds no role at /.")).toBeTruthy()
  })
})

describe("assignments section", () => {
  it("shows role, namespace, resource, expiry and the two badges", async () => {
    setup()
    await screen.findByRole("heading", { name: "Assignments" })
    const table = within(section("Assignments"))

    const plain = within(table.getByText("acme", { selector: "td *, td" }).closest("tr") as HTMLElement)
    expect(plain.getByText("every resource")).toBeTruthy()
    expect(plain.getByLabelText("no expiry")).toBeTruthy()
    expect(plain.queryByText("expires soon")).toBeNull()
    expect(plain.queryByText("expired")).toBeNull()

    const scoped = within(table.getByText("acme/eng").closest("tr") as HTMLElement)
    expect(scoped.getByText("document:doc9").className).toContain("font-mono")
    const soon = scoped.getByText("expires soon")
    expect(soon.getAttribute("data-variant")).toBe("secondary")
    expect(scoped.queryByLabelText("no expiry")).toBeNull()

    const lapsed = within(table.getByText("bare").closest("tr") as HTMLElement)
    expect(lapsed.getByText("expired").getAttribute("data-variant")).toBe("destructive")
  })

  it("explains expiry only when a row is expired", async () => {
    setup()
    const sentence =
      "An expired assignment grants nothing. It stays listed until maintenance removes it."
    expect(await screen.findByText(sentence)).toBeTruthy()
  })

  it("leaves the expiry sentence out when nothing is expired", async () => {
    const live = { ...FULL, assignments: FULL.assignments.filter((a) => !a.expired) }
    setup(live)
    await screen.findByRole("heading", { name: "Assignments" })
    expect(screen.queryByText(/An expired assignment grants nothing/)).toBeNull()
  })

  it("says when the list was cut", async () => {
    setup({ ...FULL, assignmentsTruncated: true })
    expect(await screen.findByText("Showing the first 200 assignments.")).toBeTruthy()
  })

  it("does not claim a cut when there was none", async () => {
    setup()
    await screen.findByRole("heading", { name: "Assignments" })
    expect(screen.queryByText(/Showing the first/)).toBeNull()
  })

  it("names the empty case", async () => {
    setup(EMPTY)
    expect(
      await screen.findByText("This subject has no assignments in any namespace."),
    ).toBeTruthy()
  })
})

describe("relations section", () => {
  it("shows object, relation and namespace, and what the list leaves out", async () => {
    setup()
    await screen.findByRole("heading", { name: "Relations" })
    const row = within(section("Relations").querySelector("tbody tr") as HTMLElement)
    expect(row.getByText("folder:f1").className).toContain("font-mono")
    expect(row.getByText("viewer")).toBeTruthy()
    expect(row.getByText("acme")).toBeTruthy()
    expect(
      screen.getByText(
        "Direct relation tuples only. A relation reached through a group or a parent object is found by the check itself; try it in the playground.",
      ),
    ).toBeTruthy()
  })

  it("says when the list was cut, and only then", async () => {
    const { view } = setup({ ...FULL, relationsTruncated: true })
    expect(await screen.findByText("Showing the first 200 relations.")).toBeTruthy()
    view.unmount()
    setup()
    await screen.findByRole("heading", { name: "Relations" })
    expect(screen.queryByText("Showing the first 200 relations.")).toBeNull()
  })

  it("names the empty case", async () => {
    setup(EMPTY)
    expect(await screen.findByText("No relation tuple names this subject.")).toBeTruthy()
  })
})

describe("policies section", () => {
  it("is headed by the namespace and links each policy", async () => {
    setup()
    const heading = await screen.findByRole("heading", {
      name: "Policies that select this subject at /",
    })
    const table = within(heading.closest("section") as HTMLElement)
    expect(table.getByRole("link", { name: "block-users" }).getAttribute("href")).toBe(
      "/policies/pol_b",
    )
    const row = within(table.getByText("block-users").closest("tr") as HTMLElement)
    expect(row.getByText("20")).toBeTruthy()
    expect(row.getByText("acme")).toBeTruthy()
  })

  it("draws Deny in the destructive colour and Allow in the foreground colour", async () => {
    setup()
    const heading = await screen.findByRole("heading", {
      name: "Policies that select this subject at /",
    })
    const table = within(heading.closest("section") as HTMLElement)
    const deny = within(table.getByText("block-users").closest("tr") as HTMLElement).getByText("Deny")
    expect(deny.className).toContain("text-destructive")
    const allow = within(table.getByText("allow-all").closest("tr") as HTMLElement).getByText("Allow")
    expect(allow.className).toContain("text-foreground")
    expect(allow.className).not.toContain("text-destructive")
  })

  it("reads how each policy selects the subject", async () => {
    setup()
    const heading = await screen.findByRole("heading", {
      name: "Policies that select this subject at /",
    })
    const table = within(heading.closest("section") as HTMLElement)
    const how = (name: string) =>
      within(table.getByText(name).closest("tr") as HTMLElement)
    expect(how("allow-all").getByText("every subject")).toBeTruthy()
    expect(how("block-users").getByText("subjects of this kind")).toBeTruthy()
    expect(how("block-alice").getByText("this subject")).toBeTruthy()
    expect(how("editors-only").getByText("holders of editor")).toBeTruthy()
  })

  it("says selecting is not applying", async () => {
    setup()
    expect(
      await screen.findByText(
        "Selecting is not applying. Each policy's actions, resources, window and conditions decide whether it applies to a given check.",
      ),
    ).toBeTruthy()
  })

  it("names the empty case", async () => {
    setup(EMPTY)
    expect(
      await screen.findByText("No policy in effect selects this subject at /."),
    ).toBeTruthy()
  })
})

describe("recent checks section", () => {
  it("uses the check log's columns and links each row to its detail", async () => {
    setup()
    await screen.findByRole("heading", { name: "Recent checks" })
    const table = within(section("Recent checks"))
    for (const header of [
      "When",
      "Subject",
      "Action",
      "Resource",
      "Namespace",
      "Decision",
      "Detail",
      "Cached",
    ]) {
      expect(table.getByRole("columnheader", { name: header })).toBeTruthy()
    }
    const row = within(table.getByText("document:doc1").closest("tr") as HTMLElement)
    expect(row.getAllByRole("link")[0]?.getAttribute("href")).toBe("/check-log/chk_1")
    expect(row.getByText("allow")).toBeTruthy()
  })

  it("shows at most ten rows", async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      ...CHECK,
      id: `chk_${i}`,
      resourceId: `doc${i}`,
    }))
    setup({ ...FULL, recentChecks: many })
    await screen.findByRole("heading", { name: "Recent checks" })
    expect(section("Recent checks").querySelectorAll("tbody tr").length).toBe(10)
  })

  it("links to the check log", async () => {
    setup()
    const link = await screen.findByRole("link", { name: "Open the check log" })
    expect(link.getAttribute("href")).toBe("/check-log")
  })

  it("names the empty case", async () => {
    setup(EMPTY)
    expect(await screen.findByText("No check has been logged for this subject.")).toBeTruthy()
  })
})

describe("a refused query", () => {
  it("renders the error card and keeps the namespace control", async () => {
    renderPage(
      WardenSubjectDetailPage,
      failingClient(new ContractError("PERMISSION_DENIED", "not allowed")),
      PARAMS,
    )
    expect(await screen.findByText("Subject access unavailable")).toBeTruthy()
    expect(screen.queryByText(/Showing access at/)).toBeNull()
    expect(screen.getByLabelText("Namespace")).toBeTruthy()
  })
})
