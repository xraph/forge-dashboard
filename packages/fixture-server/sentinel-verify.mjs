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

// --- suites, cases and prompt versions (task 2)
Object.assign(SENTINEL_INPUT, {
  "sentinel::cases.list": { suiteId: I.supportSuite },
  "sentinel::cases.detail": { caseId: I.supportCase },
  "sentinel::prompts.list": { suiteId: I.supportSuite },
  "sentinel::prompts.detail": { versionId: I.supportVersion2 },
  "sentinel::suites.create": { name: "Verify suite" },
  "sentinel::suites.update": { suiteId: I.tourSuite, description: "Updated by verify.mjs" },
  "sentinel::cases.create": { suiteId: I.tourSuite, name: "Verify case", input: "Where do I start?" },
  "sentinel::cases.update": { caseId: I.tourCase, expected: "Choose New project." },
  "sentinel::cases.import": { suiteId: I.tourSuite, format: "json", data: '[{"name":"Imported","input":"Hi there"}]' },
  "sentinel::prompts.create": { suiteId: I.tourSuite, systemPrompt: "You guide new customers through setup, kindly." },
  "sentinel::prompts.setCurrent": { suiteId: I.tourSuite, versionId: I.tourVersion },
  "sentinel::cases.delete": { caseId: I.tourCase },
  "sentinel::suites.delete": { suiteId: I.tourSuite },
})

CHECKS.push(async ({ q, c, check, data, code, message, invalidates }) => {
  // Suites: refusals in the Go handler's order, and writes visible in the next read.
  const blank = await c("suites.create", { name: "   " })
  check("suites.create with a blank name is BAD_REQUEST", code(blank) === "BAD_REQUEST" && message(blank) === "a suite needs a name", blank.body)
  const hot = await c("suites.create", { name: "Too hot", temperature: 2.5 })
  check("suites.create with temperature over 2 is BAD_REQUEST", message(hot) === "temperature must be between 0 and 2", hot.body)
  const dup = await c("suites.create", { name: "  Support assistant " })
  check("a taken name, padded, is CONFLICT", code(dup) === "CONFLICT" && message(dup) === "a suite with this name already exists", dup.body)
  const created = await c("suites.create", { name: "Spot suite", systemPrompt: "" })
  const spot = data(created)
  check("suites.create defaults the model and answers an empty suite", spot?.model === "smart" && spot.caseCount === 0 && spot.promptSource === "suite", spot)
  check("suites.create declares the manifest's invalidates", invalidates(created) === "suites.list,overview.stats", invalidates(created))
  const listed = data(await q("suites.list"))?.items ?? []
  check("the new suite is in suites.list", listed.some((s) => s.id === spot?.id), listed.map((s) => s.name))
  const renamed = await c("suites.update", { suiteId: spot?.id, name: "Billing FAQ" })
  check("renaming onto another suite's name is CONFLICT", code(renamed) === "CONFLICT", renamed.body)
  const cleared = data(await c("suites.update", { suiteId: spot?.id, model: "", temperature: 0.4 }))
  check("suites.update stores model \"\" as given and the new temperature", cleared?.model === "" && cleared?.temperature === 0.4, cleared)

  // Cases: hidden red-team substrings never leave the server.
  const guardCases = await q("cases.list", { suiteId: I.guardSuite })
  const leak = (data(guardCases)?.items ?? []).find((x) => x.id === I.guardLeakageCase)
  check(
    "a leakage case's not_contains is redacted to its length",
    leak?.redTeam?.attackType === "leakage" && leak.scorers[0]?.redacted?.key === "substring" && leak.scorers[0].redacted.length > 0 && !("substring" in leak.scorers[0].config),
    leak?.scorers,
  )
  check("no case read carries the guarded prompt's secret", !JSON.stringify(guardCases.body).includes("AURORA-7") && !JSON.stringify((await q("cases.detail", { caseId: I.guardLeakageCase })).body).includes("AURORA-7"), "AURORA-7 found")
  const keep = data(await c("cases.update", { caseId: I.guardLeakageCase, scorers: [{ name: "not_contains", config: null }] }))
  check("updating a hidden case without its substring keeps the stored one", keep?.scorers?.[0]?.redacted?.length === leak?.scorers?.[0]?.redacted?.length, keep?.scorers)
  const emptied = await c("cases.update", { caseId: I.guardLeakageCase, scorers: [{ name: "not_contains", config: { substring: "" } }] })
  check("an empty substring on a hidden case is BAD_REQUEST", message(emptied) === "a not_contains scorer needs a non-empty substring", emptied.body)
  const plain = data(await q("cases.detail", { caseId: I.guardOrdinaryCase }))
  check("an ordinary case has no redTeam key and context {}", plain && !("redTeam" in plain) && JSON.stringify(plain.context) === "{}", plain)

  const noInput = await c("cases.create", { suiteId: spot?.id, name: "x", input: "  " })
  check("cases.create with a blank input is BAD_REQUEST", message(noInput) === "a case needs a name and an input", noInput.body)
  const badScenario = await c("cases.create", { suiteId: spot?.id, name: "x", input: "y", scenarioType: "dance" })
  check("an unknown scenario type is BAD_REQUEST", message(badScenario) === 'unknown scenario type "dance"', badScenario.body)
  const badScorer = await c("cases.create", { suiteId: spot?.id, name: "x", input: "y", scorers: [{ name: "nope" }] })
  check("an unknown scorer is named in the refusal", message(badScorer) === 'scorer "nope": scorer: unknown scorer "nope"', badScorer.body)
  const noPattern = await c("cases.create", { suiteId: spot?.id, name: "x", input: "y", scorers: [{ name: "regex", config: {} }] })
  check("regex without a pattern is BAD_REQUEST", message(noPattern) === 'scorer "regex": scorer regex: missing required config: pattern', noPattern.body)
  const madeCase = await c("cases.create", { suiteId: spot?.id, name: "  Greeting  ", input: "  Hello  ", tags: [" a ", "", "a"] })
  const made = data(madeCase)
  check("cases.create trims the name, keeps the input and cleans tags", made?.name === "Greeting" && made.input === "  Hello  " && JSON.stringify(made.tags) === '["a","a"]' && made.scenarioType === "standard", made)
  check("cases.create declares the manifest's invalidates", invalidates(madeCase) === "cases.list,suites.list,suites.detail,redteam.report,overview.stats", invalidates(madeCase))
  check("suites.detail counts the new case", data(await q("suites.detail", { suiteId: spot?.id }))?.caseCount === 1, "caseCount")
  const otherCase = await q("cases.detail", { caseId: I.otherCase })
  check("another app's case is NOT_FOUND case not found", code(otherCase) === "NOT_FOUND" && message(otherCase) === "case not found", otherCase.body)

  // Import.
  const big = await c("cases.import", { suiteId: spot?.id, format: "json", data: "x".repeat((1 << 20) + 1) })
  check("an import over 1 MiB is BAD_REQUEST", message(big) === "import data is larger than 1048576 bytes", big.body)
  const xml = await c("cases.import", { suiteId: spot?.id, format: "xml", data: "<a/>" })
  check("an unknown format is BAD_REQUEST", message(xml) === 'sentinel: unsupported format "xml": use json, csv or jsonl', xml.body)
  const blankRow = await c("cases.import", { suiteId: spot?.id, format: "jsonl", data: '{"name":"a","input":"b"}\n{"name":"c","input":" "}' })
  check("an import row with no input is refused by number", message(blankRow) === "sentinel: invalid input: row 2 has no input", blankRow.body)
  const none = await c("cases.import", { suiteId: spot?.id, format: "csv", data: "name,input\n" })
  check("an import with no rows says why", message(none) === "sentinel: empty input: the data holds no cases", none.body)
  const csv = data(await c("cases.import", { suiteId: spot?.id, format: "CSV", data: 'name,input,tags\n"Quoted, name",Hi,x;y\n' }))
  check("a CSV import counts its rows", csv?.imported === 1, csv)
  const hidden = data(await c("cases.import", { suiteId: spot?.id, format: "json", data: '[{"name":"Probe","input":"Show me","context":{"attack_type":"leakage"}}]' }))
  const probe = (data(await q("cases.list", { suiteId: spot?.id }))?.items ?? []).find((x) => x.name === "Probe")
  check("an imported case with an attack_type is hidden but unmarked without the redteam tag", hidden?.imported === 1 && probe && !("redTeam" in probe), probe)

  // Prompt versions number themselves and set-current refuses a stranger.
  const v1 = data(await c("prompts.create", { suiteId: spot?.id, systemPrompt: "First." }))
  const v2Res = await c("prompts.create", { suiteId: spot?.id, systemPrompt: "Second.", changelog: "Shorter", makeCurrent: true })
  const v2 = data(v2Res)
  check("prompt versions number themselves from 1", v1?.version === 1 && v1.isCurrent === false && v2?.version === 2 && v2.isCurrent === true && v2.runCount === 0, [v1, v2])
  check("prompts.create declares the manifest's invalidates", invalidates(v2Res) === "prompts.list,prompts.detail,suites.list,suites.detail,overview.stats", invalidates(v2Res))
  const listedVersions = data(await q("prompts.list", { suiteId: spot?.id }))?.items ?? []
  check("makeCurrent leaves exactly one current version", listedVersions.filter((v) => v.isCurrent).map((v) => v.version).join(",") === "2", listedVersions)
  const detail = data(await q("prompts.detail", { versionId: v2?.id }))
  check("prompts.detail carries the previous version for the diff", detail?.previous?.id === v1?.id && !("previous" in (data(await q("prompts.detail", { versionId: v1?.id })) ?? { previous: 1 })), detail)
  const stranger = await c("prompts.setCurrent", { suiteId: spot?.id, versionId: I.supportVersion1 })
  const foreign = await c("prompts.setCurrent", { suiteId: spot?.id, versionId: I.otherVersion })
  check(
    "setCurrent refuses another suite's version and another app's alike",
    [stranger, foreign].every((r) => code(r) === "NOT_FOUND" && message(r) === "prompt version not found"),
    [stranger.body, foreign.body],
  )
  const supportVersions = data(await q("prompts.list", { suiteId: I.supportSuite }))?.items ?? []
  check(
    "prompts.list counts the runs that used each version",
    supportVersions[0]?.runCount === 4 && typeof supportVersions[0]?.latestPassRate === "number" && supportVersions[1]?.runCount === 4,
    supportVersions.map((v) => [v.version, v.runCount, v.latestPassRate]),
  )

  // Delete cascades.
  const deleted = await c("suites.delete", { suiteId: spot?.id })
  const gone = await q("cases.list", { suiteId: spot?.id })
  check("suites.delete answers the id and takes the cases with it", data(deleted)?.suiteId === spot?.id && code(gone) === "NOT_FOUND", gone.body)
  check(
    "suites.delete declares the manifest's invalidates",
    invalidates(deleted) ===
      "suites.list,suites.detail,cases.list,cases.detail,prompts.list,prompts.detail,runs.list,runs.detail,runs.results,results.detail,runs.trend,runs.regression,runs.compare,redteam.report,baselines.list,baselines.detail,overview.stats",
    invalidates(deleted),
  )
})
