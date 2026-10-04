import { render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PluginProvider } from "@forge-go/dashboard-plugin"
import { Preview } from "../src/components/preview"
import { previewKind, PREVIEW_LIMIT } from "../src/content"
import type { ObjectHead } from "../src/types"
import { HEAD } from "./fixtures"
import { recordingQueryClient } from "./harness"

vi.mock("../src/components/code-view", () => ({
  default: ({ text, language }: { text: string; language: string }) => (
    <pre data-testid="code-view" data-language={language}>
      {text}
    </pre>
  ),
}))

const LINK = { url: "/dashboard/trove/content?t=abc", expiresAt: "2026-09-30T12:01:00Z" }

function headWith(contentType: string | null, storedSize = 100): ObjectHead {
  return { ...HEAD, object: { ...HEAD.object, contentType, storedSize } }
}

function respond(body: BodyInit, init: ResponseInit = { status: 200 }) {
  return vi.fn().mockResolvedValue(new Response(body, init))
}

function renderPreview(head: ObjectHead) {
  const recorded = recordingQueryClient({ "objects.contentUrl": LINK })
  render(
    <PluginProvider client={recorded.client}>
      <Preview store="" bucket="reports" head={head} />
    </PluginProvider>,
  )
  return recorded.sent
}

describe("previewKind", () => {
  it("sorts content types into what the preview can show", () => {
    expect(previewKind("application/json")).toBe("json")
    expect(previewKind("application/vnd.api+json; charset=utf-8")).toBe("json")
    expect(previewKind("text/plain")).toBe("text")
    expect(previewKind("text/csv")).toBe("text")
    expect(previewKind("application/x-yaml")).toBe("text")
    expect(previewKind("image/png")).toBe("image")
    expect(previewKind("image/svg+xml")).toBe("image")
    expect(previewKind("application/pdf")).toBe("none")
    expect(previewKind(null)).toBe("none")
  })
})

describe("Preview", () => {
  beforeEach(() => {
    // jsdom has neither; assign them for the duration of each test.
    URL.createObjectURL = vi.fn(() => "blob:preview")
    URL.revokeObjectURL = vi.fn()
  })
  afterEach(() => vi.unstubAllGlobals())

  it("fetches a text preview through a preview ticket and pretty-prints whole JSON", async () => {
    vi.stubGlobal("fetch", respond('{"total":4812}'))
    const sent = renderPreview(headWith("application/json"))
    const view = await screen.findByTestId("code-view")
    expect(view.getAttribute("data-language")).toBe("json")
    expect(view.textContent).toBe('{\n  "total": 4812\n}')
    expect(sent[0]).toEqual({ intent: "objects.contentUrl", params: { bucket: "reports", key: HEAD.object.key, purpose: "preview" } })
  })

  it("says when it shows only the first 256 KiB, and does not reformat a cut JSON", async () => {
    vi.stubGlobal("fetch", respond("x".repeat(PREVIEW_LIMIT)))
    renderPreview(headWith("application/json", 900_000))
    expect(await screen.findByText("Showing the first 256 KiB.")).toBeTruthy()
    expect((await screen.findByTestId("code-view")).textContent?.length).toBe(PREVIEW_LIMIT)
  })

  it("shows an image from a Blob behind an object URL", async () => {
    vi.stubGlobal("fetch", respond(new Uint8Array([137, 80, 78, 71])))
    const sent = renderPreview(headWith("image/png", 20480))
    const img = (await screen.findByRole("img", { name: `Preview of ${HEAD.object.key}` })) as HTMLImageElement
    expect(img.getAttribute("src")).toBe("blob:preview")
    expect(sent[0].params).toEqual({ bucket: "reports", key: HEAD.object.key, purpose: "download" })
  })

  it("does not fetch an image over 4 MiB", async () => {
    const fetchSpy = respond("")
    vi.stubGlobal("fetch", fetchSpy)
    const sent = renderPreview(headWith("image/jpeg", 5 * 1024 * 1024))
    expect(await screen.findByText(/over 4 MiB as stored/)).toBeTruthy()
    expect(sent).toEqual([])
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("says there is no preview for other types, and asks for nothing", () => {
    const sent = renderPreview(headWith("application/pdf"))
    expect(screen.getByText("No preview for this content type.")).toBeTruthy()
    expect(sent).toEqual([])
  })

  it("shows the content route's own refusal", async () => {
    vi.stubGlobal("fetch", respond(JSON.stringify({ error: "This ticket has expired. Ask for a new link." }), { status: 403 }))
    renderPreview(headWith("text/plain"))
    expect(await screen.findByText("This ticket has expired. Ask for a new link.")).toBeTruthy()
  })

  it("says so when the route never answers", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network")))
    renderPreview(headWith("text/plain"))
    expect(await screen.findByText("The content route did not answer.")).toBeTruthy()
  })

  it("lets go of the object URL when it unmounts", async () => {
    vi.stubGlobal("fetch", respond(new Uint8Array([1])))
    const recorded = recordingQueryClient({ "objects.contentUrl": LINK })
    const { unmount } = render(
      <PluginProvider client={recorded.client}>
        <Preview store="" bucket="reports" head={headWith("image/png")} />
      </PluginProvider>,
    )
    await screen.findByRole("img")
    unmount()
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview"))
  })
})
