import { useCallback, useEffect, useRef, useState } from "react"
import { usePluginClient } from "@forge-go/dashboard-plugin"
import type { ContractError } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Checkbox } from "@forge-go/dashboard-kit/components/checkbox"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import {
  CommandAlert,
  QueryBoundary,
} from "@forge-go/dashboard-kit/components/query-boundary"
import { Switch } from "@forge-go/dashboard-kit/components/switch"
import SchemaEditor from "../components/schema-editor"
import type { SchemaDiagnostic } from "../components/schema-editor"

/** The schema.export reply: the tenant's model as Warden source. */
export interface SchemaExport {
  source: string
}

/**
 * The schema.plan reply. `valid` is false exactly when `diagnostics` is not
 * empty, and then the lists are empty and `digest` is "". Each list line
 * arrives written, as `+ role//editor`, `~ role//viewer (grants)` or
 * `- policy//old`: it is shown as given.
 */
export interface SchemaPlan {
  valid: boolean
  diagnostics: SchemaDiagnostic[]
  created: string[]
  updated: string[]
  deleted: string[]
  noOps: number
  digest: string
}

/** The schema.apply reply: what was written, in the plan's line form. */
export interface SchemaApplyResult {
  created: string[]
  updated: string[]
  deleted: string[]
  noOps: number
  /** What was written differs from the plan the digest vouched for. */
  diverged: boolean
}

/** A plan, and the exact text and prune value it was made for. */
interface Planned {
  source: string
  prune: boolean
  plan: SchemaPlan
}

const NO_DIAGNOSTICS: SchemaDiagnostic[] = []
const SHOWN_DELETIONS = 5
const HALF_APPLY = "the apply stopped part way"
// The tail of warden's cap refusal (assignment.CapBelowMembersError), which a
// half apply wraps as "update role <slug>: <refusal>".
const CAP_REFUSAL = /has \d+ members, so its cap cannot be lowered to \d+$/

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

function changesOf(plan: SchemaPlan): number {
  return plan.created.length + plan.updated.length + plan.deleted.length
}

/**
 * The refusal for a digest that no longer matches what apply plans now.
 * schema.apply has a second CONFLICT, without this reason: its own dry run
 * refuses a member cap lowered below the role's live members, which is a
 * membership change, not a schema change, and planning again does not clear.
 */
function schemaChanged(error: ContractError): boolean {
  return error.code === "CONFLICT" && error.details?.reason === "schema_changed"
}

/** What the confirmation says when the apply was refused, inside the dialog. */
function refusal(error: ContractError): string {
  if (schemaChanged(error)) {
    return "The schema changed since you planned. Plan again to see the current diff."
  }
  if (error.code === "INTERNAL" && error.message.startsWith(HALF_APPLY)) {
    // Warden's message starts with the phrase the sentence already says, so
    // only what follows it is interpolated.
    const rest = error.message
      .slice(HALF_APPLY.length)
      .replace(/^:\s*/, "")
      .replace(/\.+$/, "")
    const stopped = rest === "" ? "The apply stopped part way" : `The apply stopped with an error: ${rest}`
    // A member arrived after apply's own dry run passed, and the write pass
    // refused the cap. A plan runs that same check, so planning again would
    // only show the refusal, not what remains.
    if (CAP_REFUSAL.test(rest)) {
      return `${stopped}. Changes written before the error are kept. A plan runs the same cap check, so remove members from the role or raise the cap in the source before you plan again.`
    }
    return `${stopped}. Changes written before the error are kept; plan again to see what remains.`
  }
  return error.message
}

/**
 * A refusal after which the same plan would only be refused again: the store
 * moved on (`CONFLICT` with reason "schema_changed"), the apply stopped part
 * way, or the server rejected the source it was sent (`BAD_REQUEST`).
 *
 * Any other `CONFLICT`, the member cap among them, keeps the plan. A cap
 * refusal says nothing about the digest: apply's dry run refuses before the
 * digest is compared. The server checks the digest on every apply, so a kept
 * plan can never write a diff that was not shown. If the schema also changed,
 * the first apply that gets past the cap is refused as "schema_changed" and
 * spends the plan then.
 */
function spendsPlan(error: ContractError): boolean {
  return (
    schemaChanged(error) ||
    error.code === "BAD_REQUEST" ||
    (error.code === "INTERNAL" && error.message.startsWith(HALF_APPLY))
  )
}

/** What a diverged apply says after "what was written differs". */
function divergedSentence(applied: SchemaApplyResult): string {
  const written = applied.created.length + applied.updated.length + applied.deleted.length
  return `The store changed while this apply ran, so what was written differs from the plan. ${written > 0 ? "The lines above are what was written." : "Nothing was written."}`
}

const DELETES_ROLE = /^- role\//
const DELETES_PERMISSION = /^- permission\//

function Lines({ lines }: { lines: string[] }) {
  return (
    <ul className="flex flex-col gap-0.5">
      {lines.map((line, i) => (
        <li key={`${i}:${line}`} className="font-mono text-xs break-all">
          {line}
        </li>
      ))}
    </ul>
  )
}

function PlanSection({ title, lines }: { title: string; lines: string[] }) {
  if (lines.length === 0) return null
  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="text-sm font-medium">
        {title} <span className="tabular-nums text-muted-foreground">{lines.length}</span>
      </h3>
      <Lines lines={lines} />
    </div>
  )
}

/**
 * The tenant's authorization model as Warden source, in an editor: change it,
 * plan the change, and apply it.
 *
 * Planning sends the editor's text and the prune value and writes nothing. The
 * server answers with diagnostics, marked in the editor and listed below it,
 * or with a diff and a digest of that exact text and prune value. Apply is
 * enabled only for a valid, non-empty plan made for the text and prune value
 * now on screen, and it sends the digest back: the server applies the diff
 * that was shown or nothing.
 *
 * The export of a tenant that holds legacy entities may not parse. It loads
 * into the editor regardless, and planning it shows why.
 */
export function WardenSchemaPage() {
  const client = usePluginClient()

  // The text in the editor, and the text the editor was last loaded with, so
  // "unsaved edits" is a comparison and not a flag an undo could leave set.
  const [text, setText] = useState("")
  const [baseline, setBaseline] = useState<string | null>(null)
  // A new key mounts a new editor: that is how the editor is started over.
  const [editorKey, setEditorKey] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<ContractError | undefined>(undefined)
  const [confirmingLoad, setConfirmingLoad] = useState(false)

  const [prune, setPrune] = useState(false)
  const [planning, setPlanning] = useState(false)
  const [planned, setPlanned] = useState<Planned | null>(null)
  const [planError, setPlanError] = useState<ContractError | undefined>(undefined)

  const [confirming, setConfirming] = useState<Planned | null>(null)
  const [readDeletions, setReadDeletions] = useState(false)
  const [applying, setApplying] = useState(false)
  const [applyError, setApplyError] = useState<ContractError | undefined>(undefined)
  const [applied, setApplied] = useState<SchemaApplyResult | null>(null)

  // Only the latest load and the latest plan may land: a slower, older one
  // settling after a newer one must not overwrite it.
  const loadGeneration = useRef(0)
  const planGeneration = useRef(0)

  // What a settled schema.export does, if it is still the latest one asked.
  const landExport = useCallback((generation: number, source: string) => {
    if (generation !== loadGeneration.current) return
    setText(source)
    setBaseline(source)
    setEditorKey((k) => k + 1)
    // A plan was for the text that is gone.
    setPlanned(null)
    setPlanError(undefined)
    setLoading(false)
  }, [])
  const failExport = useCallback((generation: number, error: unknown) => {
    if (generation !== loadGeneration.current) return
    setLoadError(error as ContractError)
    setLoading(false)
  }, [])

  const load = useCallback(() => {
    const generation = ++loadGeneration.current
    setLoading(true)
    setLoadError(undefined)
    return client.query<SchemaExport>("schema.export").then(
      (reply) => landExport(generation, reply.source),
      (error) => failExport(generation, error)
    )
  }, [client, landExport, failExport])

  // The first load. The page starts out loading, so nothing is set before the
  // request is sent.
  useEffect(() => {
    const generation = ++loadGeneration.current
    void client.query<SchemaExport>("schema.export").then(
      (reply) => landExport(generation, reply.source),
      (error) => failExport(generation, error)
    )
    return () => {
      loadGeneration.current += 1
      planGeneration.current += 1
    }
  }, [client, landExport, failExport])

  async function runPlan() {
    const source = text
    const pruning = prune
    const generation = ++planGeneration.current
    setPlanning(true)
    setPlanError(undefined)
    setPlanned(null)
    setApplied(null)
    try {
      const plan = await client.query<SchemaPlan>("schema.plan", { source, prune: pruning })
      if (generation !== planGeneration.current) return
      setPlanned({ source, prune: pruning, plan })
    } catch (error) {
      if (generation !== planGeneration.current) return
      setPlanError(error as ContractError)
    } finally {
      if (generation === planGeneration.current) setPlanning(false)
    }
  }

  // A manual load drops the last apply's result: it describes a schema the
  // editor no longer shows. The reload after an apply calls `load` itself and
  // keeps it.
  function loadFresh() {
    setApplied(null)
    void load()
  }

  function askToLoad() {
    if (text === baseline) loadFresh()
    else setConfirmingLoad(true)
  }

  function openApply() {
    if (!planned) return
    setApplyError(undefined)
    setReadDeletions(false)
    setConfirming(planned)
  }

  async function confirmApply() {
    if (!confirming) return
    setApplying(true)
    setApplyError(undefined)
    try {
      const result = await client.command<SchemaApplyResult>("schema.apply", {
        source: confirming.source,
        prune: confirming.prune,
        digest: confirming.plan.digest,
      })
      setApplied(result)
      setConfirming(null)
      // The plan is spent, and the editor shows what the store now holds.
      setPlanned(null)
      setApplying(false)
      await load()
    } catch (error) {
      const refused = error as ContractError
      setApplyError(refused)
      if (spendsPlan(refused)) setPlanned(null)
      setApplying(false)
    }
  }

  const current = planned !== null && planned.source === text && planned.prune === prune
  const canApply =
    current && planned.plan.valid && changesOf(planned.plan) > 0 && planned.plan.digest !== ""
  const diagnostics = planned && !planned.plan.valid ? planned.plan.diagnostics : NO_DIAGNOSTICS
  const busy = loading || planning || applying

  const deletions =
    confirming !== null && confirming.prune && confirming.plan.deleted.length > 0
      ? confirming.plan.deleted
      : null

  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title="Schema"
        description="Your tenant's roles, permissions, policies, resource types and relations, as Warden source."
        actions={
          <Button variant="outline" onClick={askToLoad} disabled={busy}>
            Load current schema
          </Button>
        }
      />

      <QueryBoundary
        title="Schema"
        query={{
          data: baseline ?? undefined,
          error: baseline === null ? loadError : undefined,
          loading: loading && baseline === null,
          refetch: () => void load(),
        }}
      >
        {(loaded) => (
          <>
            <CommandAlert error={loadError} title="Could not load the current schema" />

            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <Label id="schema-prune-label">
                  Delete roles, permissions, policies and resource types this source does not declare
                </Label>
                <Switch
                  id="schema-prune"
                  aria-labelledby="schema-prune-label"
                  checked={prune}
                  onCheckedChange={setPrune}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Only namespaces this source names, including by an empty namespace block, are pruned.
              </p>
            </div>

            <SchemaEditor
              key={editorKey}
              label="Warden schema source"
              initial={loaded}
              onChange={setText}
              diagnostics={diagnostics}
            />

            <div>
              <Button onClick={() => void runPlan()} disabled={busy}>
                {planning ? "Planning…" : "Plan"}
              </Button>
            </div>

            <section aria-label="Plan result" className="flex flex-col gap-3">
              <CommandAlert error={planError} title="Could not plan the schema" />

              {planned === null ? (
                !planError && (
                  <p className="text-sm text-muted-foreground">
                    Plan the source to see what applying it would change.
                  </p>
                )
              ) : (
                <>
                  {!current && (
                    <p role="status" className="text-sm font-medium">
                      {planned.source !== text
                        ? "The source has changed since this plan. Plan again before applying."
                        : "The prune setting has changed since this plan. Plan again before applying."}
                    </p>
                  )}
                  {!planned.plan.valid ? (
                    <ul className="flex max-h-72 flex-col gap-1 overflow-auto text-sm text-destructive">
                      {planned.plan.diagnostics.map((d, i) => (
                        <li key={`${i}:${d.line}:${d.col}:${d.message}`}>
                          {`Line ${d.line}, column ${d.col}: ${d.message}`}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <>
                      {changesOf(planned.plan) === 0 && (
                        <p className="text-sm">Applying this changes nothing.</p>
                      )}
                      <PlanSection title="Will create" lines={planned.plan.created} />
                      <PlanSection title="Will change" lines={planned.plan.updated} />
                      <PlanSection title="Will delete" lines={planned.plan.deleted} />
                      <p className="text-sm text-muted-foreground tabular-nums">
                        {planned.plan.noOps} unchanged
                      </p>
                    </>
                  )}
                </>
              )}
              <div>
                <Button onClick={openApply} disabled={!canApply || busy}>
                  Apply
                </Button>
              </div>
            </section>

            {applied && (
              <section aria-label="Apply result" className="flex flex-col gap-2">
                <p role="status" className="text-sm font-medium">
                  {`Applied: ${applied.created.length} created, ${applied.updated.length} changed, ${applied.deleted.length} deleted.`}
                </p>
                <Lines lines={[...applied.created, ...applied.updated, ...applied.deleted]} />
                {applied.diverged && (
                  <p className="text-sm">{divergedSentence(applied)}</p>
                )}
              </section>
            )}
          </>
        )}
      </QueryBoundary>

      <ConfirmDialog
        open={confirmingLoad}
        onOpenChange={setConfirmingLoad}
        title="Replace your edits with the current schema?"
        confirmLabel="Replace"
        pending={loading}
        onConfirm={() => {
          setConfirmingLoad(false)
          loadFresh()
        }}
      />

      {/* The refusal lives inside the dialog. Base UI marks everything outside
          an open dialog inert and aria-hidden, so an alert on the page body is
          unreachable while the dialog that can fail is open. */}
      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open && !applying) setConfirming(null)
        }}
        title={
          confirming
            ? `Apply ${count(confirming.plan.created.length, "creation", "creations")}, ${count(confirming.plan.updated.length, "change", "changes")} and ${count(confirming.plan.deleted.length, "deletion", "deletions")} to your tenant?`
            : ""
        }
        confirmLabel="Apply changes"
        pending={applying}
        confirmDisabled={deletions !== null && !readDeletions}
        onConfirm={() => void confirmApply()}
        description={
          deletions !== null ? (
            <span className="text-destructive">
              {`This deletes ${count(deletions.length, "entity", "entities")} in the namespaces this source covers: ${deletions.slice(0, SHOWN_DELETIONS).join(", ")}${deletions.length > SHOWN_DELETIONS ? `, and ${deletions.length - SHOWN_DELETIONS} more` : ""}.${deletions.some((line) => DELETES_ROLE.test(line)) ? " Deleting a role also deletes its assignments and grants." : ""}${deletions.some((line) => DELETES_PERMISSION.test(line)) ? " Deleting a permission also revokes it from every role that holds it." : ""}`}
            </span>
          ) : undefined
        }
      >
        {/* Controls go in the body, not the description: the description is a
            <p> and the dialog's accessible description, read out as prose. */}
        {deletions !== null && (
          <span className="flex items-center gap-2">
            <Checkbox
              id="schema-read-deletions"
              checked={readDeletions}
              onCheckedChange={(checked) => setReadDeletions(checked === true)}
            />
            <Label htmlFor="schema-read-deletions">I have read the deletions</Label>
          </span>
        )}
        {applyError && (
          <span role="alert" className="text-destructive">
            {refusal(applyError)}
          </span>
        )}
      </ConfirmDialog>
    </section>
  )
}

export default WardenSchemaPage
