import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import type { ScopedClient } from "@forge-go/dashboard-plugin"
import { WardenSubjectDetailPage } from "../src/pages/subject-detail"
import type { SubjectDetail, WithheldSection } from "../src/pages/subject-detail"
import type { CheckSummary } from "../src/components/check-log"
import type { ConfigDetail } from "../src/pages/config"
import { failingClient, recordingQueryClient, renderPage } from "./harness"

const EMPTY: SubjectDetail = {
  roles: [],
  assignments: [],
  assignmentsTruncated: false,
  relations: [],
  relationsTruncated: false,
  policies: [],
  withheld: [],
}

const NAMESPACES = { namespaces: ["", "acme", "acme/eng"] }

const CHECK: CheckSummary = {
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
  withheld: [],
}

const PARAMS = { kind: "user", id: "alice" }

const CONFIG: ConfigDetail = {
  maxGraphDepth: 10,
  maxGraphVisited: 1000,
  maxGraphFanout: 100,
  maxBatchChecks: 50,
  cacheTtlSeconds: 60,
  cacheMaxSize: 1000,
  rbacEnabled: true,
  abacEnabled: true,
  rebacEnabled: true,
  checkLogEnabled: true,
  requireTenant: false,
  evaluateAllModels: false,
  checkLogQueueSize: 1000,
  checkLogRetentionHours: 720,
  maintenanceIntervalMinutes: 60,
}

function checkList(items: CheckSummary[]) {
  return { items, total: items.length, limit: 10, offset: 0 }
}

interface SetupOptions {
  checks?: CheckSummary[]
  /** null leaves config.detail out, so the stub refuses it. */
  config?: ConfigDetail | null
}

function setup(detail: SubjectDetail = FULL, params = PARAMS, opts: SetupOptions = {}) {
  const answers: Record<string, unknown> = {
    "subjects.detail": detail,
    "namespaces.list": NAMESPACES,
    "checkLogs.list": checkList(opts.checks ?? [CHECK]),
  }
  if (opts.config !== null) answers["config.detail"] = opts.config ?? CONFIG
  const rec = recordingQueryClient(answers)
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
    expect(await screen.findByText("Roles and policies are shown at /. Assignments, relations and recent checks cover every namespace.")).toBeTruthy()
    const detail = sent.filter((s) => s.intent === "subjects.detail")
    expect(detail[0]?.params).toEqual({
      subjectKind: "user",
      subjectId: "alice",
      namespacePath: "",
    })
  })

  it("sends the route params exactly as given", async () => {
    const { sent } = setup(EMPTY, { kind: "api key", id: "a/b c" })
    await screen.findByText("Roles and policies are shown at /. Assignments, relations and recent checks cover every namespace.")
    expect(sent.find((s) => s.intent === "subjects.detail")?.params).toEqual({
      subjectKind: "api key",
      subjectId: "a/b c",
      namespacePath: "",
    })
  })

  it("offers the namespaces as suggestions, the root as /", async () => {
    setup()
    await screen.findByText("Roles and policies are shown at /. Assignments, relations and recent checks cover every namespace.")
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
    await screen.findByText("Roles and policies are shown at /. Assignments, relations and recent checks cover every namespace.")
    await waitFor(() =>
      expect(sent.some((s) => s.intent === "namespaces.list")).toBe(true),
    )
    fireEvent.change(screen.getByLabelText("Namespace"), { target: { value: "acme/eng" } })
    expect(await screen.findByText("Roles and policies are shown at acme/eng. Assignments, relations and recent checks cover every namespace.")).toBeTruthy()
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
    await screen.findByText("Roles and policies are shown at /. Assignments, relations and recent checks cover every namespace.")
    const before = sent.filter((s) => s.intent === "subjects.detail").length
    const input = screen.getByLabelText("Namespace")
    fireEvent.change(input, { target: { value: "acme/en" } })
    expect(sent.filter((s) => s.intent === "subjects.detail").length).toBe(before)
    fireEvent.blur(input)
    expect(await screen.findByText("Roles and policies are shown at acme/en. Assignments, relations and recent checks cover every namespace.")).toBeTruthy()
    expect(sent.filter((s) => s.intent === "subjects.detail").at(-1)?.params).toMatchObject({
      namespacePath: "acme/en",
    })
  })

  it("sends the root as an empty path when / is typed back", async () => {
    const { sent } = setup()
    await screen.findByText("Roles and policies are shown at /. Assignments, relations and recent checks cover every namespace.")
    const input = screen.getByLabelText("Namespace")
    fireEvent.change(input, { target: { value: "acme" } })
    await screen.findByText("Roles and policies are shown at acme. Assignments, relations and recent checks cover every namespace.")
    fireEvent.change(input, { target: { value: "/" } })
    await screen.findByText("Roles and policies are shown at /. Assignments, relations and recent checks cover every namespace.")
    expect(sent.filter((s) => s.intent === "subjects.detail").at(-1)?.params).toMatchObject({
      namespacePath: "",
    })
  })

  it("links to the playground", async () => {
    setup()
    const link = await screen.findByRole("link", { name: "Open the playground" })
    expect(link.getAttribute("href")).toBe("/playground")
  })
})

describe("roles section", () => {
  it("lists each role with its link, namespace, how it was reached and permission chips", async () => {
    setup()
    const roles = within(await screen.findByRole("region", { name: "3 roles" }))
    const editor = within(
      roles.getByRole("link", { name: "editor" }).closest("tr") as HTMLElement,
    )
    const editorLink = editor.getByRole("link", { name: "editor" })
    expect(editorLink.getAttribute("href")).toBe("/roles/role_editor")
    expect(editorLink.className).toContain("font-mono")
    expect(editorLink.className).toContain("text-xs")
    expect(editor.getByText("acme")).toBeTruthy()
    expect(editor.getByText("assigned")).toBeTruthy()
    const chip = editor.getByText("document:write")
    expect(chip.className).toContain("font-mono")
    expect(editor.getByText("document:*")).toBeTruthy()

    const readerRow = roles.getByRole("link", { name: "reader" }).closest("tr") as HTMLElement
    const reader = within(readerRow)
    const how = readerRow.querySelectorAll("td")[2] as HTMLElement
    expect(how.textContent).toBe("held through editor, auditor")
    expect(Array.from(how.querySelectorAll("span.font-mono.text-xs")).map((e) => e.textContent)).toEqual([
      "editor",
      "auditor",
    ])
    expect(reader.getByText("document:read")).toBeTruthy()
  })

  it("says a role with no permissions has none, and an assigned role with no children reads as plain assigned", async () => {
    setup()
    const roles = within(await screen.findByRole("region", { name: "3 roles" }))
    const bare = within(roles.getByRole("link", { name: "bare" }).closest("tr") as HTMLElement)
    expect(bare.getByLabelText("no permissions")).toBeTruthy()
    expect(bare.getByText("assigned")).toBeTruthy()
    expect(bare.queryByText(/inherited|held through/)).toBeNull()
  })

  it("says an assigned role that another held role inherits is also held through it", async () => {
    const role = { ...FULL.roles[0]!, via: "assigned", inheritedBy: ["admin", "auditor"] }
    setup({ ...FULL, roles: [role] })
    await screen.findByRole("heading", { name: "Roles at /" })
    const link = within(section("Roles at /")).getByRole("link", { name: "editor" })
    const how = (link.closest("tr") as HTMLElement).querySelectorAll("td")[2] as HTMLElement
    expect(how.textContent).toBe("assigned, also held through admin, auditor")
    expect(Array.from(how.querySelectorAll("span.font-mono.text-xs")).map((e) => e.textContent)).toEqual([
      "admin",
      "auditor",
    ])
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

  it("says the resource-scoped roles are among the assignments when that list was cut", async () => {
    setup({ ...FULL, assignmentsTruncated: true })
    const note = await screen.findByText(
      "Roles assigned for one resource only are among the assignments. They grant only for checks on that resource.",
    )
    expect(note.className).toContain("text-muted-foreground")
    expect(screen.queryByText(/are listed under assignments/)).toBeNull()
  })

  it("names the empty case", async () => {
    setup(EMPTY)
    expect(await screen.findByText("No role reaches this subject at /. Assignments for a single resource, in another namespace, or already expired are listed below.")).toBeTruthy()
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
    const relation = row.getByText("viewer")
    expect(relation.closest("td")?.className).toContain("font-mono")
    expect(relation.closest("td")?.className).toContain("text-xs")
    expect(row.getByText("acme")).toBeTruthy()
    expect(
      screen.getByText(
        "Direct relation tuples only. A relation reached through a group, a parent object or a resource type's permission expression is found by the check itself; try it in the playground.",
      ),
    ).toBeTruthy()
  })

  it("shows a userset's subject relation after the subject, in mono", async () => {
    setup(
      {
        ...EMPTY,
        relations: [
          { id: "rel_u", namespacePath: "", objectType: "document", objectId: "readme", relation: "editor", subjectRelation: "member" },
          { id: "rel_d", namespacePath: "", objectType: "document", objectId: "spec", relation: "viewer" },
        ],
      },
      { kind: "group", id: "eng" },
    )
    await screen.findByRole("heading", { name: "Relations" })
    const table = within(section("Relations"))
    expect(table.getByRole("columnheader", { name: "Subject" })).toBeTruthy()
    const userset = table.getByText("document:readme").closest("tr") as HTMLElement
    const subject = userset.querySelectorAll("td")[2] as HTMLElement
    expect(subject.textContent).toBe("group:eng#member")
    const rel = within(subject).getByText("#member")
    expect(rel.className).toContain("font-mono")
    const direct = table.getByText("document:spec").closest("tr") as HTMLElement
    expect((direct.querySelectorAll("td")[2] as HTMLElement).textContent).toBe("group:eng")
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
    expect(await screen.findByText("No relation tuple has this subject as its subject.")).toBeTruthy()
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
      await screen.findByText(
        "No policy in effect at / selects this subject through its kind, its id or a role it holds for every resource.",
      ),
    ).toBeTruthy()
  })

  it("always says what a single-resource role does to selection", async () => {
    const note =
      "A policy that selects this subject only through a role it holds for one resource selects it only on checks for that resource, and is not listed here."
    const { view } = setup()
    const shown = await screen.findByText(note)
    expect(shown.className).toContain("text-muted-foreground")
    const heading = screen.getByRole("heading", { name: "Policies that select this subject at /" })
    expect(heading.closest("section")?.contains(shown)).toBe(true)
    view.unmount()
    setup(EMPTY)
    expect(await screen.findByText(note)).toBeTruthy()
  })

  it("lists a policy matching [{role: editor}, {kind: user}] by kind when editor is held for one resource, and the note still holds", async () => {
    // Editor is held for document:doc9 only, so the role matcher does not
    // select alice for every resource. The kind matcher does, so the policy
    // is listed, and it is listed by kind: the note speaks only of a policy
    // that selects through the single-resource role alone.
    const scopedEditor = {
      id: "asg_scoped",
      namespacePath: "",
      roleId: "role_editor",
      roleSlug: "editor",
      resourceType: "document",
      resourceId: "doc9",
      expired: false,
      expiringSoon: false,
    }
    setup({
      ...EMPTY,
      assignments: [scopedEditor],
      policies: [
        { id: "pol_mixed", name: "editors-or-users", effect: "allow", priority: 5, namespacePath: "", selectedBy: "kind" },
      ],
    })
    const heading = await screen.findByRole("heading", { name: "Policies that select this subject at /" })
    const policies = within(heading.closest("section") as HTMLElement)
    const row = within(policies.getByText("editors-or-users").closest("tr") as HTMLElement)
    expect(row.getByText("subjects of this kind")).toBeTruthy()
    expect(row.queryByText("holders of editor")).toBeNull()
    expect(
      policies.getByText(
        "A policy that selects this subject only through a role it holds for one resource selects it only on checks for that resource, and is not listed here.",
      ),
    ).toBeTruthy()
  })
})

describe("recent checks section", () => {
  it("reads them through checkLogs.list, for this subject, ten at most", async () => {
    const { sent } = setup()
    await screen.findByRole("heading", { name: "Recent checks" })
    await waitFor(() => expect(sent.some((q) => q.intent === "checkLogs.list")).toBe(true))
    expect(sent.find((q) => q.intent === "checkLogs.list")?.params).toEqual({
      subjectKind: "user",
      subjectId: "alice",
      limit: 10,
    })
  })

  it("uses the check log's columns and links each row to its detail", async () => {
    setup()
    await screen.findByRole("heading", { name: "Recent checks" })
    const table = within(section("Recent checks"))
    await table.findByText("document:doc1")
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
    setup(FULL, PARAMS, { checks: many })
    await screen.findByRole("heading", { name: "Recent checks" })
    await within(section("Recent checks")).findByText("document:doc0")
    expect(section("Recent checks").querySelectorAll("tbody tr").length).toBe(10)
  })

  it("leaves out a row naming another subject kind", async () => {
    // The check log filter reads an empty kind as any kind.
    setup(FULL, PARAMS, { checks: [{ ...CHECK, id: "chk_other", subjectKind: "api_key", resourceId: "other" }, CHECK] })
    await within(await screen.findByRole("region", { name: "1 check" })).findByText("document:doc1")
    expect(screen.queryByText("document:other")).toBeNull()
  })

  it("links to the check log", async () => {
    setup()
    const link = await screen.findByRole("link", { name: "Open the check log" })
    expect(link.getAttribute("href")).toBe("/check-log")
  })

  it("names the empty case", async () => {
    setup(EMPTY, PARAMS, { checks: [] })
    expect(await screen.findByText("No logged check names this subject.")).toBeTruthy()
  })

  it("a refusal (no read_audit) takes only this section with it", async () => {
    const rec = recordingQueryClient({
      "subjects.detail": FULL,
      "namespaces.list": NAMESPACES,
      "config.detail": CONFIG,
    })
    const client = {
      ...rec.client,
      query: (intent: string, params?: Record<string, unknown>) =>
        intent === "checkLogs.list"
          ? Promise.reject(new ContractError("PERMISSION_DENIED", "missing permission read_audit on warden:check_log"))
          : rec.client.query(intent, params),
    } as ScopedClient
    renderPage(WardenSubjectDetailPage, client, PARAMS)
    expect(await screen.findByText("Recent checks unavailable")).toBeTruthy()
    expect(within(section("Recent checks")).getByText("Recent checks unavailable")).toBeTruthy()
    expect(screen.getByRole("link", { name: "Open the check log" })).toBeTruthy()
    expect(await screen.findByRole("region", { name: "3 roles" })).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Assignments" })).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Relations" })).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Policies that select this subject at /" })).toBeTruthy()
    expect(screen.queryByText("Subject access unavailable")).toBeNull()
  })
})

describe("withheld sections", () => {
  const cases: { name: WithheldSection; heading: string; empty: string }[] = [
    {
      name: "roles",
      heading: "Roles at /",
      empty:
        "No role reaches this subject at /. Assignments for a single resource, in another namespace, or already expired are listed below.",
    },
    {
      name: "relations",
      heading: "Relations",
      empty: "No relation tuple has this subject as its subject.",
    },
    {
      name: "policies",
      heading: "Policies that select this subject at /",
      empty:
        "No policy in effect at / selects this subject through its kind, its id or a role it holds for every resource.",
    },
  ]

  for (const c of cases) {
    it(`shows the ${c.name} heading and says what access it needs, never the empty state`, async () => {
      // A withheld section arrives empty, as the server sends it.
      setup({ ...EMPTY, withheld: [c.name] })
      const heading = await screen.findByRole("heading", { name: c.heading })
      const own = heading.closest("section") as HTMLElement
      expect(
        within(own).getByText(`You need read access to ${c.name} to see this section.`),
      ).toBeTruthy()
      expect(screen.queryByText(c.empty)).toBeNull()
      expect(own.querySelector("table")).toBeNull()
      // The other two sections still answer, with their own empty states.
      for (const other of cases.filter((o) => o.name !== c.name)) {
        expect(screen.getByText(other.empty)).toBeTruthy()
        expect(screen.queryByText(`You need read access to ${other.name} to see this section.`)).toBeNull()
      }
    })
  }

  it("withholds all three and still shows the assignments", async () => {
    setup({ ...FULL, roles: [], relations: [], policies: [], withheld: ["roles", "relations", "policies"] })
    expect(await screen.findByText("You need read access to roles to see this section.")).toBeTruthy()
    expect(screen.getByText("You need read access to relations to see this section.")).toBeTruthy()
    expect(screen.getByText("You need read access to policies to see this section.")).toBeTruthy()
    expect(screen.getByRole("region", { name: "3 assignments" })).toBeTruthy()
    expect(screen.queryByText(/Roles assigned for one resource only/)).toBeNull()
    expect(screen.queryByText(/Direct relation tuples only/)).toBeNull()
    expect(screen.queryByText(/Selecting is not applying/)).toBeNull()
    for (const c of cases) expect(screen.queryByText(c.empty)).toBeNull()
  })
})

describe("models turned off", () => {
  const ABAC_OFF = "Policy evaluation is off, so no policy applies to any check."
  const REBAC_OFF = "Relation checks are off, so no relation grants anything."
  const DIRECT_ONLY =
    "Direct relation tuples only. A relation reached through a group, a parent object or a resource type's permission expression is found by the check itself; try it in the playground."

  it("says policy evaluation is off in the policies section", async () => {
    setup(FULL, PARAMS, { config: { ...CONFIG, abacEnabled: false } })
    const heading = await screen.findByRole("heading", { name: "Policies that select this subject at /" })
    const note = await within(heading.closest("section") as HTMLElement).findByText(ABAC_OFF)
    expect(note.className).toContain("text-muted-foreground")
    expect(screen.queryByText(REBAC_OFF)).toBeNull()
  })

  it("replaces the relations note when relation checks are off", async () => {
    setup(FULL, PARAMS, { config: { ...CONFIG, rebacEnabled: false } })
    const heading = await screen.findByRole("heading", { name: "Relations" })
    const note = await within(heading.closest("section") as HTMLElement).findByText(REBAC_OFF)
    expect(note.className).toContain("text-muted-foreground")
    expect(screen.queryByText(DIRECT_ONLY)).toBeNull()
    expect(screen.queryByText(ABAC_OFF)).toBeNull()
  })

  it("says nothing about models when both are on", async () => {
    setup()
    expect(await screen.findByText(DIRECT_ONLY)).toBeTruthy()
    await screen.findByRole("region", { name: "3 roles" })
    expect(screen.queryByText(ABAC_OFF)).toBeNull()
    expect(screen.queryByText(REBAC_OFF)).toBeNull()
  })

  it("changes nothing when the config cannot be read", async () => {
    const { sent } = setup(FULL, PARAMS, { config: null })
    expect(await screen.findByText(DIRECT_ONLY)).toBeTruthy()
    await waitFor(() => expect(sent.some((q) => q.intent === "config.detail")).toBe(true))
    expect(screen.queryByText(ABAC_OFF)).toBeNull()
    expect(screen.queryByText(REBAC_OFF)).toBeNull()
    expect(screen.queryByText("config.detail")).toBeNull()
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
    expect(screen.queryByText(/Roles and policies are shown at/)).toBeNull()
    expect(screen.getByLabelText("Namespace")).toBeTruthy()
  })
})
