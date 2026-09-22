import { describe, expect, it } from "vitest"
import { safeNext } from "../src/auth/next-param"

describe("safeNext", () => {
  it("keeps an ordinary internal path", () => {
    expect(safeNext("/forge/apps", "/forge")).toBe("/forge/apps")
  })

  it("falls back to the basename when absent", () => {
    expect(safeNext(null, "/forge")).toBe("/forge")
  })

  it("rejects a protocol-relative URL", () => {
    // "//evil.example.com" is a valid URL that leaves the site. This is the
    // case people miss, because it passes a naive startsWith("/") check.
    expect(safeNext("//evil.example.com", "/forge")).toBe("/forge")
  })

  it("rejects a backslash authority", () => {
    expect(safeNext("/\\evil.example.com", "/forge")).toBe("/forge")
  })

  it("rejects an absolute URL", () => {
    expect(safeNext("https://evil.example.com", "/forge")).toBe("/forge")
  })

  it("rejects a scheme-only target", () => {
    expect(safeNext("javascript:alert(1)", "/forge")).toBe("/forge")
  })

  it("rejects a relative path with no leading slash", () => {
    expect(safeNext("apps", "/forge")).toBe("/forge")
  })

  it("keeps a query string and a fragment", () => {
    expect(safeNext("/forge/apps?tab=live#top", "/forge")).toBe("/forge/apps?tab=live#top")
  })
})
