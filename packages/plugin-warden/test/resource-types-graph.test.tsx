import "./flow-env"
import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { WardenResourceTypesPage } from "../src/pages/resource-types"
import { buildSchemaGraph } from "../src/components/schema-graph"
import {
  failingClient,
  recordingQueryClient,
  renderPage,
  stubClient,
} from "./harness"

// The fixture's own schema, trimmed. Two types are both named "group", one at
// the root and one in eng/platform, which is the case an edge cannot be joined
// to its nodes by name for. document's "group#member" subjects therefore name
// both of them, and "user" and "service" name no resource type at all.
const GRAPH = {
  nodes: [
    {
      id: "rt_cluster",
      namespacePath: "eng/platform",
      name: "cluster",
      relations: [{ name: "admin", allowedSubjects: ["service", "user"] }],
      permissions: [{ name: "operate", expression: "admin" }],
    },
    {
      id: "rt_group_eng",
      namespacePath: "eng/platform",
      name: "group",
      relations: [{ name: "member", allowedSubjects: ["user"] }],
      permissions: [],
    },
    {
      id: "rt_doc",
      namespacePath: "",
      name: "document",
      relations: [
        { name: "viewer", allowedSubjects: ["user", "group#member"] },
        { name: "editor", allowedSubjects: ["group#member"] },
      ],
      permissions: [
        { name: "read", expression: "viewer or editor" },
        { name: "write", expression: "editor" },
      ],
    },
    {
      id: "rt_group_root",
      namespacePath: "",
      name: "group",
      relations: [
        { name: "member", allowedSubjects: ["user", "group#member"] },
      ],
      permissions: [],
    },
  ],
  edges: [
    {
      from: "cluster",
      fromId: "rt_cluster",
      relation: "admin",
      to: "service",
      declared: false,
      toIds: [],
    },
    {
      from: "cluster",
      fromId: "rt_cluster",
      relation: "admin",
      to: "user",
      declared: false,
      toIds: [],
    },
    {
      from: "group",
      fromId: "rt_group_eng",
      relation: "member",
      to: "user",
      declared: false,
      toIds: [],
    },
    {
      from: "document",
      fromId: "rt_doc",
      relation: "viewer",
      to: "user",
      declared: false,
      toIds: [],
    },
    {
      from: "document",
      fromId: "rt_doc",
      relation: "viewer",
      to: "group",
      toRelation: "member",
      declared: true,
      toIds: ["rt_group_root", "rt_group_eng"],
    },
    {
      from: "document",
      fromId: "rt_doc",
      relation: "editor",
      to: "group",
      toRelation: "member",
      declared: true,
      toIds: ["rt_group_root", "rt_group_eng"],
    },
    {
      from: "group",
      fromId: "rt_group_root",
      relation: "member",
      to: "user",
      declared: false,
      toIds: [],
    },
    {
      from: "group",
      fromId: "rt_group_root",
      relation: "member",
      to: "group",
      toRelation: "member",
      declared: true,
      toIds: ["rt_group_root", "rt_group_eng"],
    },
  ],
  truncated: false,
}

const EMPTY_GRAPH = { nodes: [], edges: [], truncated: false }
const TABLE = {
  items: [
    {
      id: "rt_doc",
      namespacePath: "",
      name: "document",
      relationCount: 2,
      permissionCount: 2,
      createdAt: "2026-09-01T00:00:00Z",
      updatedAt: "2026-09-02T00:00:00Z",
    },
  ],
  total: 1,
  limit: 25,
  offset: 0,
}
const NAMESPACES = { namespaces: ["", "eng/platform"] }

function answers(extra = {}) {
  return {
    "resourceTypes.graph": GRAPH,
    "resourceTypes.list": TABLE,
    "namespaces.list": NAMESPACES,
    ...extra,
  }
}

/** The graph's node for one type, found by the link that opens it. */
async function nodeLink(name: RegExp | string) {
  return screen.findByRole("link", { name })
}

/** The edges the canvas drew from one type id to another, by data attributes. */
function edgesBetween(container: HTMLElement, from: string, to: string) {
  return Array.from(
    container.querySelectorAll(
      `[data-edge-source="${from}"][data-edge-target="${to}"]`
    )
  )
}
function edgesFrom(container: HTMLElement, from: string) {
  return Array.from(container.querySelectorAll(`[data-edge-source="${from}"]`))
}

describe("the resource types graph", () => {
  it("opens on the graph, with the Graph button pressed and the table not shown", async () => {
    const { client, sent } = recordingQueryClient(answers())
    renderPage(WardenResourceTypesPage, client)
    await nodeLink(/Open document/)
    expect(
      screen.getByRole("button", { name: "Graph" }).getAttribute("aria-pressed")
    ).toBe("true")
    expect(
      screen.getByRole("button", { name: "Table" }).getAttribute("aria-pressed")
    ).toBe("false")
    expect(screen.queryByRole("table")).toBeNull()
    // The list is the table's read, so the graph's page does not make it.
    expect(sent.map((q) => q.intent)).not.toContain("resourceTypes.list")
  })

  it("switches to the table, which is the list as it was, and back", async () => {
    renderPage(WardenResourceTypesPage, stubClient(answers()))
    await nodeLink(/Open document/)
    fireEvent.click(screen.getByRole("button", { name: "Table" }))
    const table = await screen.findByRole("table")
    expect(within(table).getByText("document")).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "Table" }).getAttribute("aria-pressed")
    ).toBe("true")
    expect(screen.getByLabelText("Search resource types")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Graph" }))
    await nodeLink(/Open document/)
    expect(screen.queryByRole("table")).toBeNull()
  })

  it("shows each type's name, namespace and permission expressions", async () => {
    renderPage(WardenResourceTypesPage, stubClient(answers()))
    const doc = await nodeLink("Open document in the tenant root")
    const card = within(doc)
    expect(card.getByText("document")).toBeTruthy()
    expect(card.getByText("/").className).toContain("font-mono")
    const read = card.getByText("read = viewer or editor")
    expect(read.className).toContain("font-mono")
    expect(card.getByText("write = editor")).toBeTruthy()

    const cluster = within(await nodeLink("Open cluster in eng/platform"))
    expect(cluster.getByText("eng/platform").className).toContain("font-mono")
    expect(cluster.getByText("operate = admin")).toBeTruthy()
  })

  it("labels each edge with its relation, and #relation for a subject set", async () => {
    const { container } = renderPage(
      WardenResourceTypesPage,
      stubClient(answers())
    )
    await nodeLink(/Open document/)
    const labels = (from: string, to: string) =>
      Array.from(
        container.querySelectorAll(
          `[data-edge-label-source="${from}"][data-edge-label-target="${to}"]`
        )
      )
        .map((e) => e.textContent)
        .sort()
    expect(labels("rt_doc", "rt_group_root")).toEqual([
      "editor #member",
      "viewer #member",
    ])
    // A plain subject carries the relation alone, with no "#" at all.
    expect(labels("rt_cluster", "undeclared:user")).toEqual(["admin"])
  })

  it("draws an edge to every type that has the target's name, joined by id", async () => {
    const { container } = renderPage(
      WardenResourceTypesPage,
      stubClient(answers())
    )
    await nodeLink(/Open document/)
    expect(edgesBetween(container, "rt_doc", "rt_group_root")).toHaveLength(2)
    expect(edgesBetween(container, "rt_doc", "rt_group_eng")).toHaveLength(2)
    // Each of the two groups owns its own edges: the one in eng/platform has
    // one relation to one subject, and the root one has two.
    expect(edgesFrom(container, "rt_group_eng")).toHaveLength(1)
    expect(edgesFrom(container, "rt_group_root")).toHaveLength(3)
    expect(
      edgesBetween(container, "rt_group_root", "rt_group_root")
    ).toHaveLength(1)
    expect(
      edgesBetween(container, "rt_group_root", "rt_group_eng")
    ).toHaveLength(1)
  })

  it("ends an edge to an undeclared type at one muted node for that name", async () => {
    const { container } = renderPage(
      WardenResourceTypesPage,
      stubClient(answers())
    )
    await nodeLink(/Open document/)
    const muted = Array.from(
      container.querySelectorAll('[data-undeclared="true"]')
    )
    // user and service: two names, though user is the target of four edges.
    expect(muted).toHaveLength(2)
    const user = muted.find((m) =>
      m.textContent?.includes("user")
    ) as HTMLElement
    expect(within(user).getByText("user").className).toContain("font-mono")
    expect(
      within(user).getByText("not a resource type in this view")
    ).toBeTruthy()
    expect(within(user).queryByRole("link")).toBeNull()
    expect(
      screen.getAllByText("not a resource type in this view")
    ).toHaveLength(2)
    for (const from of [
      "rt_cluster",
      "rt_group_eng",
      "rt_doc",
      "rt_group_root",
    ]) {
      expect(
        edgesBetween(container, from, "undeclared:user").length
      ).toBeGreaterThan(0)
    }
  })

  it("tells a dashed box from a solid one in the intro", async () => {
    renderPage(WardenResourceTypesPage, stubClient(answers()))
    await nodeLink(/Open document/)
    expect(
      screen.getByText(
        "Each solid box is a resource type. A dashed box is a name the relations allow that no resource type in this view has: a subject kind such as user, or a type outside this namespace or past the first 500. An arrow runs from a type to a subject one of its relations allows, and is labelled with that relation. A relation that lists no subject types allows any subject: it has no arrow, and its type's box names it."
      )
    ).toBeTruthy()
  })

  it("names a relation with no listed subject types as allowing any, with no arrow", async () => {
    // An empty list puts no limit on the subject type. With no arrow to
    // draw, the box and the text list say so, so it never reads as nothing.
    const graph = {
      ...GRAPH,
      nodes: GRAPH.nodes.map((n) =>
        n.id === "rt_doc"
          ? {
              ...n,
              relations: [
                ...n.relations,
                { name: "watcher", allowedSubjects: [] },
              ],
            }
          : n
      ),
    }
    const { container } = renderPage(
      WardenResourceTypesPage,
      stubClient(answers({ "resourceTypes.graph": graph }))
    )
    const doc = await nodeLink(/Open document/)
    expect(within(doc).getByText("watcher: any subject type")).toBeTruthy()
    expect(
      container.querySelectorAll('[data-open-relation="watcher"]')
    ).toHaveLength(1)
    // No edge is handed to the canvas for it: the edges are exactly the
    // ones the graph without it gets, and none is labelled watcher.
    const built = buildSchemaGraph(graph)
    expect(built.edges.map((e) => e.id)).toEqual(
      buildSchemaGraph(GRAPH).edges.map((e) => e.id)
    )
    expect(
      built.edges.filter((e) => String(e.label).includes("watcher"))
    ).toEqual([])
    const details = screen
      .getByText("Relationships as text")
      .closest("details")!
    const lines = within(details)
      .getAllByRole("listitem", { hidden: true })
      .map((li) => li.textContent)
    expect(lines).toContain("document watcher any subject type")
    // A listed relation keeps its arrows and its lines.
    expect(lines).toContain("document viewer user")
    expect(lines).not.toContain("document viewer any subject type")
  })

  describe("Relationships as text", () => {
    async function textList() {
      await nodeLink(/Open document/)
      const details = screen
        .getByText("Relationships as text")
        .closest("details")!
      return within(details).getAllByRole("listitem", { hidden: true })
    }

    it("lists every drawn edge as from, relation, to, in the order drawn", async () => {
      renderPage(WardenResourceTypesPage, stubClient(answers()))
      const items = await textList()
      expect(items.map((li) => li.textContent)).toEqual([
        "cluster (eng/platform) admin service",
        "cluster (eng/platform) admin user",
        "group (eng/platform) member user",
        "document viewer user",
        "document viewer group#member",
        "document viewer group#member (eng/platform)",
        "document editor group#member",
        "document editor group#member (eng/platform)",
        "group member user",
        "group member group#member",
        "group member group#member (eng/platform)",
      ])
    })

    it("is a disclosure under the graph, closed until opened", async () => {
      renderPage(WardenResourceTypesPage, stubClient(answers()))
      await textList()
      const details = screen
        .getByText("Relationships as text")
        .closest("details")!
      expect(details.hasAttribute("open")).toBe(false)
      expect(details.querySelector("summary")?.textContent).toBe(
        "Relationships as text"
      )
      expect(details.querySelector("ul")).not.toBeNull()
    })

    it("names the muted targets, which have no namespace to give", async () => {
      renderPage(WardenResourceTypesPage, stubClient(answers()))
      const lines = (await textList()).map((li) => li.textContent)
      expect(lines).toContain("document viewer user")
      expect(lines).toContain("cluster (eng/platform) admin service")
    })
  })

  it("links each type's node to its own page", async () => {
    renderPage(WardenResourceTypesPage, stubClient(answers()))
    const doc = await nodeLink("Open document in the tenant root")
    expect(doc.getAttribute("href")).toContain("/resource-types/rt_doc")
    const eng = await nodeLink("Open group in eng/platform")
    expect(eng.getAttribute("href")).toContain("/resource-types/rt_group_eng")
    const root = await nodeLink("Open group in the tenant root")
    expect(root.getAttribute("href")).toContain("/resource-types/rt_group_root")
  })

  it("says so when the graph holds only the first 500 types", async () => {
    renderPage(
      WardenResourceTypesPage,
      stubClient(
        answers({ "resourceTypes.graph": { ...GRAPH, truncated: true } })
      )
    )
    expect(
      await screen.findByText("Showing the first 500 resource types.")
    ).toBeTruthy()
  })

  it("does not say it when the graph is whole", async () => {
    renderPage(WardenResourceTypesPage, stubClient(answers()))
    await nodeLink(/Open document/)
    expect(screen.queryByText(/Showing the first 500/)).toBeNull()
  })

  it("says which kind of empty an empty graph is", async () => {
    renderPage(
      WardenResourceTypesPage,
      stubClient(answers({ "resourceTypes.graph": EMPTY_GRAPH }))
    )
    expect(await screen.findByText("No resource types yet.")).toBeTruthy()
    fireEvent.change(screen.getByLabelText("Namespace"), {
      target: { value: "eng/platform" },
    })
    expect(
      await screen.findByText("No resource types in eng/platform.")
    ).toBeTruthy()
    expect(screen.queryByText("No resource types yet.")).toBeNull()
  })

  it("sends the namespace to the server, and none at all for every namespace", async () => {
    const { client, sent } = recordingQueryClient(answers())
    renderPage(WardenResourceTypesPage, client)
    await nodeLink(/Open document/)
    const graphQueries = () =>
      sent.filter((q) => q.intent === "resourceTypes.graph")
    expect(graphQueries().at(-1)?.params ?? {}).toEqual({})
    fireEvent.change(screen.getByLabelText("Namespace"), {
      target: { value: "" },
    })
    await waitFor(() =>
      expect(graphQueries().at(-1)?.params).toEqual({ namespacePath: "" })
    )
    fireEvent.change(screen.getByLabelText("Namespace"), {
      target: { value: "eng/platform" },
    })
    await waitFor(() =>
      expect(graphQueries().at(-1)?.params).toEqual({
        namespacePath: "eng/platform",
      })
    )
  })

  it("has no search box on the graph, which the server does not filter by name", async () => {
    renderPage(WardenResourceTypesPage, stubClient(answers()))
    await nodeLink(/Open document/)
    expect(screen.queryByLabelText("Search resource types")).toBeNull()
  })

  it("surfaces a failed read instead of drawing an empty canvas", async () => {
    renderPage(
      WardenResourceTypesPage,
      failingClient(
        new ContractError("PERMISSION_DENIED", "no tenant in scope")
      )
    )
    expect(await screen.findAllByText(/no tenant in scope/i)).toBeTruthy()
  })
})
