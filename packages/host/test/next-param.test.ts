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

  it("rejects a tab that the URL parser would strip", () => {
    expect(safeNext("/\t/evil.example.com", "/forge")).toBe("/forge")
  })

  it("rejects a newline that the URL parser would strip", () => {
    expect(safeNext("/\n/evil.example.com", "/forge")).toBe("/forge")
  })

  it("rejects a carriage return that the URL parser would strip", () => {
    expect(safeNext("/\r/evil.example.com", "/forge")).toBe("/forge")
  })

  it("rejects a control character before a backslash", () => {
    expect(safeNext("/\t\\evil.example.com", "/forge")).toBe("/forge")
  })
})
