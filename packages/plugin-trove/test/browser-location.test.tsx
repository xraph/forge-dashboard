import { act, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { mountPath } from "@forge-go/dashboard-plugin"
import trovePlugin from "../src/index"
import {
  TROVE_MOUNT,
  browserHref,
  displayName,
  folderOf,
  parseBrowserSearch,
  useBrowserLocation,
} from "../src/browser-location"

afterEach(() => {
  window.history.replaceState(null, "", "/")
})

describe("browserHref", () => {
  it("is the plugin's real mount point", () => {
    expect(`${TROVE_MOUNT}/buckets/x`).toBe(mountPath(trovePlugin, "/buckets/x"))
  })

  it("leaves out every empty part", () => {
    expect(browserHref("reports")).toBe("/@trove/buckets/reports")
    expect(browserHref("reports", { store: "", prefix: "", key: "" })).toBe("/@trove/buckets/reports")
  })

  it("carries store, prefix and key in the query", () => {
    expect(browserHref("backups", { store: "archive", prefix: "db/", key: "db/x.dump" })).toBe(
      "/@trove/buckets/backups?store=archive&prefix=db%2F&key=db%2Fx.dump",
    )
  })

  it("round-trips keys with characters that mean something in a URL", () => {
    for (const key of ["q3 résumé #1.pdf", "a+b%2F?c", "2026//odd/", "&=?#"]) {
      const href = browserHref("reports", { prefix: key, key })
      const search = href.slice(href.indexOf("?"))
      expect(parseBrowserSearch(search)).toEqual({ store: "", prefix: key, key })
    }
  })

  it("encodes the bucket as one path segment", () => {
    expect(browserHref("a/b")).toBe("/@trove/buckets/a%2Fb")
  })
})

describe("folderOf and displayName", () => {
  it("takes the prefix up to and including its last slash", () => {
    expect(folderOf("")).toBe("")
    expect(folderOf("2026/")).toBe("2026/")
    expect(folderOf("2026/09/sum")).toBe("2026/09/")
    expect(folderOf("sum")).toBe("")
  })

  it("shows a key relative to the folder it is listed under", () => {
    expect(displayName("2026/09/summary.json", "2026/09/")).toBe("summary.json")
    expect(displayName("2026/09/", "2026/")).toBe("09/")
    expect(displayName("other", "2026/")).toBe("other")
  })
})

describe("useBrowserLocation", () => {
  it("reads the query string", () => {
    window.history.replaceState(null, "", "/@trove/buckets/reports?prefix=2026%2F&key=2026%2Fa")
    const { result } = renderHook(() => useBrowserLocation())
    expect(result.current).toEqual({ store: "", prefix: "2026/", key: "2026/a" })
  })

  it("follows back and forward", () => {
    window.history.replaceState(null, "", "/@trove/buckets/reports?prefix=2026%2F")
    const { result } = renderHook(() => useBrowserLocation())
    act(() => {
      window.history.replaceState(null, "", "/@trove/buckets/reports?prefix=2025%2F")
      window.dispatchEvent(new PopStateEvent("popstate"))
    })
    expect(result.current.prefix).toBe("2025/")
  })
})
