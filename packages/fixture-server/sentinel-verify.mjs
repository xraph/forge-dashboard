// sentinel-verify.mjs: the sentinel half of verify.mjs, kept in its own file
// like sentinel-fixtures.mjs so verify.mjs carries only an import, an input
// spread and one call.
//
// SENTINEL_INPUT feeds verify.mjs's walk over every advertised intent. The
// walk runs in sentinel-fixtures.mjs's INTENT_ORDER: queries first, then
// writes, and the deletes last, aimed at the seeded "Onboarding tour" suite.
// It also cancels the seeded stalled run and starts one run on "Billing FAQ".
//
// verifySentinel runs after the walk and checks the rules the Go contract
// enforces, not just that an intent answered. Every check reads seeded
// entities or creates its own, and never relies on the walk's writes: the
// trove checks in verify.mjs reset the whole server partway through, which
// reseeds sentinel too. Run verify.mjs against a freshly started server (or
// after POST _fixture/reset): the walk's deletes cannot run twice.

import { SENTINEL_IDS as I } from "./sentinel-fixtures.mjs"

export const SENTINEL_INPUT = {
  "sentinel::suites.detail": { suiteId: I.supportSuite },
}

/** Each entry is one area's checks, appended in task order. */
const CHECKS = []

/**
 * Runs every sentinel check. `dispatch` and `getCSRF` are verify.mjs's own.
 * The token is fetched here, fresh, because earlier spot checks expire every
 * token the server holds. Failures go onto verify.mjs's list so they count
 * toward its exit code.
 */
export async function verifySentinel({ dispatch, getCSRF, failures }) {
  const csrf = await getCSRF()
  const q = (intent, input = {}) => dispatch("sentinel", intent, "query", input, csrf)
  const c = (intent, input = {}) => dispatch("sentinel", intent, "command", input, csrf)
  const check = (name, ok, detail) => {
    console.log(`  sentinel ${name}: ${ok}`)
    if (!ok) failures.push({ key: `spot-check::sentinel ${name}`, reason: typeof detail === "string" ? detail : JSON.stringify(detail) })
  }
  const ctx = {
    q,
    c,
    check,
    data: (r) => r.body?.data,
    code: (r) => r.body?.error?.code,
    message: (r) => r.body?.error?.message,
    invalidates: (r) => (r.body?.meta?.invalidates ?? []).join(","),
  }
  for (const run of CHECKS) await run(ctx)
}

// --- config and suites (reads), tenancy
CHECKS.push(async ({ q, check, data, code, message }) => {
  const config = data(await q("config.get"))
  const names = config?.scorers?.map((s) => s.name) ?? []
  check("config.get lists the scorers sorted by name", names.join(",") === [...names].sort().join(",") && names.length === 11, names)
  const needsConfig = config?.scorers?.filter((s) => s.requiresConfig).map((s) => s.name).join(",")
  check("requiresConfig is true for exactly cost, latency, length and regex", needsConfig === "cost,latency,length,regex", needsConfig)
  check("a scorer says usesLlm, spelled that way", config?.scorers?.every((s) => typeof s.usesLlm === "boolean" && !("usesLLM" in s)) === true, config?.scorers?.[0])
  check("config.get carries the effective thresholds", config?.passThreshold === 0.7 && config?.regressionThreshold === 0.05 && config?.concurrency === 4, config)

  const suites = data(await q("suites.list"))?.items ?? []
  check("suites.list never shows another app's suite", suites.length > 0 && !suites.some((s) => s.id === I.otherSuite), suites.map((s) => s.id))
  const support = data(await q("suites.detail", { suiteId: I.supportSuite }))
  check(
    "a suite with a current prompt version says promptSource version and names it",
    support?.promptSource === "version" && support?.currentPromptVersion?.id === I.supportVersion2 && support?.currentPromptVersion?.version === 2,
    support,
  )
  check("suites.detail keeps the suite's own systemPrompt beside a current version", support?.systemPrompt?.startsWith("You are Nimbus, the support assistant") && !support.systemPrompt.includes("account email"), support?.systemPrompt)
  check("suites.detail names the current baseline with its pass rate", support?.currentBaseline?.id === I.supportBaseline && typeof support.currentBaseline.passRate === "number", support?.currentBaseline)
  const billing = data(await q("suites.detail", { suiteId: I.billingSuite }))
  check("a suite with no version or baseline omits both keys", billing?.promptSource === "suite" && !("currentPromptVersion" in billing) && !("currentBaseline" in billing), billing)

  const other = await q("suites.detail", { suiteId: I.otherSuite })
  const missing = await q("suites.detail", { suiteId: "suite_01j9se99999999999999999999" })
  const garbage = await q("suites.detail", { suiteId: "not-an-id" })
  check(
    "another app's suite, a missing one and a malformed id answer the same NOT_FOUND",
    [other, missing, garbage].every((r) => code(r) === "NOT_FOUND" && message(r) === "suite not found"),
    [other.body, missing.body, garbage.body],
  )
})
