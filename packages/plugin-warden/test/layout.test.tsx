import "./flow-env"
import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { layoutViolations } from "@forge-go/dashboard-kit/lib/layout-check"
import type { CheckDetail, CheckSummary } from "../src/components/check-log"
import type { PolicyDetail } from "../src/components/policy-rule"
import { WardenAssignmentsPage } from "../src/pages/assignments"
import { WardenCheckLogDetailPage } from "../src/pages/check-log-detail"
import { WardenCheckLogPage } from "../src/pages/check-log"
import { WardenConfigPage } from "../src/pages/config"
import { WardenOverviewPage } from "../src/pages/overview"
import { WardenPermissionDetailPage } from "../src/pages/permission-detail"
import { WardenPermissionsPage } from "../src/pages/permissions"
import { WardenPlaygroundPage } from "../src/pages/playground"
import { WardenPoliciesPage } from "../src/pages/policies"
import {
  WardenPolicyDetailPage,
  WardenPolicyEditPage,
} from "../src/pages/policy-detail"
import { WardenRelationGraphPage } from "../src/pages/relation-graph"
import { WardenRelationsPage } from "../src/pages/relations"
import { WardenResourceTypeDetailPage } from "../src/pages/resource-type-detail"
import { WardenResourceTypesPage } from "../src/pages/resource-types"
import { WardenRoleDetailPage } from "../src/pages/role-detail"
import { WardenRolesPage } from "../src/pages/roles"
import { WardenSchemaPage } from "../src/pages/schema"
import { WardenSubjectDetailPage } from "../src/pages/subject-detail"
import type { SubjectDetail } from "../src/pages/subject-detail"
import { renderPage, stubClient } from "./harness"

// Every page, rendered with data the way its own test renders it, must follow
// the shared layout: one h1, every h2 and table inside a kit Section, and no
// Section inside another. A page fed by several queries waits for a node from
// each query that renders a section, so the check never runs on a half-loaded
// page.

const NAMESPACES = { namespaces: ["", "eng/platform"] }
const CONFIG = {
  maxGraphDepth: 10,
  maxGraphVisited: 5000,
  maxGraphFanout: 1000,
  maxBatchChecks: 100,
  cacheTtlSeconds: 60,
  cacheMaxSize: 10000,
  rbacEnabled: true,
  abacEnabled: true,
  rebacEnabled: true,
  checkLogEnabled: true,
  requireTenant: true,
  evaluateAllModels: false,
  checkLogQueueSize: 4096,
  checkLogRetentionSeconds: 7776000,
  maintenanceIntervalSeconds: 3600,
  checkLogRetentionHours: 2160,
  maintenanceIntervalMinutes: 60,
  plugins: ["auditlog"],
}

const CHECK: CheckSummary = {
  id: "chk_01a",
  namespacePath: "",
  subjectKind: "user",
  subjectId: "alice",
  action: "read",
  resourceType: "document",
  resourceId: "readme",
  decision: "allow",
  evalTimeNs: 412_000,
  cached: false,
  createdAt: "2026-09-23T10:00:00Z",
}
const FAILED: CheckSummary = {
  ...CHECK,
  id: "chk_01b",
  namespacePath: "eng/platform",
  subjectKind: "service",
  subjectId: "deployer",
  decision: "error",
  error: "store unavailable",
}

const ROLE = {
  id: "role_01hq",
  namespacePath: "",
  name: "Reader",
  slug: "reader",
  description: "can read",
  parentSlug: "",
  isSystem: false,
  isDefault: true,
  maxMembers: 0,
  createdAt: "2026-09-23T10:00:00Z",
  updatedAt: "2026-09-23T10:00:00Z",
}
const PERMISSION = {
  id: "perm_01a",
  namespacePath: "",
  name: "document:read",
  resource: "document",
  action: "read",
  description: "read a document",
  isSystem: false,
  createdAt: "2026-09-23T10:00:00Z",
  updatedAt: "2026-09-23T10:00:00Z",
}
const page = (items: unknown[]) => ({
  items,
  total: items.length,
  limit: 25,
  offset: 0,
})

function expectLayout(container: HTMLElement) {
  expect(layoutViolations(container)).toEqual([])
}

function regionNames(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[data-slot="section"]')).map(
    (s) => {
      const heading = s.querySelector("h2")
      return heading?.textContent ?? s.getAttribute("aria-label") ?? ""
    }
  )
}

describe("Warden pages follow the shared layout", () => {
  it("Overview follows the shared layout", async () => {
    const { container } = renderPage(
      WardenOverviewPage,
      stubClient({
        "overview.stats": {
          roles: 3,
          permissions: 3,
          assignments: 2,
          relations: 2,
          policies: 1,
          resourceTypes: 1,
        },
        "overview.recentChecks": { checks: [CHECK, FAILED] },
      })
    )
    await screen.findByText("Roles")
    await screen.findByText("store unavailable")
    expectLayout(container)
  })

  it("Roles follows the shared layout", async () => {
    const { container } = renderPage(
      WardenRolesPage,
      stubClient({
        "roles.list": page([ROLE]),
        "namespaces.list": NAMESPACES,
      })
    )
    await screen.findByText("Reader")
    expectLayout(container)
    expect(regionNames(container)).toContain("Role list")
  })

  it("Permissions follows the shared layout", async () => {
    const { container } = renderPage(
      WardenPermissionsPage,
      stubClient({
        "permissions.list": page([PERMISSION]),
        "namespaces.list": NAMESPACES,
      })
    )
    await screen.findByText("document:read")
    expectLayout(container)
    expect(regionNames(container)).toContain("Permission list")
  })

  it("Policies follows the shared layout", async () => {
    const { container } = renderPage(
      WardenPoliciesPage,
      stubClient({
        "policies.list": page([
          {
            id: "pol_healthy",
            name: "healthy-allow",
            namespacePath: "",
            description: "",
            effect: "allow",
            priority: 10,
            isActive: true,
            state: "active",
            failsClosed: false,
            neverApplies: false,
            matchesEverything: false,
            version: 1,
            updatedAt: "2026-09-01T00:00:00Z",
          },
        ]),
        "namespaces.list": NAMESPACES,
        "config.detail": CONFIG,
      })
    )
    await screen.findByText("healthy-allow")
    expectLayout(container)
    expect(regionNames(container)).toContain("Policy list")
  })

  it("Assignments follows the shared layout", async () => {
    const assignment = {
      id: "asg_gone",
      namespacePath: "eng/platform",
      roleId: "role_auditor",
      roleSlug: "auditor",
      roleName: "Auditor",
      subjectKind: "user",
      subjectId: "gone",
      expiresAt: "2020-01-01T00:00:00Z",
      expired: true,
      createdAt: "2019-12-01T00:00:00Z",
    }
    const { container } = renderPage(
      WardenAssignmentsPage,
      stubClient({
        "assignments.list": page([assignment]),
        "assignments.expiring": { items: [assignment] },
        "roles.list": page([ROLE]),
        "namespaces.list": NAMESPACES,
      })
    )
    await screen.findByText("user:gone")
    expectLayout(container)
    expect(regionNames(container)).toContain("Assignment list")
  })

  it("Assignments, expiring soon follows the shared layout", async () => {
    const assignment = {
      id: "asg_gone",
      namespacePath: "eng/platform",
      roleId: "role_auditor",
      roleSlug: "auditor",
      roleName: "Auditor",
      subjectKind: "user",
      subjectId: "gone",
      expiresAt: "2020-01-01T00:00:00Z",
      expired: true,
      createdAt: "2019-12-01T00:00:00Z",
    }
    const { container } = renderPage(
      WardenAssignmentsPage,
      stubClient({
        "assignments.list": page([assignment]),
        "assignments.expiring": {
          items: [{ ...assignment, id: "asg_up", subjectId: "upcoming" }],
        },
        "roles.list": page([ROLE]),
        "namespaces.list": NAMESPACES,
      })
    )
    await screen.findByText("user:gone")
    fireEvent.change(screen.getByLabelText("Show"), {
      target: { value: "expiring" },
    })
    await screen.findByText("user:upcoming")
    expectLayout(container)
  })

  it("Relations follows the shared layout", async () => {
    const { container } = renderPage(
      WardenRelationsPage,
      stubClient({
        "relations.list": page([
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
        ]),
        "namespaces.list": NAMESPACES,
      })
    )
    await screen.findByText("document:readme#viewer@user:bob")
    expectLayout(container)
    expect(regionNames(container)).toContain("Relation list")
  })

  it("Check log follows the shared layout", async () => {
    const { container } = renderPage(
      WardenCheckLogPage,
      stubClient({
        "checkLogs.list": page([CHECK, FAILED]),
        "config.detail": { checkLogEnabled: true },
        "namespaces.list": NAMESPACES,
      })
    )
    await screen.findByText("user:alice")
    expectLayout(container)
    expect(regionNames(container)).toContain("Check list")
  })

  it("Check log detail follows the shared layout", async () => {
    const detail: CheckDetail = {
      ...CHECK,
      matchedBy: [
        {
          source: "rbac",
          ruleId: "role_01hx",
          detail: "role grants document:read",
        },
      ],
      obligations: ["audit"],
    }
    const { container } = renderPage(
      WardenCheckLogDetailPage,
      stubClient({ "checkLogs.detail": detail }),
      { id: "chk_01a" }
    )
    await screen.findByText("role grants document:read")
    expectLayout(container)
    // No h2 or table to trip the check on this page before it moved to
    // panels, so it also names the panels it must have.
    expect(regionNames(container)).toEqual(["Decision", "Details"])
  })

  it("Resource types, table view follows the shared layout", async () => {
    const { container } = renderPage(
      WardenResourceTypesPage,
      stubClient({
        "resourceTypes.list": page([
          {
            id: "rt_doc",
            namespacePath: "",
            name: "document",
            description: "a file",
            relationCount: 3,
            permissionCount: 5,
            createdAt: "2026-09-01T00:00:00Z",
            updatedAt: "2026-09-02T00:00:00Z",
          },
        ]),
        "resourceTypes.graph": { nodes: [], edges: [], truncated: false },
        "namespaces.list": NAMESPACES,
      })
    )
    fireEvent.click(screen.getByRole("button", { name: "Table" }))
    await screen.findByRole("table")
    expectLayout(container)
    expect(regionNames(container)).toContain("Resource type list")
  })

  it("Resource types, graph view follows the shared layout", async () => {
    const { container } = renderPage(
      WardenResourceTypesPage,
      stubClient({
        "resourceTypes.list": page([]),
        "resourceTypes.graph": {
          nodes: [
            {
              id: "rt_doc",
              namespacePath: "",
              name: "document",
              relations: [{ name: "viewer", allowedSubjects: ["user"] }],
              permissions: [{ name: "read", expression: "viewer" }],
            },
          ],
          edges: [
            {
              from: "document",
              fromId: "rt_doc",
              relation: "viewer",
              to: "user",
              declared: false,
              toIds: [],
            },
          ],
          truncated: false,
        },
        "namespaces.list": NAMESPACES,
      })
    )
    await screen.findByText("Relationships as text")
    expectLayout(container)
    expect(regionNames(container)).toContain("Resource type list")
  })

  it("Config follows the shared layout", async () => {
    const { container } = renderPage(
      WardenConfigPage,
      stubClient({ "config.detail": CONFIG })
    )
    await screen.findByText("RBAC")
    expectLayout(container)
  })

  it("Role detail follows the shared layout", async () => {
    const { container } = renderPage(
      WardenRoleDetailPage,
      stubClient({
        "roles.detail": {
          ...ROLE,
          createdBy: "usr_1",
          updatedBy: "usr_2",
          permissions: [PERMISSION],
          children: [
            {
              ...ROLE,
              id: "role_01hr",
              name: "Editor",
              slug: "editor",
              parentSlug: "reader",
              isDefault: false,
            },
          ],
        },
        "permissions.list": page([PERMISSION]),
      }),
      { id: "role_01hq" }
    )
    await screen.findByText("document:read")
    await screen.findByText("Editor")
    expectLayout(container)
  })

  it("Permission detail follows the shared layout", async () => {
    const { container } = renderPage(
      WardenPermissionDetailPage,
      stubClient({
        "permissions.detail": {
          ...PERMISSION,
          grantedBy: [ROLE],
        },
      }),
      { id: "perm_01a" }
    )
    await screen.findByText("Reader")
    expectLayout(container)
  })

  it("Resource type detail follows the shared layout", async () => {
    const { container } = renderPage(
      WardenResourceTypeDetailPage,
      stubClient({
        "resourceTypes.detail": {
          id: "rt_01a",
          namespacePath: "",
          name: "document",
          description: "a file",
          relationCount: 2,
          permissionCount: 1,
          createdAt: "2026-09-01T00:00:00Z",
          updatedAt: "2026-09-02T00:00:00Z",
          createdBy: "usr_1",
          updatedBy: "usr_2",
          relations: [
            { name: "viewer", allowedSubjects: ["user"] },
            { name: "editor", allowedSubjects: ["user", "group#member"] },
          ],
          permissions: [{ name: "read", expression: "viewer or editor" }],
        },
      }),
      { id: "rt_01a" }
    )
    await screen.findByText("viewer or editor")
    expectLayout(container)
  })

  const POLICY: PolicyDetail = {
    id: "pol_01",
    namespacePath: "",
    name: "office-only",
    description: "Keeps deletes on the office network.",
    effect: "deny",
    priority: 10,
    isActive: true,
    state: "active",
    failsClosed: false,
    neverApplies: false,
    matchesEverything: false,
    version: 3,
    updatedAt: "2026-09-02T00:00:00Z",
    subjects: [{ role: "contractor" }, { kind: "user", id: "usr_2f8a" }],
    actions: ["document:delete"],
    resources: ["document:*"],
    conditions: [
      {
        id: "c1",
        field: "context.ip",
        operator: "not_in",
        value: ["10.0.0.0/8"],
      },
    ],
    obligations: ["notify-security"],
    subjectsUnrestricted: false,
    actionsUnrestricted: false,
    resourcesUnrestricted: false,
    hasRoleMatcher: true,
    createdBy: "usr_admin",
    updatedBy: "usr_ops",
    createdAt: "2026-09-01T00:00:00Z",
  }

  it("Policy detail follows the shared layout", async () => {
    const { container } = renderPage(
      WardenPolicyDetailPage,
      stubClient({
        "policies.detail": POLICY,
        "config.detail": { abacEnabled: true, rbacEnabled: true },
      }),
      { id: "pol_01" }
    )
    await screen.findByRole("heading", { level: 2, name: "Deny" })
    await screen.findByText("usr_admin")
    expectLayout(container)
  })

  it("Policy edit follows the shared layout", async () => {
    const { container } = renderPage(
      WardenPolicyEditPage,
      stubClient({
        "policies.detail": POLICY,
        "config.detail": { abacEnabled: true, rbacEnabled: true },
      }),
      { id: "pol_01" }
    )
    await screen.findByRole("region", { name: "Rule editor" })
    expectLayout(container)
    expect(regionNames(container)).toContain("Rule editor")
  })

  const SUBJECT: SubjectDetail = {
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
        ],
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
      {
        id: "pol_a",
        name: "allow-all",
        effect: "allow",
        priority: 10,
        namespacePath: "",
        selectedBy: "everyone",
      },
    ],
    withheld: [],
  }

  it("Subject detail follows the shared layout", async () => {
    const { container } = renderPage(
      WardenSubjectDetailPage,
      stubClient({
        "subjects.detail": SUBJECT,
        "namespaces.list": { namespaces: ["", "acme", "acme/eng"] },
        "checkLogs.list": {
          items: [CHECK],
          total: 1,
          limit: 10,
          offset: 0,
        },
        "config.detail": CONFIG,
      }),
      { kind: "user", id: "alice" }
    )
    await screen.findByText("allow-all")
    await screen.findByText("1 check")
    expectLayout(container)
  })

  // Outliers: R1, R2 and R3 only. The playground, the relation graph and the
  // schema editor have no h2 or table of their own, so each also names the
  // regions it must have.
  it("Playground follows the shared layout", async () => {
    const { container } = renderPage(
      WardenPlaygroundPage,
      stubClient({
        "namespaces.list": NAMESPACES,
        "config.detail": CONFIG,
      })
    )
    await screen.findByLabelText("Subject id")
    expectLayout(container)
    expect(regionNames(container)).toEqual(
      expect.arrayContaining(["Check builder", "Result", "Batch"])
    )
  })

  it("Relation graph follows the shared layout", async () => {
    const { container } = renderPage(
      WardenRelationGraphPage,
      stubClient({
        "relations.expand": {
          nodes: [
            {
              key: "document:readme#editor",
              type: "document",
              id: "readme",
              relation: "editor",
              depth: 0,
              walked: true,
              capped: false,
            },
            {
              key: "user:erin",
              type: "user",
              id: "erin",
              depth: 1,
              walked: false,
              capped: false,
            },
          ],
          edges: [
            {
              from: "document:readme#editor",
              to: "user:erin",
              namespacePath: "",
            },
          ],
          stop: "complete",
          limit: 0,
          exactWalk: true,
          truncatedNodes: 0,
          path: [],
        },
        "namespaces.list": NAMESPACES,
      }),
      { objectType: "document", objectId: "readme", relation: "editor" }
    )
    await screen.findByText("user:erin", { selector: "span" })
    expectLayout(container)
    expect(regionNames(container)).toContain("Reachable tuples")
  })

  it("Schema follows the shared layout", async () => {
    const { container } = renderPage(WardenSchemaPage, {
      extension: "warden",
      query: async (intent: string) => {
        if (intent === "schema.export")
          return { source: "warden config 1\ntenant t\n\nrole viewer {\n}\n" }
        if (intent === "schema.plan")
          return {
            valid: true,
            diagnostics: [],
            created: ["+ role//editor"],
            updated: [],
            deleted: [],
            noOps: 1,
            digest: "d".repeat(64),
          }
        throw new Error(`no handler for ${intent}`)
      },
      command: async () => ({}),
    } as unknown as Parameters<typeof renderPage>[1])
    await waitFor(() =>
      expect(document.querySelector(".cm-editor")).not.toBeNull()
    )
    fireEvent.click(screen.getByRole("button", { name: "Plan" }))
    await screen.findByText("Will create", { exact: false })
    expectLayout(container)
    expect(regionNames(container)).toEqual(
      expect.arrayContaining(["Source", "Plan result"])
    )
  })

  // The same pages in their other states: an inline create form, an edit form,
  // withheld sections and a finished run. Each is a different arrangement of
  // the same panels.
  it("Roles with the create form open follows the shared layout", async () => {
    const { container } = renderPage(
      WardenRolesPage,
      stubClient({
        "roles.list": page([ROLE]),
        "namespaces.list": NAMESPACES,
      })
    )
    await screen.findByText("Reader")
    fireEvent.click(screen.getByRole("button", { name: "New role" }))
    await screen.findByRole("group", { name: "New role" })
    expectLayout(container)
  })

  it("Permissions with the create form open follows the shared layout", async () => {
    const { container } = renderPage(
      WardenPermissionsPage,
      stubClient({
        "permissions.list": page([PERMISSION]),
        "namespaces.list": NAMESPACES,
      })
    )
    await screen.findByText("document:read")
    fireEvent.click(screen.getByRole("button", { name: "New permission" }))
    await screen.findByRole("group", { name: "New permission" })
    expectLayout(container)
  })

  it("Permission detail, editing the description, follows the shared layout", async () => {
    const { container } = renderPage(
      WardenPermissionDetailPage,
      stubClient({
        "permissions.detail": { ...PERMISSION, grantedBy: [ROLE] },
      }),
      { id: "perm_01a" }
    )
    await screen.findByText("Reader")
    fireEvent.click(screen.getByRole("button", { name: "Edit description" }))
    await screen.findByRole("region", { name: "Edit description" })
    expectLayout(container)
  })

  it("Role detail, editing the role, follows the shared layout", async () => {
    const { container } = renderPage(
      WardenRoleDetailPage,
      stubClient({
        "roles.detail": { ...ROLE, permissions: [PERMISSION], children: [] },
        "permissions.list": page([PERMISSION]),
      }),
      { id: "role_01hq" }
    )
    await screen.findByText("document:read")
    fireEvent.click(screen.getByRole("button", { name: "Edit" }))
    await screen.findByRole("region", { name: "Edit role" })
    expectLayout(container)
  })

  it("Resource type detail, editing the type, follows the shared layout", async () => {
    const { container } = renderPage(
      WardenResourceTypeDetailPage,
      stubClient({
        "resourceTypes.detail": {
          id: "rt_01a",
          namespacePath: "",
          name: "document",
          relationCount: 1,
          permissionCount: 1,
          createdAt: "2026-09-01T00:00:00Z",
          updatedAt: "2026-09-02T00:00:00Z",
          relations: [{ name: "viewer", allowedSubjects: ["user"] }],
          permissions: [{ name: "read", expression: "viewer" }],
        },
      }),
      { id: "rt_01a" }
    )
    await screen.findByText("viewer", { selector: "td" })
    fireEvent.click(screen.getByRole("button", { name: "Edit" }))
    await screen.findByRole("region", { name: "Edit resource type" })
    expectLayout(container)
  })

  it("Subject detail with every section withheld follows the shared layout", async () => {
    const { container } = renderPage(
      WardenSubjectDetailPage,
      stubClient({
        "subjects.detail": {
          ...SUBJECT,
          roles: [],
          relations: [],
          policies: [],
          withheld: ["roles", "relations", "policies"],
        },
        "namespaces.list": NAMESPACES,
        "checkLogs.list": { items: [CHECK], total: 1, limit: 10, offset: 0 },
        "config.detail": CONFIG,
      }),
      { kind: "user", id: "alice" }
    )
    await screen.findByText("Assignments")
    await screen.findByText("1 check")
    expectLayout(container)
    expect(regionNames(container)).toContain("Roles at /")
  })

  it("Playground with a result and a batch run follows the shared layout", async () => {
    const result = {
      decision: "allow",
      allowed: true,
      matchedBy: [],
      obligations: [],
      evalTimeNs: 412_000,
      lanes: [
        { model: "rbac", state: "allow", decision: "allow", matchedBy: [] },
      ],
    }
    const { container } = renderPage(
      WardenPlaygroundPage,
      stubClient({
        "namespaces.list": NAMESPACES,
        "config.detail": CONFIG,
        "playground.explain": result,
        "playground.batchCheck": { results: [result] },
      })
    )
    fireEvent.change(await screen.findByLabelText("Subject id"), {
      target: { value: "alice" },
    })
    fireEvent.change(screen.getByLabelText("Action"), {
      target: { value: "read" },
    })
    fireEvent.change(screen.getByLabelText("Resource type"), {
      target: { value: "document" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Run" }))
    await screen.findByText(/evaluated in/)
    fireEvent.change(screen.getByLabelText("Checks, one per line"), {
      target: { value: "user:alice read document:readme" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Run batch" }))
    await screen.findByText("1 check")
    expectLayout(container)
  })
})
