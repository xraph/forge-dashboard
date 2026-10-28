// weave-verify.mjs: weave's inputs for verify.mjs's walk, and the rules the
// Go handlers enforce, checked over HTTP rather than "it answered".
// verify.mjs carries an import, `...WEAVE_INPUT` and one call; everything
// else lives here so weave never edits the shared file twice.
import { WEAVE_IDS as I, WEAVE_TENANT, OTHER_WEAVE_TENANT } from "./weave-fixtures.mjs"

/** Inputs keyed "weave::<intent>". A missing key sends {}. */
export const WEAVE_INPUT = {
  "weave::collections.get": { id: I.support },
  "weave::documents.get": { id: I.refund },
  "weave::documents.spans": { id: I.shipping },
  "weave::chunks.list": { collection_id: I.support },
  "weave::chunks.get": { id: I.firstChunk },
  "weave::collections.create": { name: "verify-weave", chunk_size: 128, chunk_overlap: 16, metadata: { source: "verify" } },
  "weave::collections.update": { id: I.scratch, name: "scratch-renamed", metadata: {} },
  "weave::collections.reindex": { id: I.support },
  "weave::documents.ingest": { collection_id: I.support, title: "Verify note", source_type: "text/plain", content: "Verify note: gift wrapping costs 3 euros and is added at checkout." },
  "weave::documents.delete": { id: I.draft },
  "weave::collections.delete": { id: I.scratch },
  "weave::retrieval.run": { query: "how long does a refund take" },
  "weave::retrieval.assemble": { hits: [{ chunk_id: I.firstChunk, content: "Refunds are issued within 14 days.", score: 0.8 }, { chunk_id: "", content: null, score: 0.5 }], max_tokens: 0 },
}

/** Every key in a value, at any depth. */
function keysOf(value, out = new Set()) {
  if (Array.isArray(value)) for (const v of value) keysOf(v, out)
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.add(k)
      keysOf(v, out)
    }
  }
  return out
}

export async function verifyWeave({ dispatch, getCSRF, failures, base }) {
  // The walk above wrote and deleted. Start from the seed so every answer
  // below is the seed's.
  await fetch(`${base}/_fixture/reset`, { method: "POST" })
  const csrf = await getCSRF()
  const q = (intent, input = {}) => dispatch("weave", intent, "query", input, csrf)
  const c = (intent, input = {}) => dispatch("weave", intent, "command", input, csrf)
  const check = (name, ok, detail) => {
    ok = Boolean(ok)
    console.log(`  weave ${name}: ${ok}`)
    if (!ok) failures.push({ key: `spot-check::weave ${name}`, reason: typeof detail === "string" ? detail : JSON.stringify(detail) })
  }
  const data = (r) => r.body?.data
  const code = (r) => r.body?.error?.code
  const ids = (r) => (data(r)?.items ?? []).map((x) => x.id).sort()

  // Tenant: every intent answers for the resolved tenant only. The field can
  // repeat it and nothing else.
  const mine = [I.support, I.scratch].sort().join()
  const all = await q("collections.list")
  const same = await q("collections.list", { tenant: WEAVE_TENANT })
  check("no tenant field lists only your tenant's collections", ids(all).join() === mine, all.body)
  check("naming your own tenant lists the same", ids(same).join() === mine, same.body)
  for (const intent of ["collections.list", "documents.list", "system.overview"]) {
    for (const tenant of [OTHER_WEAVE_TENANT, ""]) {
      const r = await q(intent, { tenant })
      check(`${intent} naming tenant ${JSON.stringify(tenant)} is PERMISSION_DENIED`, code(r) === "PERMISSION_DENIED", r.body)
    }
  }
  const foreignChunks = await q("chunks.list", { collection_id: I.support, tenant: OTHER_WEAVE_TENANT })
  check("chunks.list naming another tenant is PERMISSION_DENIED", code(foreignChunks) === "PERMISSION_DENIED", foreignChunks.body)
  const foreignRun = await c("retrieval.run", { query: "refund", tenant: OTHER_WEAVE_TENANT })
  check("retrieval.run naming another tenant is PERMISSION_DENIED", code(foreignRun) === "PERMISSION_DENIED", foreignRun.body)
  for (const [intent, id] of [["collections.get", I.handbook], ["documents.get", I.onboarding], ["documents.spans", I.onboarding]]) {
    const r = await q(intent, { id })
    check(`${intent} of another tenant's row is NOT_FOUND`, code(r) === "NOT_FOUND", r.body)
  }
  const handbookChunks = await q("chunks.list", { collection_id: I.handbook })
  check("another tenant's collection lists no chunks", data(handbookChunks)?.total === 0, handbookChunks.body)

  // Lists: newest first, clamped and echoed, negative refused.
  const clamped = await q("documents.list", { limit: 500 })
  check("a limit over 100 is clamped and echoed", data(clamped)?.limit === 100, clamped.body)
  check("a negative offset is BAD_REQUEST", code(await q("documents.list", { offset: -1 })) === "BAD_REQUEST")
  check("an unknown state is BAD_REQUEST", code(await q("documents.list", { state: "done" })) === "BAD_REQUEST")
  const gone = await q("documents.list", { collection_id: I.missingCollection })
  check("a collection that parses but doesn't exist is an empty page", data(gone)?.total === 0 && data(gone)?.items.length === 0, gone.body)
  check("chunks.list with no scope is BAD_REQUEST", code(await q("chunks.list")) === "BAD_REQUEST")
  check("a malformed ID is BAD_REQUEST", code(await q("documents.get", { id: "doc_nope" })) === "BAD_REQUEST")
  check("a missing document is NOT_FOUND", code(await q("documents.get", { id: I.missingDocument })) === "NOT_FOUND")

  // The states the page has to draw.
  const overview = await q("system.overview")
  check("the overview counts one stalled document", data(overview)?.stalled === 1, overview.body)
  check('the overview says its scope is "tenant"', data(overview)?.scope === "tenant", overview.body)
  check("the overview counts only your tenant's collections", data(overview)?.collections === 2, overview.body)
  const failed = await q("documents.get", { id: I.warranty })
  check("a failed document carries its stored error", data(failed)?.state === "failed" && typeof data(failed)?.error === "string", failed.body)
  const failedChunks = await q("chunks.list", { document_id: I.warranty })
  check("a vector upsert failure leaves its chunk rows", data(failedChunks)?.total === 2, failedChunks.body)
  const orphan = await q("chunks.get", { id: I.orphanChunk })
  check("a chunk whose document is gone opens with an empty title", data(orphan)?.document_title === "", orphan.body)
  const spans = await q("documents.spans", { id: I.shipping })
  const s = data(spans)?.spans ?? []
  check("the shipping spans have a gap to draw", s.some((x, i) => i > 0 && x.start_offset > s[i - 1].end_offset), spans.body)

  // Writes change the next read.
  const before = data(await q("documents.list", { collection_id: I.support }))?.total
  const ingest = await c("documents.ingest", { collection_id: I.support, title: "Spot check", content: "Spot check: parcels to islands take two extra days." })
  const after = data(await q("documents.list", { collection_id: I.support }))?.total
  check("an ingest answers ready with its chunk count", data(ingest)?.state === "ready" && data(ingest)?.chunk_count > 0, ingest.body)
  check("an ingest grows the list", after === before + 1, { before, after })
  const dup = await c("documents.ingest", { collection_id: I.support, content: "Spot check: parcels to islands take two extra days." })
  check("the same content again is CONFLICT naming a failed or stalled copy", code(dup) === "CONFLICT" && dup.body?.error?.message.includes("failed or stalled"), dup.body)
  const failing = await c("documents.ingest", { collection_id: I.support, content: "FIXTURE_FAIL_EMBED spot check" })
  check("a failed ingest is an answer, not an error", data(failing)?.state === "failed" && data(failing)?.chunk_count === 0 && typeof data(failing)?.error === "string", failing.body)
  const foreign = await c("documents.ingest", { collection_id: I.handbook, content: "Spot check: badges are collected from reception." })
  check("an ingest into another tenant's collection is NOT_FOUND", code(foreign) === "NOT_FOUND", foreign.body)
  const docId = data(ingest)?.document_id
  const ingested = await q("documents.get", { id: docId })
  check("an ingest lands in your tenant", data(ingested)?.tenant_id === WEAVE_TENANT, ingested.body)
  await c("documents.delete", { id: docId })
  check("a delete shrinks the list", !ids(await q("documents.list", { collection_id: I.support })).includes(docId))

  // Collections: the effective-value message, per-tenant names, rename invalidation.
  const overlap = await c("collections.create", { name: "too-small", chunk_size: 40 })
  check("an overlap refusal names the effective values", overlap.body?.error?.message === "chunk overlap 50 (the default) must be smaller than chunk size 40", overlap.body)
  check("a duplicate name in the same tenant is CONFLICT", code(await c("collections.create", { name: "support-articles" })) === "CONFLICT")
  const reused = await c("collections.create", { name: "acme-handbook" })
  check("a name another tenant uses is free in yours, and the new collection is yours", data(reused)?.tenant_id === WEAVE_TENANT, reused.body)
  const blank = await c("collections.update", { id: I.scratch, name: "   " })
  check("a blank rename is BAD_REQUEST", code(blank) === "BAD_REQUEST", blank.body)
  const rename = await c("collections.update", { id: I.scratch, name: "scratch-two" })
  check("a rename invalidates the document views and the overview", ["documents.list", "documents.get", "system.overview"].every((i) => rename.body?.meta?.invalidates?.includes(i)), rename.body?.meta)

  // Retrieval.
  const run = await c("retrieval.run", { query: "refund parcel store credit", top_k: 5, max_tokens: 60 })
  const result = data(run)?.result
  const context = data(run)?.context
  const keys = keysOf(data(run))
  check("a run carries no vector or embedding key", !["vector", "vectors", "embedding", "embeddings"].some((k) => keys.has(k)), [...keys])
  check("a run has hits and an orphaned one among hits or left out", result?.hits.length > 0 && [...result.hits, ...result.left_out].some((h) => h.orphaned), result)
  check("a run reorders and leaves something out", result?.reordered === true && result?.left_out.length > 0, result)
  check("a small budget cuts the context off", context?.first_excluded >= 0, context)
  const echoed = result.hits.map((h) => ({ chunk_id: h.chunk?.id ?? "", content: h.chunk ? h.chunk.content : null, score: h.score }))
  const again = await c("retrieval.assemble", { hits: echoed, max_tokens: 60 })
  check("re-assembling the same hits gives the same context", data(again)?.context === context?.context && JSON.stringify(data(again)?.included) === JSON.stringify(context?.included), data(again))
  check("a run's context starts with the template header", context?.context.startsWith("Relevant context:\n\n"), context)
  const noneIn = await c("retrieval.assemble", { hits: [{ chunk_id: "", content: null, score: 0.5 }, { chunk_id: "", content: null, score: 0.4 }] })
  check(
    "assembling hits that all lack content answers the bare header",
    data(noneIn)?.context === "Relevant context:\n\n" && data(noneIn)?.included.length === 0 && data(noneIn)?.first_excluded === 0,
    data(noneIn),
  )
  check("an empty query is BAD_REQUEST", code(await c("retrieval.run", { query: "  " })) === "BAD_REQUEST")
  check("51 hits is BAD_REQUEST", code(await c("retrieval.assemble", { hits: Array.from({ length: 51 }, () => ({ chunk_id: "", content: "x", score: 0 })) })) === "BAD_REQUEST")

  await fetch(`${base}/_fixture/reset`, { method: "POST" })
}
