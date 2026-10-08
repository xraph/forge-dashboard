import { describe, expect, it } from "vitest"
import { createScopedClient } from "@forge-go/dashboard-plugin"
import { CONTENT_CAP, ENVELOPE_CAP, ENVELOPE_HEADROOM, isBodyLimitError, requestBytes, sizeProblem, sourceTypeFor } from "../src/ingest"

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

describe("requestBytes against the real client", () => {
  it("matches the envelope the client sends, to the byte", async () => {
    const payload = { collection_id: "col_01k70000000000000000000001", title: "T", source: "", source_type: "text/plain", content: "a \"q\"\n", metadata: {} }
    let body = ""
    // A token shaped like Forge's: 64 hex, a dot, a 10 digit timestamp.
    const token = `${"a".repeat(64)}.1760000000`
    const fetchStub = (async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/csrf")) return new Response(JSON.stringify({ token }), { status: 200 })
      body = String(init?.body)
      return new Response(JSON.stringify({ ok: true, data: {} }), { status: 200 })
    }) as unknown as typeof fetch
    await createScopedClient("/api/contract", "weave", fetchStub).command("documents.ingest", payload)
    expect(new TextEncoder().encode(body).length).toBe(requestBytes(payload))
  })
})

describe("sizeProblem", () => {
  it("names Weave's own cap past 1 MiB of content, as a refusal", () => {
    const content = "a".repeat(CONTENT_CAP + 1)
    const problem = sizeProblem(content, { content })
    expect(problem?.kind).toBe("content")
    expect(problem?.message).toMatch(/Weave ingests up to 1 MiB of text/)
  })

  it("warns about content whose encoded request is over the default transport limit", () => {
    const content = "a\n".repeat(400_000)
    expect(content.length).toBeLessThan(CONTENT_CAP)
    const problem = sizeProblem(content, { content })
    expect(problem?.kind).toBe("envelope")
    expect(problem?.message).toMatch(/contract_max_body_bytes/)
    expect(problem?.message).toMatch(/default 1 MiB request limit/)
  })

  it("lands on the right side of the limit at the boundary, headroom included", () => {
    const base = requestBytes({ content: "" })
    const fits = "a".repeat(ENVELOPE_CAP - ENVELOPE_HEADROOM - base)
    expect(requestBytes({ content: fits }) + ENVELOPE_HEADROOM).toBe(ENVELOPE_CAP)
    expect(sizeProblem(fits, { content: fits })).toBeNull()
    const over = fits + "a"
    expect(sizeProblem(over, { content: over })?.kind).toBe("envelope")
  })

  it("accepts a normal document", () => {
    expect(sizeProblem("Refunds take 14 days.", { content: "Refunds take 14 days." })).toBeNull()
  })
})

describe("isBodyLimitError", () => {
  it("recognises the transport's refusal and nothing else", () => {
    expect(isBodyLimitError({ code: "BAD_REQUEST", message: "request body exceeds 1048576 bytes" })).toBe(true)
    expect(isBodyLimitError({ code: "BAD_REQUEST", message: "invalid json" })).toBe(false)
    expect(isBodyLimitError({ code: "CONFLICT", message: "request body exceeds 1" })).toBe(false)
    expect(isBodyLimitError(undefined)).toBe(false)
  })
})
