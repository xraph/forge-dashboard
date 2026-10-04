import { fireEvent, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import BrowserPage from "../src/pages/browser"
import { HEAD } from "./fixtures"
import { renderPage, stubClient } from "./harness"

const EMPTY_LIST = { objects: [], prefixes: [], nextCursor: null, foldersSupported: true, routed: false }
const CAS_OFF = { enabled: false, algorithm: null, bucket: null, index: null, resetsOnRestart: false, releaseSupported: false }
const STATUS = {
  store: "primary",
  driver: "local",
  health: { ok: true, error: null },
  capabilities: {
    multipart: false, presign: false, range: false, serverCopy: false,
    versioning: false, notification: false, lifecycle: false, folders: true,
  },
  config: { defaultBucket: "reports", chunkSize: 8388608, poolSize: 16, maxUploadBytes: 67108864 },
  flags: [],
  etagIsContentHash: false,
  contentSecret: "configured",
  backends: [],
  routingNote: null,
}
const LIST = { "objects.list": { objects: [], prefixes: [], nextCursor: null, foldersSupported: true, routed: false }, "cas.status": CAS_OFF, "system.status": STATUS }

afterEach(() => window.history.replaceState(null, "", "/"))

describe("BrowserPage header and path bar", () => {
  it("names the bucket and links back to Buckets", () => {
    window.history.replaceState(null, "", "/@trove/buckets/reports")
    renderPage(BrowserPage, stubClient(LIST), { bucket: "reports" })
    expect(screen.getByRole("heading", { name: "reports" })).toBeTruthy()
    expect(screen.getByRole("link", { name: "Buckets" }).getAttribute("href")).toBe("/@trove/buckets")
  })

  it("renders each prefix segment as a link back up, and the tail as an input", () => {
    window.history.replaceState(null, "", "/@trove/buckets/reports?prefix=2026%2F09%2Fsum")
    renderPage(BrowserPage, stubClient(LIST), { bucket: "reports" })
    const nav = screen.getByRole("form", { name: "Prefix" })
    expect(nav.querySelector('a[href="/@trove/buckets/reports"]')?.textContent).toBe("reports")
    expect(nav.querySelector('a[href="/@trove/buckets/reports?prefix=2026%2F"]')?.textContent).toBe("2026")
    expect(nav.querySelector('a[href="/@trove/buckets/reports?prefix=2026%2F09%2F"]')?.textContent).toBe("09")
    expect((screen.getByRole("textbox", { name: "Continue the prefix" }) as HTMLInputElement).value).toBe("sum")
  })

  it("gives the prefix input room for its placeholder, and keeps its name", () => {
    window.history.replaceState(null, "", "/@trove/buckets/reports")
    renderPage(BrowserPage, stubClient(LIST), { bucket: "reports" })
    const input = screen.getByRole("textbox", { name: "Continue the prefix" }) as HTMLInputElement
    expect(input.placeholder).toBe("filter this prefix, then Enter")
    // w-48 clips that placeholder at text-xs in the mono face; w-64 holds it.
    expect(input.className.split(/\s+/)).toContain("w-64")
    expect(input.className.split(/\s+/)).not.toContain("w-48")
  })

  it("names a non-default store and keeps it on every link", () => {
    window.history.replaceState(null, "", "/@trove/buckets/backups?store=archive&prefix=db%2F")
    renderPage(BrowserPage, stubClient(LIST), { bucket: "backups" })
    expect(screen.getByText("archive").className).toContain("font-mono")
    const nav = screen.getByRole("form", { name: "Prefix" })
    expect(nav.querySelector('a[href="/@trove/buckets/backups?store=archive"]')).toBeTruthy()
  })

  it("asks the operator to pick an object until a key is selected", () => {
    window.history.replaceState(null, "", "/@trove/buckets/reports")
    renderPage(BrowserPage, stubClient({ "objects.list": EMPTY_LIST, "cas.status": CAS_OFF, "system.status": STATUS }), { bucket: "reports" })
    expect(screen.getByText("Select an object to see it here.")).toBeTruthy()
  })

  it("opens the inspector for the key in the URL", async () => {
    window.history.replaceState(null, "", "/@trove/buckets/reports?key=readme.txt")
    renderPage(
      BrowserPage,
      stubClient({ "objects.list": EMPTY_LIST, "cas.status": CAS_OFF, "system.status": STATUS, "objects.head": { ...HEAD, object: { ...HEAD.object, key: "readme.txt" } } }),
      { bucket: "reports" },
    )
    expect(await screen.findByRole("heading", { name: "readme.txt" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Copy to" })).toBeTruthy()
  })

  it("offers Upload files on an ordinary bucket", () => {
    window.history.replaceState(null, "", "/@trove/buckets/reports")
    renderPage(BrowserPage, stubClient(LIST), { bucket: "reports" })
    expect((screen.getByRole("button", { name: "Upload files" }) as HTMLButtonElement).disabled).toBe(false)
    expect(screen.queryByText(/CAS manages this bucket/)).toBeNull()
  })

  it("says CAS manages the bucket and disables Upload files when it does", async () => {
    window.history.replaceState(null, "", "/@trove/buckets/reports")
    const cas = { enabled: true, algorithm: "sha256", bucket: "reports", index: "memory", resetsOnRestart: false, releaseSupported: true }
    renderPage(BrowserPage, stubClient({ ...LIST, "cas.status": cas }), { bucket: "reports" })
    expect(await screen.findByText("CAS manages this bucket. Its objects are written through CAS, not uploaded here.")).toBeTruthy()
    expect((screen.getByRole("button", { name: "Upload files" }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe("BrowserPage layout", () => {
  function many(n: number) {
    return Array.from({ length: n }, (_, i) => ({
      key: `k${String(i).padStart(3, "0")}`,
      storedSize: 10,
      etag: null,
      lastModified: null,
      contentType: null,
      storageClass: null,
    }))
  }

  function leftScroller(container: HTMLElement) {
    const group = container.querySelector<HTMLElement>('[data-slot="resizable-panel-group"]')
    const left = container.querySelectorAll<HTMLElement>('[data-slot="resizable-panel"]')[0]
    // The kit's table container is overflow-x-auto. The listing's own
    // scroller is the only element in the left panel that is overflow-auto.
    const scrollers = Array.from(left.querySelectorAll<HTMLElement>("*")).filter((el) => el.className.split(/\s+/).includes("overflow-auto"))
    return { group, left, scrollers }
  }

  it("bounds the panel group's height, so the inspector stays in view", () => {
    window.history.replaceState(null, "", "/@trove/buckets/reports")
    const { container } = renderPage(BrowserPage, stubClient(LIST), { bucket: "reports" })
    const { group } = leftScroller(container)
    expect(group?.style.height).toBe("calc(100vh - 16rem)")
    expect(group?.style.minHeight).toBe("24rem")
  })

  it("scrolls the listing in one container that fills the left panel", async () => {
    window.history.replaceState(null, "", "/@trove/buckets/reports")
    const list = { objects: many(100), prefixes: [], nextCursor: "n1", foldersSupported: true, routed: false }
    const { container } = renderPage(BrowserPage, stubClient({ ...LIST, "objects.list": list }), { bucket: "reports" })
    expect(await screen.findByText("100 shown, more under this prefix")).toBeTruthy()
    const { scrollers } = leftScroller(container)
    expect(scrollers).toHaveLength(1)
    const [scroller] = scrollers
    expect(scroller.className.split(/\s+/)).toEqual(expect.arrayContaining(["min-h-0", "flex-1"]))
    expect(scroller.style.height).toBe("")
    expect(scroller.contains(screen.getByRole("table"))).toBe(true)
    expect(scroller.contains(screen.getByRole("button", { name: "Load more" }))).toBe(true)
  })

  it("drives the virtualised table from the left panel's scroll container", async () => {
    window.history.replaceState(null, "", "/@trove/buckets/reports")
    const list = { objects: many(250), prefixes: [], nextCursor: null, foldersSupported: true, routed: false }
    const { container } = renderPage(BrowserPage, stubClient({ ...LIST, "objects.list": list }), { bucket: "reports" })
    expect(await screen.findByText("250 objects")).toBeTruthy()
    const { scrollers } = leftScroller(container)
    expect(scrollers).toHaveLength(1)
    const [scroller] = scrollers
    expect(scroller.style.height).toBe("")
    const table = screen.getByRole("table")
    expect(within(table).getByText("k000")).toBeTruthy()
    expect(within(table).queryByText("k180")).toBeNull()
    scroller.scrollTop = 37 * 170
    fireEvent.scroll(scroller)
    expect(await within(table).findByText("k180")).toBeTruthy()
    expect(within(table).queryByText("k000")).toBeNull()
  })
})
