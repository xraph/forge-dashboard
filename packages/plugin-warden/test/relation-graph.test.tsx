import "./flow-env"
import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
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
    },
    {
      key: "group:eng#member",
      type: "group",
      id: "eng",
      relation: "member",
      depth: 1,
      walked: true,
    },
    { key: "user:erin", type: "user", id: "erin", depth: 2, walked: false },
    {
      key: "group:platform#member",
      type: "group",
      id: "platform",
      relation: "member",
      depth: 2,
      walked: true,
    },
    {
      key: "group:oncall#member",
      type: "group",
      id: "oncall",
      relation: "member",
      depth: 3,
      walked: false,
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
          "Stopped after 3 nodes, the engine's limit. More may be reachable."
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
      setup({ truncatedNodes: 2 })
      await drawn()
      expect(
        screen.getByText(
          "Showing 5 of 7 nodes. 2 more were reached but are not drawn."
        )
      ).toBeTruthy()
    })

    it("says nothing about the cap when no node was left out", async () => {
      setup()
      await drawn()
      expect(
        screen.queryByText(/more were reached but are not drawn/)
      ).toBeNull()
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
    it("starts at the tenant root, and sends the one chosen", async () => {
      const { expands } = setup()
      await drawn()
      const select = screen.getByLabelText("Namespace") as HTMLSelectElement
      expect(select.value).toBe("")
      fireEvent.change(select, { target: { value: "eng/platform" } })
      await waitFor(() =>
        expect(expands().at(-1)?.namespacePath).toBe("eng/platform")
      )
    })

    it("starts at the namespace the route names", async () => {
      const { expands } = setup({}, { ...PARAMS, namespace: "eng/platform" })
      await drawn()
      expect(expands()[0]?.namespacePath).toBe("eng/platform")
      expect(
        (screen.getByLabelText("Namespace") as HTMLSelectElement).value
      ).toBe("eng/platform")
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
