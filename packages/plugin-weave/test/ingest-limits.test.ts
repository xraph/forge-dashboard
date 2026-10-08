import { describe, expect, it } from "vitest"
import { CONTENT_CAP, requestBytes, sizeProblem, sourceTypeFor } from "../src/ingest"

describe("sourceTypeFor", () => {
  it("follows the file's extension", () => {
    expect(sourceTypeFor("notes.md")).toBe("text/markdown")
    expect(sourceTypeFor("FAQ.HTML")).toBe("text/html")
    expect(sourceTypeFor("rows.csv")).toBe("text/csv")
    expect(sourceTypeFor("data.json")).toBe("application/json")
    expect(sourceTypeFor("readme.txt")).toBe("text/plain")
    expect(sourceTypeFor("archive")).toBe("text/plain")
  })
})

describe("requestBytes", () => {
  it("counts the payload as the transport will see it, escaping included", () => {
    const plain = requestBytes({ content: "abc" })
    const escaped = requestBytes({ content: "a\nb" })
    expect(escaped - plain).toBe(1)
  })
})

describe("sizeProblem", () => {
  it("names Weave's own cap past 1 MiB of content", () => {
    const content = "a".repeat(CONTENT_CAP + 1)
    expect(sizeProblem(content, { content })).toMatch(/Weave ingests up to 1 MiB of text/)
  })

  it("refuses content whose encoded request is over the transport limit", () => {
    const content = "a\n".repeat(400_000)
    expect(content.length).toBeLessThan(CONTENT_CAP)
    expect(sizeProblem(content, { content })).toMatch(/contract_max_body_bytes/)
  })

  it("accepts a normal document", () => {
    expect(sizeProblem("Refunds take 14 days.", { content: "Refunds take 14 days." })).toBeNull()
  })
})
