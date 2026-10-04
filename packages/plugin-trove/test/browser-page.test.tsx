import { screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import BrowserPage from "../src/pages/browser"
import { HEAD } from "./fixtures"
import { renderPage, stubClient } from "./harness"

const EMPTY_LIST = { objects: [], prefixes: [], nextCursor: null, foldersSupported: true, routed: false }
const LIST = { "objects.list": { objects: [], prefixes: [], nextCursor: null, foldersSupported: true, routed: false } }

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

  it("names a non-default store and keeps it on every link", () => {
    window.history.replaceState(null, "", "/@trove/buckets/backups?store=archive&prefix=db%2F")
    renderPage(BrowserPage, stubClient(LIST), { bucket: "backups" })
    expect(screen.getByText("archive").className).toContain("font-mono")
    const nav = screen.getByRole("form", { name: "Prefix" })
    expect(nav.querySelector('a[href="/@trove/buckets/backups?store=archive"]')).toBeTruthy()
  })

  it("asks the operator to pick an object until a key is selected", () => {
    window.history.replaceState(null, "", "/@trove/buckets/reports")
    renderPage(BrowserPage, stubClient({ "objects.list": EMPTY_LIST }), { bucket: "reports" })
    expect(screen.getByText("Select an object to see it here.")).toBeTruthy()
  })

  it("opens the inspector for the key in the URL", async () => {
    window.history.replaceState(null, "", "/@trove/buckets/reports?key=readme.txt")
    renderPage(
      BrowserPage,
      stubClient({ "objects.list": EMPTY_LIST, "objects.head": { ...HEAD, object: { ...HEAD.object, key: "readme.txt" } } }),
      { bucket: "reports" },
    )
    expect(await screen.findByRole("heading", { name: "readme.txt" })).toBeTruthy()
  })
})
