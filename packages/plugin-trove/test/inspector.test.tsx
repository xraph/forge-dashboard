import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ContractError, PluginProvider } from "@forge-go/dashboard-plugin"
import type { ScopedClient } from "@forge-go/dashboard-plugin"
import { Inspector } from "../src/components/inspector"
import { HEAD } from "./fixtures"
import { recordingQueryClient, stubClient } from "./harness"

function renderInspector(client: ScopedClient, objectKey = HEAD.object.key) {
  return render(
    <PluginProvider client={client}>
      <Inspector store="" bucket="reports" objectKey={objectKey} />
    </PluginProvider>,
  )
}

describe("Inspector", () => {
  let click: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})
  })
  afterEach(() => {
    click.mockRestore()
    vi.unstubAllGlobals()
  })

  it("shows what objects.head reports, with identifiers in mono and absences as none", async () => {
    renderInspector(stubClient({ "objects.head": HEAD }))
    expect(await screen.findByRole("heading", { name: "2026/09/summary.json" })).toBeTruthy()
    expect(screen.getByText("9f3a01").className).toContain("font-mono")
    expect(screen.getByText("application/json").className).toContain("font-mono")
    expect(screen.getByText("owner=ops")).toBeTruthy()
    expect(screen.getByText("team=billing")).toBeTruthy()
    expect(screen.getByLabelText("no storage class")).toBeTruthy()
    expect(screen.getByLabelText("no version")).toBeTruthy()
  })

  it("words middleware as what matches now, never as what happened to the object", async () => {
    renderInspector(stubClient({ "objects.head": HEAD }))
    expect(await screen.findByText("compress")).toBeTruthy()
    expect(screen.getByText(/current config/)).toBeTruthy()
    expect(screen.getByText(/records nothing about how this object was written/)).toBeTruthy()
    expect(screen.queryByText(/is compressed|was compressed|encrypted/i)).toBeNull()
  })

  it("says when nothing matches the key now", async () => {
    renderInspector(stubClient({ "objects.head": { ...HEAD, middleware: [] } }))
    expect(await screen.findByText("No middleware matches this key in the current config.")).toBeTruthy()
  })

  it("asks for a download link only when Download is clicked", async () => {
    const { client, sent } = recordingQueryClient({
      "objects.head": HEAD,
      "objects.contentUrl": { url: "/dashboard/trove/content?t=abc", expiresAt: "2026-09-30T12:01:00Z" },
    })
    renderInspector(client)
    await screen.findByRole("heading", { name: "2026/09/summary.json" })
    expect(sent.some((s) => s.intent === "objects.contentUrl")).toBe(false)
    fireEvent.click(screen.getByRole("button", { name: "Download" }))
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1))
    expect(sent.find((s) => s.intent === "objects.contentUrl")?.params).toEqual({
      bucket: "reports",
      key: "2026/09/summary.json",
      purpose: "download",
    })
    const anchor = click.mock.instances[0] as unknown as HTMLAnchorElement
    expect(anchor.getAttribute("href")).toBe("/dashboard/trove/content?t=abc")
    expect(anchor.hasAttribute("download")).toBe(true)
  })

  it("shows why a download could not start", async () => {
    const client = {
      extension: "trove",
      query: async (intent: string) => {
        if (intent === "objects.head") return HEAD
        throw new ContractError("NOT_FOUND", "object not found")
      },
      command: async () => undefined,
    } as unknown as ScopedClient
    renderInspector(client)
    fireEvent.click(await screen.findByRole("button", { name: "Download" }))
    expect(await screen.findByText("Could not start the download")).toBeTruthy()
  })

  it("copies the full key", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } })
    renderInspector(stubClient({ "objects.head": HEAD }))
    fireEvent.click(await screen.findByRole("button", { name: "Copy key" }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("2026/09/summary.json"))
    expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy()
  })

  it("reads as gone when the object no longer exists", async () => {
    const client = {
      extension: "trove",
      query: async () => {
        throw new ContractError("NOT_FOUND", "object not found")
      },
      command: async () => undefined,
    } as unknown as ScopedClient
    renderInspector(client)
    expect(await screen.findByText("This object is gone")).toBeTruthy()
  })
})
