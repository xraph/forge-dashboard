import "./flow-env"
import { describe, expect, it, vi } from "vitest"
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import {
  ContractError,
  NavigationProvider,
  PluginProvider,
} from "@forge-go/dashboard-plugin"
import type { Navigation } from "@forge-go/dashboard-plugin"
import { WardenRelationGraphPage } from "../src/pages/relation-graph"
import {
  failingClient,
  recordingQueryClient,
  renderPage,
  stubClient,
} from "./harness"

const ROOT = "document:readme#editor"

// The fixture's userset chain, trimmed to what each assertion needs:
// readme's editors include the set group:eng#member, which holds erin and the
// set group:platform#member, which holds the set group:oncall#member. The set
// oncall has not been walked, as after a depth stop, and erin is a single
// subject, which is never walked.
const EXPANSION = {
  nodes: [
    {
      key: ROOT,
      type: "document",
      id: "readme",
      relation: "editor",
      depth: 0,
      walked: true,
      capped: false,
    },
    {
      key: "group:eng#member",
      type: "group",
      id: "eng",
      relation: "member",
      depth: 1,
      walked: true,
      capped: false,
    },
    {
      key: "user:erin",
      type: "user",
      id: "erin",
      depth: 2,
      walked: false,
      capped: false,
    },
    {
      key: "group:platform#member",
      type: "group",
      id: "platform",
      relation: "member",
      depth: 2,
      walked: true,
      capped: false,
    },
    {
      key: "group:oncall#member",
      type: "group",
      id: "oncall",
      relation: "member",
      depth: 3,
      walked: false,
      capped: false,
    },
  ],
  edges: [
    { from: ROOT, to: "group:eng#member", namespacePath: "" },
    { from: "group:eng#member", to: "user:erin", namespacePath: "" },
    {
      from: "group:eng#member",
      to: "group:platform#member",
      namespacePath: "",
    },
    {
      from: "group:platform#member",
      to: "group:oncall#member",
      namespacePath: "eng/platform",
    },
  ],
  stop: "complete",
  limit: 0,
  exactWalk: true,
  truncatedNodes: 0,
  path: [] as string[],
}

const NAMESPACES = { namespaces: ["", "eng/platform"] }
const PARAMS = {
  objectType: "document",
  objectId: "readme",
  relation: "editor",
}
const TO_ERIN = { ...PARAMS, subjectType: "user", subjectId: "erin" }

function answers(expansion: Record<string, unknown> = {}) {
  return {
    "relations.expand": { ...EXPANSION, ...expansion },
    "namespaces.list": NAMESPACES,
  }
}

function setup(
  expansion: Record<string, unknown> = {},
  params: Record<string, string> = PARAMS
) {
  const { client, sent } = recordingQueryClient(answers(expansion))
  const view = renderPage(WardenRelationGraphPage, client, params)
  const expands = () =>
    sent
      .filter((s) => s.intent === "relations.expand")
      .map((s) => s.params as Record<string, unknown>)
  return { ...view, sent, expands }
}

/** The canvas draws once the lazy chunk has loaded. */
async function drawn() {
  return screen.findByText("group:eng#member", { selector: "span" })
}

const nodeOf = (container: HTMLElement, key: string) =>
  Array.from(container.querySelectorAll("[data-node-id]")).find(
    (n) => n.getAttribute("data-node-id") === key
  ) as HTMLElement

describe("the relation graph page", () => {
  it("asks for the expansion of the object and relation in the route, at the root", async () => {
    const { expands } = setup()
    await drawn()
    expect(expands()).toEqual([
      {
        objectType: "document",
        objectId: "readme",
        relation: "editor",
        namespacePath: "",
      },
    ])
    expect(Object.keys(expands()[0]!).sort()).toEqual([
      "namespacePath",
      "objectId",
      "objectType",
      "relation",
    ])
  })

  it("names a subject set type:id#relation and a single subject type:id", async () => {
    const { container } = setup()
    await drawn()
    expect(
      within(nodeOf(container, "group:eng#member")).getByText(
        "group:eng#member"
      )
    ).toBeTruthy()
    expect(
      within(nodeOf(container, "user:erin")).getByText("user:erin")
    ).toBeTruthy()
    expect(within(nodeOf(container, ROOT)).getByText(ROOT).className).toContain(
      "font-mono"
    )
  })

  it("marks the root, once", async () => {
    const { container } = setup()
    await drawn()
    expect(within(nodeOf(container, ROOT)).getByText("root")).toBeTruthy()
    expect(screen.getAllByText("root")).toHaveLength(1)
  })

  it("marks a set that was not walked, and never a single subject", async () => {
    const { container } = setup()
    await drawn()
    expect(
      within(nodeOf(container, "group:oncall#member")).getByText("not expanded")
    ).toBeTruthy()
    expect(screen.getAllByText("not expanded")).toHaveLength(1)
    // erin has walked false too, as every single subject does, and is a leaf.
    const erin = within(nodeOf(container, "user:erin"))
    expect(erin.queryByText("not expanded")).toBeNull()
    expect(erin.getByText("subject")).toBeTruthy()
  })

  describe("a set that was not walked", () => {
    // The reason is the server's `capped`: the cap cut some of its edges, or
    // the walk simply never went through it.
    const CUT = {
      key: "group:cut#member",
      type: "group",
      id: "cut",
      relation: "member",
      depth: 3,
    }
    const DANA = {
      key: "user:dana",
      type: "user",
      id: "dana",
      depth: 4,
      walked: false,
      capped: false,
    }
    const INTO_CUT = {
      from: "group:platform#member",
      to: "group:cut#member",
      namespacePath: "",
    }
    const OUT_OF_CUT = {
      from: "group:cut#member",
      to: "user:dana",
      namespacePath: "",
    }

    it("reads not fully drawn when the cap cut some of its edges and some are drawn", async () => {
      const { container } = setup({
        nodes: [
          ...EXPANSION.nodes,
          { ...CUT, walked: false, capped: true },
          DANA,
        ],
        edges: [...EXPANSION.edges, INTO_CUT, OUT_OF_CUT],
      })
      await drawn()
      const cut = within(nodeOf(container, "group:cut#member"))
      expect(cut.getByText("not fully drawn")).toBeTruthy()
      expect(cut.queryByText("not expanded")).toBeNull()
    })

    it("reads not fully drawn when the walk went through it and the cap cut every edge", async () => {
      // walked false with no edge drawn is what the server sends for a set
      // that was expanded and whose children all fell past the cap.
      const { container } = setup({
        nodes: [...EXPANSION.nodes, { ...CUT, walked: false, capped: true }],
        edges: [...EXPANSION.edges, INTO_CUT],
      })
      await drawn()
      const cut = within(nodeOf(container, "group:cut#member"))
      expect(cut.getByText("not fully drawn")).toBeTruthy()
      expect(cut.queryByText("not expanded")).toBeNull()
    })

    it("reads not expanded when the cap cut nothing, whatever edges are drawn", async () => {
      const { container } = setup({
        nodes: [
          ...EXPANSION.nodes,
          { ...CUT, walked: false, capped: false },
          DANA,
        ],
        edges: [...EXPANSION.edges, INTO_CUT, OUT_OF_CUT],
      })
      await drawn()
      const cut = within(nodeOf(container, "group:cut#member"))
      expect(cut.getByText("not expanded")).toBeTruthy()
      expect(cut.queryByText("not fully drawn")).toBeNull()
      // oncall, the frontier set of the base data, reads the same.
      expect(
        within(nodeOf(container, "group:oncall#member")).getByText(
          "not expanded"
        )
      ).toBeTruthy()
      expect(screen.queryByText("not fully drawn")).toBeNull()
    })

    it("never marks a single subject, capped or not", async () => {
      const { container } = setup({
        nodes: EXPANSION.nodes.map((n) =>
          n.relation ? n : { ...n, capped: true }
        ),
      })
      await drawn()
      const erin = within(nodeOf(container, "user:erin"))
      expect(erin.queryByText("not fully drawn")).toBeNull()
      expect(erin.queryByText("not expanded")).toBeNull()
      expect(erin.getByText("subject")).toBeTruthy()
    })
  })

  it("marks a walked set with nothing", async () => {
    const { container } = setup()
    await drawn()
    const set = within(nodeOf(container, "group:eng#member"))
    expect(set.queryByText("not expanded")).toBeNull()
    expect(set.queryByText("subject")).toBeNull()
  })

  it("draws every edge, and shows a namespace on an edge stored below the root", async () => {
    const { container } = setup()
    await drawn()
    expect(container.querySelectorAll("[data-edge-source]")).toHaveLength(4)
    const labels = Array.from(
      container.querySelectorAll("[data-edge-label-source]")
    ).map((e) => e.textContent)
    expect(labels).toEqual(["eng/platform"])
  })

  describe("what stopped the walk", () => {
    const ALWAYS =
      "Tuples only. Permissions defined by a resource type's expression are evaluated outside this walk."

    it("says every tuple is shown when it completed", async () => {
      setup()
      await drawn()
      expect(
        screen.getByText(`Every tuple reachable from ${ROOT} is shown.`)
      ).toBeTruthy()
    })

    it("names the depth limit", async () => {
      setup({ stop: "depth", limit: 2 })
      await drawn()
      expect(
        screen.getByText(
          "Stopped at depth 2, the engine's limit. Relations beyond it are not shown."
        )
      ).toBeTruthy()
      expect(screen.queryByText(/Every tuple reachable/)).toBeNull()
    })

    it("names the visited limit", async () => {
      setup({ stop: "visited", limit: 3 })
      await drawn()
      expect(
        screen.getByText(
          "Stopped after walking 3 object relations, the engine's limit. More may be reachable."
        )
      ).toBeTruthy()
    })

    it("names the fanout limit", async () => {
      setup({ stop: "fanout", limit: 2 })
      await drawn()
      expect(
        screen.getByText(
          "Stopped where one relation has 2 or more tuples, the engine's limit. The walk ends there, so what it had not yet reached is not shown."
        )
      ).toBeTruthy()
    })

    it("always says what the walk leaves out", async () => {
      setup()
      await drawn()
      expect(screen.getByText(ALWAYS)).toBeTruthy()
    })

    it("counts the nodes it left out past the cap", async () => {
      setup({ stop: "depth", limit: 2, truncatedNodes: 2 })
      await drawn()
      expect(
        screen.getByText(
          "Showing 5 of 7 nodes. 2 more were reached but are not drawn."
        )
      ).toBeTruthy()
    })

    it("does not say every tuple is shown when it completed but left nodes out", async () => {
      setup({ truncatedNodes: 2 })
      await drawn()
      expect(
        screen.getByText(`The walk reached every tuple from ${ROOT}.`)
      ).toBeTruthy()
      expect(
        screen.getByText(
          "Showing 5 of 7 nodes. 2 more were reached but are not drawn."
        )
      ).toBeTruthy()
      expect(screen.queryByText(/is shown\./)).toBeNull()
    })

    it("says nothing about the cap when no node was left out", async () => {
      setup()
      await drawn()
      expect(
        screen.queryByText(/more were reached but are not drawn/)
      ).toBeNull()
      expect(screen.queryByText(/The walk reached every tuple/)).toBeNull()
    })
  })

  describe("a walker that is not the built-in one", () => {
    const NOTE =
      "This deployment installs its own graph walker, so a check may walk differently from what is drawn."

    it("says so", async () => {
      setup({ exactWalk: false })
      await drawn()
      expect(screen.getByText(NOTE)).toBeTruthy()
    })

    it("does not say it when the walk is the engine's own", async () => {
      setup()
      await drawn()
      expect(screen.queryByText(NOTE)).toBeNull()
    })
  })

  describe("the path to a subject", () => {
    const PATH = [ROOT, "group:eng#member", "user:erin"]

    it("asks for the path with both ends of the subject", async () => {
      const { expands } = setup({ path: PATH }, TO_ERIN)
      await drawn()
      expect(expands()).toEqual([
        {
          objectType: "document",
          objectId: "readme",
          relation: "editor",
          namespacePath: "",
          pathToType: "user",
          pathToId: "erin",
        },
      ])
    })

    it("lists the path's keys joined by then, under the engine's walk", async () => {
      setup({ path: PATH }, TO_ERIN)
      await drawn()
      expect(
        screen.getByText("The engine's walk reaches user:erin this way:")
      ).toBeTruthy()
      expect(
        screen.getByText(
          "document:readme#editor then group:eng#member then user:erin"
        )
      ).toBeTruthy()
    })

    it("highlights the path's nodes and edges, and only those", async () => {
      const { container } = setup({ path: PATH }, TO_ERIN)
      await drawn()
      const lit = Array.from(
        container.querySelectorAll('[data-node-id][data-highlighted="true"]')
      )
      expect(lit.map((n) => n.getAttribute("data-node-id")).sort()).toEqual(
        [...PATH].sort()
      )
      const edges = Array.from(
        container.querySelectorAll(
          '[data-edge-source][data-highlighted="true"]'
        )
      )
      expect(
        edges
          .map(
            (e) =>
              `${e.getAttribute("data-edge-source")}>${e.getAttribute("data-edge-target")}`
          )
          .sort()
      ).toEqual([
        "document:readme#editor>group:eng#member",
        "group:eng#member>user:erin",
      ])
    })

    it("lights only the first edge of a pair that has tuples in two namespaces", async () => {
      // The path names node keys and no namespace, so the edge the walk took
      // between a pair is the first one in the walk's order.
      const { container } = setup(
        {
          path: PATH,
          edges: [
            {
              from: ROOT,
              to: "group:eng#member",
              namespacePath: "eng/platform",
            },
            { from: ROOT, to: "group:eng#member", namespacePath: "" },
            ...EXPANSION.edges.slice(1),
          ],
        },
        TO_ERIN
      )
      await drawn()
      const pair = Array.from(
        container.querySelectorAll(`[data-edge-source="${ROOT}"]`)
      )
      expect(pair).toHaveLength(2)
      expect(pair.map((e) => e.getAttribute("data-highlighted"))).toEqual([
        "true",
        null,
      ])
    })

    it("says the walk did not reach a subject it did not reach", async () => {
      const { container } = setup(
        { path: [] },
        { ...PARAMS, subjectType: "user", subjectId: "zed" }
      )
      await drawn()
      expect(
        screen.getByText("The walk did not reach user:zed within these limits.")
      ).toBeTruthy()
      expect(container.querySelector('[data-highlighted="true"]')).toBeNull()
      expect(screen.queryByText(/this way:/)).toBeNull()
    })

    it("says nothing of a path when none was asked for", async () => {
      const { expands } = setup()
      await drawn()
      expect(screen.queryByText(/this way:/)).toBeNull()
      expect(screen.queryByText(/did not reach/)).toBeNull()
      expect(expands()[0]).not.toHaveProperty("pathToType")
    })

    it("never calls it the engine's walk when the walker is not the built-in one", async () => {
      setup({ path: PATH, exactWalk: false }, TO_ERIN)
      await drawn()
      expect(
        screen.getByText("Warden's default walk reaches user:erin this way:")
      ).toBeTruthy()
      expect(screen.queryByText(/The engine's walk/)).toBeNull()
      expect(
        screen.getByText(
          "document:readme#editor then group:eng#member then user:erin"
        )
      ).toBeTruthy()
    })
  })

  describe("the namespace", () => {
    function navigating(params: Record<string, string>) {
      const navigate = vi.fn()
      const nav: Navigation = {
        navigate,
        Link: ({ to, children, className }) => (
          <a href={to} className={className}>
            {children}
          </a>
        ),
      }
      const { client, sent } = recordingQueryClient(answers())
      const tree = (p: Record<string, string>) => (
        <PluginProvider client={client}>
          <NavigationProvider value={nav}>
            <WardenRelationGraphPage params={p} />
          </NavigationProvider>
        </PluginProvider>
      )
      const view = render(tree(params))
      const namespaceOf = () =>
        sent
          .filter((q) => q.intent === "relations.expand")
          .map((q) => (q.params as Record<string, unknown>).namespacePath)
      return {
        navigate,
        namespaceOf,
        rerenderWith: (p: Record<string, string>) => view.rerender(tree(p)),
      }
    }

    it("starts at the tenant root", async () => {
      const { namespaceOf } = navigating(PARAMS)
      await drawn()
      expect(namespaceOf()).toEqual([""])
      expect(
        (screen.getByLabelText("Namespace") as HTMLSelectElement).value
      ).toBe("")
    })

    it("starts at the namespace the route names", async () => {
      const { namespaceOf } = navigating({
        ...PARAMS,
        namespace: "eng/platform",
      })
      await drawn()
      expect(namespaceOf()).toEqual(["eng/platform"])
      expect(
        (screen.getByLabelText("Namespace") as HTMLSelectElement).value
      ).toBe("eng/platform")
    })

    it("navigates to the matching route when it is changed, and not before", async () => {
      const { navigate, namespaceOf } = navigating(PARAMS)
      await drawn()
      expect(navigate).not.toHaveBeenCalled()
      fireEvent.change(screen.getByLabelText("Namespace"), {
        target: { value: "eng/platform" },
      })
      expect(navigate).toHaveBeenCalledWith(
        "/relations/graph/document/readme/editor/in/eng%2Fplatform"
      )
      // The route is the state: nothing is asked until it changes.
      expect(namespaceOf()).toEqual([""])
    })

    it("navigates to the plain route for the root, keeping the subject of a path", async () => {
      const { navigate } = navigating({ ...TO_ERIN, namespace: "eng/platform" })
      await drawn()
      fireEvent.change(screen.getByLabelText("Namespace"), {
        target: { value: "" },
      })
      expect(navigate).toHaveBeenCalledWith(
        "/relations/graph/document/readme/editor/to/user/erin"
      )
    })

    it("follows the route when its params change", async () => {
      const { namespaceOf, rerenderWith } = navigating(PARAMS)
      await drawn()
      rerenderWith({ ...PARAMS, namespace: "eng/platform" })
      await waitFor(() => expect(namespaceOf().at(-1)).toBe("eng/platform"))
      expect(
        (screen.getByLabelText("Namespace") as HTMLSelectElement).value
      ).toBe("eng/platform")
      rerenderWith(PARAMS)
      await waitFor(() => expect(namespaceOf().at(-1)).toBe(""))
      expect(
        (screen.getByLabelText("Namespace") as HTMLSelectElement).value
      ).toBe("")
    })
  })

  describe("Relationships as text", () => {
    it("lists every drawn edge, with the namespace of one stored below the root", async () => {
      setup()
      await drawn()
      const details = screen
        .getByText("Relationships as text")
        .closest("details")!
      const lines = within(details)
        .getAllByRole("listitem", { hidden: true })
        .map((li) => li.textContent)
      expect(lines).toEqual([
        "document:readme#editor includes group:eng#member",
        "group:eng#member includes user:erin",
        "group:eng#member includes group:platform#member",
        "group:platform#member includes group:oncall#member (eng/platform)",
      ])
    })
  })

  it("surfaces a failed read instead of drawing an empty canvas", async () => {
    renderPage(
      WardenRelationGraphPage,
      failingClient(
        new ContractError("PERMISSION_DENIED", "no tenant in scope")
      ),
      PARAMS
    )
    expect(await screen.findAllByText(/no tenant in scope/i)).toBeTruthy()
  })

  it("draws a relation with no tuples as its root alone", async () => {
    const { container } = renderPage(
      WardenRelationGraphPage,
      stubClient(
        answers({
          nodes: [EXPANSION.nodes[0]],
          edges: [],
        })
      ),
      PARAMS
    )
    await screen.findByText(`Every tuple reachable from ${ROOT} is shown.`)
    await waitFor(() => expect(nodeOf(container, ROOT)).toBeTruthy())
  })
})
