import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { ConfigPage } from "../src/pages/config"
import { configPath } from "../src/keys"
import {
  failingClient,
  recordingQueryClient,
  renderPage,
  stubClient,
} from "./harness"

function entry(over: Record<string, unknown> = {}) {
  return {
    id: "cfg_01",
    key: "http/timeout",
    value: "90s",
    valueType: "duration",
    knownType: true,
    valueMatchesType: true,
    version: 3,
    description: "Request timeout",
    metadata: {},
    createdAt: "2026-09-20T10:00:00Z",
    updatedAt: "2026-09-23T10:00:00Z",
    ...over,
  }
}

const ENTRIES = {
  entries: [
    entry(),
    entry({
      id: "cfg_02",
      key: "banner",
      value: "true",
      valueType: "string",
      version: 1,
    }),
    entry({
      id: "cfg_03",
      key: "max-items",
      value: "ten",
      valueType: "int",
      valueMatchesType: false,
      version: 12,
    }),
    entry({
      id: "cfg_04",
      key: "legacy",
      value: "a: b",
      valueType: "yaml",
      knownType: false,
      version: 2,
    }),
  ],
  total: 4,
}

const row = (name: string) =>
  screen.getAllByRole("row").find((r) => within(r).queryByText(name))!

const listParams = (sent: { intent: string; params?: unknown }[]) =>
  sent.filter((i) => i.intent === "config.list").map((i) => i.params)

describe("ConfigPage", () => {
  it("asks config.list for the first page with no keyPrefix key at all", async () => {
    const { client, sent } = recordingQueryClient({ "config.list": ENTRIES })
    renderPage(ConfigPage, client)
    await screen.findByText("banner")
    const params = listParams(sent)
    expect(params[0]).toEqual({ limit: 25, offset: 0 })
    expect(Object.keys(params[0] as object)).not.toContain("keyPrefix")
  })

  it("renders every column", async () => {
    renderPage(ConfigPage, stubClient({ "config.list": ENTRIES }))
    await screen.findByText("banner")
    for (const h of ["Key", "Type", "Value", "Version", "Updated"]) {
      expect(screen.getByRole("columnheader", { name: h })).toBeTruthy()
    }
    const first = row("http/timeout")
    const type = within(first).getByText("duration", {
      selector: '[data-slot="badge"]',
    })
    expect(type.className).toMatch(/font-mono/)
    // Value, through ConfigValue: a duration is bare.
    expect(within(first).getByText("90s")).toBeTruthy()
    // Version, mono.
    const version = within(first).getByText("v3")
    expect(version.className).toMatch(/font-mono/)
    // Updated.
    expect(first.querySelectorAll("td")).toHaveLength(5)
    expect(within(first).queryByLabelText(/no update/i)).toBeNull()
  })

  it("shows a string value quoted, so \"true\" is not read as true", async () => {
    renderPage(ConfigPage, stubClient({ "config.list": ENTRIES }))
    await screen.findByText("banner")
    expect(within(row("banner")).getByText('"true"')).toBeTruthy()
  })

  it("links each key through configPath in mono, medium weight", async () => {
    renderPage(ConfigPage, stubClient({ "config.list": ENTRIES }))
    const link = await screen.findByRole("link", { name: "http/timeout" })
    expect(link.getAttribute("href")).toBe(configPath("http/timeout"))
    expect(link.getAttribute("href")).toBe("/config/http%2Ftimeout")
    expect(link.closest("td")?.className).toMatch(/font-mono text-xs font-medium/)
  })

  it("marks a value that does not match its type, and only that one", async () => {
    renderPage(ConfigPage, stubClient({ "config.list": ENTRIES }))
    await screen.findByText("max-items")
    const badge = within(row("max-items")).getByText("Wrong type", {
      selector: '[data-slot="badge"]',
    })
    expect(badge.className).toMatch(/destructive/)
    expect(screen.getAllByText("Wrong type")).toHaveLength(1)
  })

  it("marks an unknown type as unsupported, secondary, and only that one", async () => {
    renderPage(ConfigPage, stubClient({ "config.list": ENTRIES }))
    await screen.findByText("legacy")
    const legacy = row("legacy")
    const badge = within(legacy).getByText("Unsupported type", {
      selector: '[data-slot="badge"]',
    })
    expect(badge.className).toMatch(/bg-secondary/)
    // The type itself is still shown.
    expect(within(legacy).getByText("yaml")).toBeTruthy()
    expect(screen.getAllByText("Unsupported type")).toHaveLength(1)
  })

  it("shows the server total in the caption, not the page length", async () => {
    renderPage(
      ConfigPage,
      stubClient({ "config.list": { entries: ENTRIES.entries, total: 31 } }),
    )
    await screen.findByText("banner")
    expect(screen.getByText("31 entries")).toBeTruthy()
  })

  it("uses the singular for a total of one", async () => {
    renderPage(
      ConfigPage,
      stubClient({ "config.list": { entries: [entry()], total: 1 } }),
    )
    await screen.findByText("http/timeout")
    expect(screen.getByText("1 entry")).toBeTruthy()
  })

  it("says so and still counts when there is no config", async () => {
    renderPage(ConfigPage, stubClient({ "config.list": { entries: [], total: 0 } }))
    expect(await screen.findByText("No config yet.")).toBeTruthy()
    expect(screen.getByText("0 entries")).toBeTruthy()
    const links = screen.getAllByRole("link", { name: "New config" })
    expect(links).toHaveLength(2)
    for (const l of links) expect(l.getAttribute("href")).toBe("/new-config")
  })

  it("sends New config to /new-config from the header", async () => {
    renderPage(ConfigPage, stubClient({ "config.list": ENTRIES }))
    await screen.findByText("banner")
    expect(
      screen.getByRole("link", { name: "New config" }).getAttribute("href"),
    ).toBe("/new-config")
  })

  it("renders the error card, not an empty table, when the list fails", async () => {
    renderPage(
      ConfigPage,
      failingClient(new ContractError("INTERNAL", "vault store is down")),
    )
    expect(await screen.findByText(/Config unavailable/i)).toBeTruthy()
    expect(screen.getByText(/vault store is down/)).toBeTruthy()
    expect(screen.queryByRole("table")).toBeNull()
    expect(screen.queryByText("No config yet.")).toBeNull()
  })

  describe("the key prefix filter", () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    const filter = () => screen.getByLabelText("Key starts with") as HTMLInputElement

    it("waits 300ms, trims, sends keyPrefix and resets the offset to 0", async () => {
      const { client, sent } = recordingQueryClient({
        "config.list": { entries: ENTRIES.entries, total: 60 },
      })
      renderPage(ConfigPage, client)
      await screen.findByText("banner")
      fireEvent.click(screen.getByRole("button", { name: "Next page" }))
      await screen.findByText(/Page 2 of 3/)
      expect(listParams(sent)).toContainEqual({ limit: 25, offset: 25 })

      fireEvent.change(filter(), { target: { value: "  http/  " } })
      // Not yet: still inside the debounce window.
      act(() => {
        vi.advanceTimersByTime(299)
      })
      expect(listParams(sent).some((p) => "keyPrefix" in (p as object))).toBe(false)
      act(() => {
        vi.advanceTimersByTime(1)
      })
      await waitFor(() =>
        expect(listParams(sent)).toContainEqual({
          keyPrefix: "http/",
          limit: 25,
          offset: 0,
        }),
      )
      await screen.findByText(/Page 1 of 3/)
    })

    it("sends one request for a burst of typing, for the last text", async () => {
      const { client, sent } = recordingQueryClient({ "config.list": ENTRIES })
      renderPage(ConfigPage, client)
      await screen.findByText("banner")
      for (const v of ["h", "ht", "htt"]) {
        fireEvent.change(filter(), { target: { value: v } })
        act(() => {
          vi.advanceTimersByTime(100)
        })
      }
      act(() => {
        vi.advanceTimersByTime(300)
      })
      await waitFor(() =>
        expect(listParams(sent)).toContainEqual({
          keyPrefix: "htt",
          limit: 25,
          offset: 0,
        }),
      )
      const prefixes = listParams(sent)
        .map((p) => (p as { keyPrefix?: string }).keyPrefix)
        .filter((p) => p !== undefined)
      expect(prefixes).toEqual(["htt"])
    })

    it("drops keyPrefix again when the filter is cleared", async () => {
      const { client, sent } = recordingQueryClient({ "config.list": ENTRIES })
      renderPage(ConfigPage, client)
      await screen.findByText("banner")
      fireEvent.change(filter(), { target: { value: "http" } })
      act(() => {
        vi.advanceTimersByTime(300)
      })
      await waitFor(() =>
        expect(listParams(sent)).toContainEqual({
          keyPrefix: "http",
          limit: 25,
          offset: 0,
        }),
      )
      const before = listParams(sent).length
      fireEvent.change(filter(), { target: { value: "" } })
      act(() => {
        vi.advanceTimersByTime(300)
      })
      await waitFor(() => expect(listParams(sent).length).toBeGreaterThan(before))
      expect(listParams(sent).at(-1)).toEqual({ limit: 25, offset: 0 })
    })

    it("keeps the filter on screen while the results reload", async () => {
      renderPage(ConfigPage, stubClient({ "config.list": ENTRIES }))
      await screen.findByText("banner")
      fireEvent.change(filter(), { target: { value: "ban" } })
      act(() => {
        vi.advanceTimersByTime(300)
      })
      await screen.findByText("banner")
      expect(filter().value).toBe("ban")
    })

    it("names the prefix in the empty state", async () => {
      renderPage(ConfigPage, stubClient({ "config.list": { entries: [], total: 0 } }))
      await screen.findByText("No config yet.")
      fireEvent.change(filter(), { target: { value: " zzz " } })
      act(() => {
        vi.advanceTimersByTime(300)
      })
      expect(await screen.findByText("No keys start with zzz.")).toBeTruthy()
      expect(screen.queryByText("No config yet.")).toBeNull()
    })
  })
})
