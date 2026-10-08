import { expect, it } from "vitest"
import { fireEvent, screen } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { OverviewPage, CollectionPage } from "../src/pages/read"
import { EditorForm } from "../src/pages/editor"
import { renderPage, stubClient, failingClient } from "./harness"
const caps = {
  engine: { evaluation: false, unavailable_layers: ["instincts"] },
  can_manage: true,
  can_manage_privacy: false,
  scope: { app_id: "app", tenant_id: "tenant" },
  schemas: {
    instincts: [
      {
        key: "category",
        label: "category",
        type: "select",
        options: ["injection"],
        required: true,
      },
      {
        key: "sensitivity",
        label: "sensitivity",
        type: "select",
        options: ["balanced"],
        required: true,
      },
      {
        key: "action",
        label: "action",
        type: "select",
        options: ["block"],
        required: true,
      },
      {
        key: "strategies",
        label: "strategies",
        type: "array",
        fields: [
          { key: "name", label: "name", type: "text" },
          { key: "weight", label: "weight", type: "number" },
        ],
      },
    ],
  },
}
it("shows unavailable evaluation beside stored records", async () => {
  renderPage(
    OverviewPage,
    stubClient({
      capabilities: caps,
      overview: {
        sections: [{ collection: "instincts", available: true, total: 0 }],
      },
      "scans.list": {
        items: [],
        total: 0,
        limit: 25,
        offset: 0,
        has_more: false,
      },
    })
  )
  expect(
    await screen.findByText("Safety evaluation is unavailable")
  ).toBeTruthy()
  expect(screen.queryByRole("button", { name: "Run scan" })).toBeNull()
  expect(await screen.findByText("No stored scans")).toBeTruthy()
})
it("keeps denied and failed reads distinct from empty results", async () => {
  renderPage(
    (p) => <CollectionPage {...p} collection="instincts" />,
    failingClient(
      new ContractError("PERMISSION_DENIED", "Shield permission required")
    )
  )
  expect(
    (await screen.findAllByText(/Shield permission required/)).length
  ).toBeGreaterThan(0)
  expect(screen.queryByText("No instincts")).toBeNull()
})
it("uses structured controls and preserves explicit false and cleared arrays", async () => {
  const sent: unknown[] = []
  renderPage(
    () => (
      <EditorForm
        collection="instincts"
        capabilities={caps}
        initial={{
          id: "inst_example",
          name: "guard",
          enabled: true,
          strategies: [{ name: "classifier", weight: 0 }],
          category: "injection",
          sensitivity: "balanced",
          action: "block",
        }}
        pending={false}
        onSubmit={async (row) => {
          sent.push(row)
        }}
      />
    ),
    stubClient({})
  )
  fireEvent.click(screen.getByRole("button", { name: "Remove strategies 1" }))
  fireEvent.click(screen.getByLabelText("Enabled"))
  fireEvent.click(screen.getByRole("button", { name: "Save configuration" }))
  expect(sent).toHaveLength(1)
  expect(sent[0]).toMatchObject({ enabled: false, strategies: [] })
})
it("keeps the same structured row input mounted while typing", () => {
  renderPage(
    () => (
      <EditorForm
        collection="instincts"
        capabilities={caps}
        initial={{
          id: "inst_example",
          name: "guard",
          enabled: true,
          strategies: [{ name: "classifier", weight: 0 }],
          category: "injection",
          sensitivity: "balanced",
          action: "block",
        }}
        pending={false}
        onSubmit={async () => {}}
      />
    ),
    stubClient({})
  )
  const input = screen.getByRole("textbox", { name: "Name" })
  fireEvent.change(input, { target: { value: "changed" } })
  expect(screen.getByRole("textbox", { name: "Name" })).toBe(input)
})

it("names structured additions correctly", () => {
  renderPage(
    () => (
      <EditorForm
        collection="instincts"
        capabilities={caps}
        pending={false}
        onSubmit={async () => {}}
      />
    ),
    stubClient({})
  )
  expect(screen.getByRole("button", { name: "Add strategy" })).toBeTruthy()
})

it("prevents overlapping structured form submissions", async () => {
  let release: (() => void) | undefined
  const sent: unknown[] = []
  renderPage(
    () => (
      <EditorForm
        collection="boundaries"
        capabilities={caps}
        initial={{ id: "x", name: "x", enabled: true }}
        pending={false}
        onSubmit={async (row) => {
          sent.push(row)
          await new Promise<void>((resolve) => {
            release = resolve
          })
        }}
      />
    ),
    stubClient({})
  )
  fireEvent.click(screen.getByRole("button", { name: "Save configuration" }))
  fireEvent.click(screen.getByRole("button", { name: "Save configuration" }))
  expect(sent).toHaveLength(1)
  release?.()
})
