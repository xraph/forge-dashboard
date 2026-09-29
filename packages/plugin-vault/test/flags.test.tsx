import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { FlagsPage } from "../src/pages/flags"
import { flagPath } from "../src/keys"
import {
  failingClient,
  recordingQueryClient,
  renderPage,
  stubClient,
} from "./harness"

function flag(over: Record<string, unknown> = {}) {
  return {
    id: "flg_01",
    key: "checkout/new-flow",
    type: "bool",
    defaultValue: false,
    defaultMatchesType: true,
    description: "The new checkout flow",
    tags: ["payments", "web"],
    enabled: true,
    createdAt: "2026-09-20T10:00:00Z",
    updatedAt: "2026-09-23T10:00:00Z",
    ...over,
  }
}

const FLAGS = {
  flags: [
    flag(),
    flag({
      id: "flg_02",
      key: "banner-text",
      type: "string",
      defaultValue: "true",
      tags: [],
      enabled: false,
    }),
    flag({
      id: "flg_03",
      key: "max-items",
      type: "int",
      defaultValue: "ten",
      defaultMatchesType: false,
    }),
  ],
  total: 3,
}

const row = (name: string) =>
  screen.getAllByRole("row").find((r) => within(r).queryByText(name))!

describe("FlagsPage", () => {
  it("asks flags.list for the first page with no type key at all", async () => {
    const { client, sent } = recordingQueryClient({ "flags.list": FLAGS })
    renderPage(FlagsPage, client)
    await screen.findByText("banner-text")
    const list = sent.filter((i) => i.intent === "flags.list")
    expect(list[0]?.params).toEqual({ limit: 25, offset: 0 })
    expect(Object.keys(list[0]?.params as object)).not.toContain("type")
  })

  it("renders every column", async () => {
    renderPage(FlagsPage, stubClient({ "flags.list": FLAGS }))
    await screen.findByText("banner-text")
    for (const h of ["Key", "Type", "Status", "Default", "Tags", "Updated"]) {
      expect(screen.getByRole("columnheader", { name: h })).toBeTruthy()
    }
    const first = row("checkout/new-flow")
    // Type badge, mono.
    const type = within(first).getByText("bool", { selector: '[data-slot="badge"]' })
    expect(type.className).toMatch(/font-mono/)
    // Status badge.
    expect(within(first).getByText("On", { selector: '[data-slot="badge"]' })).toBeTruthy()
    expect(
      within(row("banner-text")).getByText("Off", { selector: '[data-slot="badge"]' }),
    ).toBeTruthy()
    // Default, through FlagValue.
    expect(within(first).getByText("false")).toBeTruthy()
    // Tags.
    expect(within(first).getByText("payments")).toBeTruthy()
    expect(within(first).getByText("web")).toBeTruthy()
    // Updated.
    expect(first.querySelectorAll("td")).toHaveLength(6)
    expect(within(first).queryByLabelText(/no update/i)).toBeNull()
  })

  it("shows a string default quoted, so \"true\" is not read as true", async () => {
    renderPage(FlagsPage, stubClient({ "flags.list": FLAGS }))
    await screen.findByText("banner-text")
    expect(within(row("banner-text")).getByText('"true"')).toBeTruthy()
  })

  it("marks a default that does not match its type, and only that one", async () => {
    renderPage(FlagsPage, stubClient({ "flags.list": FLAGS }))
    await screen.findByText("max-items")
    const badge = within(row("max-items")).getByText("Wrong type", {
      selector: '[data-slot="badge"]',
    })
    expect(badge.className).toMatch(/destructive/)
    expect(screen.getAllByText("Wrong type")).toHaveLength(1)
  })

  it("reads no tags as none, not as blank", async () => {
    renderPage(FlagsPage, stubClient({ "flags.list": FLAGS }))
    await screen.findByText("banner-text")
    expect(within(row("banner-text")).getByLabelText("no tags")).toBeTruthy()
    expect(within(row("checkout/new-flow")).queryByLabelText("no tags")).toBeNull()
  })

  it("links each key through flagPath in mono, medium weight", async () => {
    renderPage(FlagsPage, stubClient({ "flags.list": FLAGS }))
    const link = await screen.findByRole("link", { name: "checkout/new-flow" })
    expect(link.getAttribute("href")).toBe(flagPath("checkout/new-flow"))
    expect(link.getAttribute("href")).toBe("/flags/checkout%2Fnew-flow")
    expect(link.closest("td")?.className).toMatch(/font-mono text-xs font-medium/)
  })

  it("shows the server total in the caption, singular for one", async () => {
    renderPage(
      FlagsPage,
      stubClient({ "flags.list": { flags: FLAGS.flags, total: 31 } }),
    )
    await screen.findByText("banner-text")
    expect(screen.getByText("31 flags")).toBeTruthy()
  })

  it("uses the singular for a total of one", async () => {
    renderPage(
      FlagsPage,
      stubClient({ "flags.list": { flags: [flag()], total: 1 } }),
    )
    await screen.findByText("checkout/new-flow")
    expect(screen.getByText("1 flag")).toBeTruthy()
  })

  it("says so and still counts when there are no flags", async () => {
    renderPage(FlagsPage, stubClient({ "flags.list": { flags: [], total: 0 } }))
    expect(await screen.findByText("No flags yet.")).toBeTruthy()
    expect(screen.getByText("0 flags")).toBeTruthy()
    const links = screen.getAllByRole("link", { name: "New flag" })
    expect(links).toHaveLength(2)
    for (const l of links) expect(l.getAttribute("href")).toBe("/new-flag")
  })

  it("sends the chosen type and resets the offset to 0", async () => {
    const { client, sent } = recordingQueryClient({
      "flags.list": { flags: FLAGS.flags, total: 60 },
    })
    renderPage(FlagsPage, client)
    await screen.findByText("banner-text")
    fireEvent.click(screen.getByRole("button", { name: "Next page" }))
    await screen.findByText(/Page 2 of 3/)
    expect(
      sent.filter((i) => i.intent === "flags.list").map((i) => i.params),
    ).toContainEqual({ limit: 25, offset: 25 })

    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "int" } })
    await waitFor(() =>
      expect(
        sent.filter((i) => i.intent === "flags.list").map((i) => i.params),
      ).toContainEqual({ type: "int", limit: 25, offset: 0 }),
    )
    await screen.findByText(/Page 1 of 3/)
  })

  it("offers All types and the five types", async () => {
    renderPage(FlagsPage, stubClient({ "flags.list": FLAGS }))
    await screen.findByText("banner-text")
    const select = screen.getByLabelText("Type") as HTMLSelectElement
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      "All types",
      "bool",
      "string",
      "int",
      "float",
      "json",
    ])
    expect(select.value).toBe("")
  })

  it("names the filter in the empty state when a type is chosen", async () => {
    renderPage(FlagsPage, stubClient({ "flags.list": { flags: [], total: 0 } }))
    await screen.findByText("No flags yet.")
    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "float" } })
    expect(await screen.findByText("No float flags.")).toBeTruthy()
    expect(screen.queryByText("No flags yet.")).toBeNull()
  })

  it("keeps the filter on screen after choosing a type", async () => {
    renderPage(FlagsPage, stubClient({ "flags.list": FLAGS }))
    await screen.findByText("banner-text")
    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "bool" } })
    await screen.findByText("banner-text")
    expect((screen.getByLabelText("Type") as HTMLSelectElement).value).toBe("bool")
  })

  it("sends New flag to /new-flag from the header", async () => {
    renderPage(FlagsPage, stubClient({ "flags.list": FLAGS }))
    await screen.findByText("banner-text")
    expect(
      screen.getByRole("link", { name: "New flag" }).getAttribute("href"),
    ).toBe("/new-flag")
  })

  it("renders the error card, not an empty table, when the list fails", async () => {
    renderPage(
      FlagsPage,
      failingClient(new ContractError("INTERNAL", "vault store is down")),
    )
    expect(await screen.findByText(/Flags unavailable/i)).toBeTruthy()
    expect(screen.getByText(/vault store is down/)).toBeTruthy()
    expect(screen.queryByRole("table")).toBeNull()
    expect(screen.queryByText("No flags yet.")).toBeNull()
  })
})
