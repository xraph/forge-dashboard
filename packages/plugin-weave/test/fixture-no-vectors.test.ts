import { beforeEach, describe, expect, it } from "vitest"

// The fixture is plain .mjs with no types, and it is a dev tool rather than a
// shipped module, so the imports below carry no declaration and are cast.

class FixtureError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message)
  }
}

type Handler = {
  kind: string
  handler: (input: Record<string, unknown>) => unknown
}
type Fixture = {
  createWeaveHandlers: (e: typeof FixtureError) => Record<string, Handler>
  resetWeave: () => void
}
type Verify = { WEAVE_INPUT: Record<string, Record<string, unknown>> }

let fixture: Fixture
let verify: Verify

beforeEach(async () => {
  // @ts-expect-error TS7016: weave-fixtures.mjs has no declaration file.
  fixture = (await import("../../fixture-server/weave-fixtures.mjs")) as Fixture
  // @ts-expect-error TS7016: weave-verify.mjs has no declaration file.
  verify = (await import("../../fixture-server/weave-verify.mjs")) as Verify
  fixture.resetWeave()
})

const FORBIDDEN = new Set(["vector", "vectors", "embedding", "embeddings"])

/** Every forbidden key, and every numeric array long enough to be an embedding. */
function leaks(value: unknown, path: string, out: string[]): string[] {
  if (Array.isArray(value)) {
    if (value.length > 64 && value.every((v) => typeof v === "number"))
      out.push(`${path}: ${value.length} numbers`)
    value.forEach((v, i) => leaks(v, `${path}[${i}]`, out))
  } else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN.has(k.toLowerCase())) out.push(`${path}.${k}`)
      leaks(v, `${path}.${k}`, out)
    }
  }
  return out
}

describe("the weave fixture", () => {
  it("answers every intent the contract declares", () => {
    const handlers = fixture.createWeaveHandlers(FixtureError)
    expect(Object.keys(handlers).sort()).toEqual(
      [
        "chunks.get",
        "chunks.list",
        "collections.create",
        "collections.delete",
        "collections.get",
        "collections.list",
        "collections.reindex",
        "collections.update",
        "documents.delete",
        "documents.get",
        "documents.ingest",
        "documents.list",
        "documents.spans",
        "retrieval.assemble",
        "retrieval.run",
        "system.components",
        "system.overview",
      ].sort()
    )
  })

  it("never answers with a vector or an embedding", () => {
    const handlers = fixture.createWeaveHandlers(FixtureError)
    const found: string[] = []
    for (const [intent, h] of Object.entries(handlers)) {
      const out = h.handler(verify.WEAVE_INPUT[`weave::${intent}`] ?? {})
      leaks(out, intent, found)
    }
    expect(found).toEqual([])
  })
})
