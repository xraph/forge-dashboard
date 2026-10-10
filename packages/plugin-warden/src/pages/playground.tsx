import { IconButton } from "@forge-go/dashboard-kit/components/icon-button"
import { useId, useState, type FormEvent } from "react"
import { PluginLink, queryStore, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import {
  NativeSelect,
  NativeSelectOption,
} from "@forge-go/dashboard-kit/components/native-select"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import {
  CommandAlert,
  QueryBoundary,
} from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { Textarea } from "@forge-go/dashboard-kit/components/textarea"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import {
  CHECK_SUBJECT_KINDS,
  decisionVariant,
  formatEvalTime,
  type CheckDetail,
} from "../components/check-log"
import type { ConfigDetail } from "./config"
import type { NamespacesResponse } from "../components/namespace-filter"
import { subjectPath } from "../components/subject-link"
import {
  LaneRow,
  decidingLane,
  decidingLaneOnlyGaveReason,
  verdictSentence,
  type PlaygroundInput,
  type PlaygroundResult,
} from "../components/playground-lanes"

/** What a dry run is, under the builder and again under the batch. */
const DRY_RUN_NOTE =
  "The check you build runs as a dry run: it writes nothing to the check log, fires no hooks, and neither reads nor fills the result cache. Your own permission to run it is checked, and warden logs that check like any other."

const NOT_JSON = "This is not valid JSON."
const NOT_OBJECT = "This must be a JSON object."
/** How the select shows a logged check whose subject kind is empty. */
const NO_KIND = "(no kind)"

/** The three JSON fields, in the order the disclosure lists them. */
const JSON_FIELDS = [
  { key: "subjectAttributes", label: "Subject attributes" },
  { key: "resourceAttributes", label: "Resource attributes" },
  { key: "context", label: "Context" },
] as const

type JsonKey = (typeof JSON_FIELDS)[number]["key"]

/** Everything the builder holds, as typed. Nothing is parsed until Run. */
interface Draft {
  subjectKind: string
  subjectId: string
  action: string
  resourceType: string
  resourceId: string
  namespacePath: string
  subjectAttributes: string
  resourceAttributes: string
  context: string
}

const EMPTY_DRAFT: Draft = {
  subjectKind: CHECK_SUBJECT_KINDS[0],
  subjectId: "",
  action: "",
  resourceType: "",
  resourceId: "",
  namespacePath: "",
  subjectAttributes: "",
  resourceAttributes: "",
  context: "",
}

type Bag =
  | { absent: true }
  | { absent?: false; value: Record<string, unknown> }
  | { error: string }

/** A JSON field's text: absent when blank, else an object or the reason it is not one. */
function parseBag(text: string): Bag {
  // Whitespace only is blank. Anything else is parsed as typed: JSON.parse
  // already ignores the whitespace around a document.
  if (text.trim() === "") return { absent: true }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return { error: NOT_JSON }
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { error: NOT_OBJECT }
  }
  return { value: value as Record<string, unknown> }
}

/**
 * The request the draft describes, or the message for each JSON field that
 * cannot be sent.
 *
 * Ids and names go exactly as typed: a check answers for the string it was
 * given, so trimming one would answer a different question. An optional
 * field nobody filled in is ABSENT from the request, not empty: the server
 * reads "" as a value. `namespacePath` is the one field that is always sent,
 * because a playground check runs at a namespace and "" is the tenant root.
 * The namespace input shows the root as "/", so that is accepted as the root
 * too. A JSON field holding only whitespace counts as blank, since a stray
 * newline is not a document.
 */
function buildInput(
  draft: Draft
): { input: PlaygroundInput } | { errors: Partial<Record<JsonKey, string>> } {
  const errors: Partial<Record<JsonKey, string>> = {}
  const bags: Partial<Record<JsonKey, Record<string, unknown>>> = {}
  for (const { key } of JSON_FIELDS) {
    const bag = parseBag(draft[key])
    if ("error" in bag) errors[key] = bag.error
    else if (!bag.absent) bags[key] = bag.value
  }
  if (Object.keys(errors).length > 0) return { errors }

  const { namespacePath, resourceId } = draft
  const input: PlaygroundInput = {
    subjectKind: draft.subjectKind,
    subjectId: draft.subjectId,
    action: draft.action,
    resourceType: draft.resourceType,
    ...(resourceId !== "" && { resourceId }),
    namespacePath: namespacePath === "/" ? "" : namespacePath,
    ...(bags.context && { context: bags.context }),
    ...(bags.subjectAttributes && {
      subjectAttributes: bags.subjectAttributes,
    }),
    ...(bags.resourceAttributes && {
      resourceAttributes: bags.resourceAttributes,
    }),
  }
  return { input }
}

/** One check of a batch, as the wire carries it. The resource id is absent when there is none. */
interface BatchItem {
  subjectKind: string
  subjectId: string
  action: string
  resourceType: string
  resourceId?: string
}

/** A batch line that parsed, with its 1-based place in the text. */
interface BatchLine {
  n: number
  text: string
  item: BatchItem
}

/** Mirrors the Go `PlaygroundBatchResult`. */
interface BatchResult {
  decision: string
  allowed: boolean
  reason?: string
  error?: string
}

interface BatchResponse {
  results: BatchResult[]
}

/** What the server was last asked: the lines, and where they ran. */
interface BatchRun {
  namespacePath: string
  lines: BatchLine[]
}

/**
 * One line, `kind:id action type[:id]`, or null when it is not one. The
 * subject splits on its first colon and so does the resource, so an id may
 * hold colons. The kind may be empty (`:alice`), because the check log can
 * hold a check with no kind; the id may not, and neither may the action or
 * the resource type. A resource type alone means no resource id.
 */
function parseBatchLine(text: string): BatchItem | null {
  const parts = text.split(/\s+/)
  if (parts.length !== 3) return null
  const [subject, action, resource] = parts as [string, string, string]
  const colon = subject.indexOf(":")
  if (colon < 0 || colon === subject.length - 1) return null
  const at = resource.indexOf(":")
  const resourceType = at < 0 ? resource : resource.slice(0, at)
  const resourceId = at < 0 ? "" : resource.slice(at + 1)
  if (resourceType === "") return null
  return {
    subjectKind: subject.slice(0, colon),
    subjectId: subject.slice(colon + 1),
    action,
    resourceType,
    ...(resourceId !== "" && { resourceId }),
  }
}

/**
 * The batch's lines, or the number of the first one that does not parse.
 * Blank lines are skipped and still counted, so "Line 3" is the third line
 * of the text as the operator sees it.
 */
function parseBatch(text: string): { lines: BatchLine[] } | { bad: number } {
  const lines: BatchLine[] = []
  const raw = text.split(/\r?\n/)
  for (let i = 0; i < raw.length; i++) {
    const line = raw[i]!.trim()
    if (line === "") continue
    const item = parseBatchLine(line)
    if (item === null) return { bad: i + 1 }
    lines.push({ n: i + 1, text: line, item })
  }
  return { lines }
}

type BatchRow = BatchLine & { result?: BatchResult }

/**
 * Several dry-run checks at the builder's namespace.
 *
 * Parsing and the size check happen here, before anything is sent, so a line
 * the server would refuse by its position is named by its line instead. The
 * size check uses the deployment's configured limit only when that is a
 * number above zero: on the server 0 means its default, which this page does
 * not know, and an unreadable config says nothing. In both cases the batch is
 * sent and the server's own refusal is shown.
 */
function BatchSection({
  namespacePath,
  onOpen,
}: {
  namespacePath: string
  onOpen: (item: BatchItem) => void
}) {
  const id = useId()
  const [text, setText] = useState("")
  const [problem, setProblem] = useState<string | null>(null)
  const [run, setRun] = useState<BatchRun | null>(null)

  const config = useQuery<ConfigDetail>("config.detail")
  const query = useQuery<BatchResponse>(
    "playground.batchCheck",
    run
      ? {
          namespacePath: run.namespacePath,
          items: run.lines.map((l) => l.item),
        }
      : {},
    { enabled: run !== null }
  )
  // While a run is in flight the previous refusal is not this run's.
  const refusal = query.loading ? undefined : query.error

  function submit(event: FormEvent) {
    event.preventDefault()
    const parsed = parseBatch(text)
    // A local refusal is the only answer on screen: the previous run's
    // results, or its server refusal, are cleared with it.
    if ("bad" in parsed) {
      setProblem(`Line ${parsed.bad} is not kind:id action type[:id].`)
      setRun(null)
      return
    }
    const cap = config.data?.maxBatchChecks
    if (cap !== undefined && cap > 0 && parsed.lines.length > cap) {
      setProblem(`A batch holds at most ${cap} checks.`)
      setRun(null)
      return
    }
    setProblem(null)
    const next: BatchRun = {
      namespacePath: namespacePath === "/" ? "" : namespacePath,
      lines: parsed.lines,
    }
    // Every press reaches the server: the same key is refetched by hand,
    // because the store would read it as the request it already made.
    const key = (r: BatchRun | null) =>
      queryStore.keyOf(
        "warden",
        "playground.batchCheck",
        r
          ? {
              namespacePath: r.namespacePath,
              items: r.lines.map((l) => l.item),
            }
          : {}
      )
    const sameKey = run !== null && key(run) === key(next)
    setRun(next)
    if (sameKey) query.refetch()
  }

  // The results answer the lines and namespace that were sent. Parsed items
  // are compared, not the text, so a whitespace-only edit is not a change. A
  // text that no longer parses is a change.
  const current = parseBatch(text)
  const stale =
    run !== null &&
    (run.namespacePath !== (namespacePath === "/" ? "" : namespacePath) ||
      "bad" in current ||
      JSON.stringify(current.lines.map((l) => l.item)) !==
        JSON.stringify(run.lines.map((l) => l.item)))

  const columns: Column<BatchRow>[] = [
    { id: "line", header: "Line", cell: (r) => String(r.n) },
    {
      id: "check",
      header: "Check",
      cell: (r) => <span className="font-mono text-xs">{r.text}</span>,
    },
    {
      id: "decision",
      header: "Decision",
      cell: (r) =>
        r.result ? (
          <Badge variant={decisionVariant(r.result.decision)}>
            {r.result.decision}
          </Badge>
        ) : (
          <NoneCell label="decision" />
        ),
    },
    {
      id: "detail",
      header: "Detail",
      // An error wins, as it does in the check log: it is the one state that
      // interrupts. A plain allow has neither, and says so.
      cell: (r) =>
        r.result?.error ? (
          <span className="text-destructive">{r.result.error}</span>
        ) : r.result?.reason ? (
          <span className="text-muted-foreground">{r.result.reason}</span>
        ) : (
          <NoneCell label="detail" />
        ),
    },
  ]

  return (
    <details className="flex min-w-0 flex-col gap-3">
      <summary className="cursor-pointer text-sm font-medium">
        Run a batch
      </summary>
      <form className="mt-3 flex min-w-0 flex-col gap-3" onSubmit={submit}>
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor={`${id}-lines`}>Checks, one per line</Label>
          <Textarea
            id={`${id}-lines`}
            className="font-mono text-xs"
            spellCheck={false}
            placeholder="user:alice read document:readme"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Each line is kind:id action type[:id]. Every line runs at the
            namespace above.
          </p>
        </div>
        {problem && (
          <p role="alert" className="text-sm text-destructive">
            {problem}
          </p>
        )}
        <CommandAlert error={refusal} title="Could not run the batch." />
        <div>
          <Button type="submit" disabled={text.trim() === "" || query.loading}>
            Run batch
          </Button>
        </div>
      </form>

      {run !== null && !refusal && (
        <QueryBoundary title="Batch result" query={query} skeletonRows={3}>
          {(data) => {
            const results = data.results ?? []
            const rows: BatchRow[] = run.lines.map((line, i) => ({
              ...line,
              result: results[i],
            }))
            return (
              <div className="flex min-w-0 flex-col gap-3">
                {stale && (
                  <p className="text-sm text-muted-foreground">
                    The lines or namespace have changed since this run. Run the
                    batch again to check them.
                  </p>
                )}
                <ResourceTable<BatchRow>
                  columns={columns}
                  rows={rows}
                  rowKey={(r) => String(r.n)}
                  caption={`${rows.length} ${rows.length === 1 ? "check" : "checks"}`}
                  emptyMessage="The batch returned no results."
                  rowActions={(r) => (
                    <IconButton
                      type="button"
                      variant="outline"
                      onClick={() => onOpen(r.item)}
                      label={`Open in builder, line ${r.n}`}
                    />
                  )}
                />
              </div>
            )
          }}
        </QueryBoundary>
      )}

      <p className="text-xs text-muted-foreground">{DRY_RUN_NOTE}</p>
    </details>
  )
}

function ResultView({
  result,
  stale,
  input,
}: {
  result: PlaygroundResult
  stale: boolean
  input: PlaygroundInput
}) {
  const failed = result.decision === "error"
  const deciding = decidingLane(result)
  const obligations = result.obligations ?? []
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {stale && (
        <p className="text-sm text-muted-foreground">
          The form has changed since this run. Run it again to check the new
          input.
        </p>
      )}
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant={decisionVariant(result.decision)}>
            {result.decision}
          </Badge>
          {failed
            ? result.error && (
                <span className="text-destructive">{result.error}</span>
              )
            : result.reason && (
                <span className="text-muted-foreground">{result.reason}</span>
              )}
        </div>
        {/*
          A failed check returned no decision, and its time is the handler's
          wall time, not an evaluation of anything, so it is not shown.
        */}
        {!failed && (
          <p className="text-xs text-muted-foreground">
            {`evaluated in ${formatEvalTime(result.evalTimeNs)}`}
          </p>
        )}
      </div>

      <ol aria-label="Models" className="flex min-w-0 flex-col gap-2">
        {(result.lanes ?? []).map((lane) => (
          <LaneRow
            key={lane.model}
            lane={lane}
            deciding={lane.model === deciding}
            reasonOnly={decidingLaneOnlyGaveReason(result)}
            input={input}
          />
        ))}
      </ol>

      <p className="text-sm">{verdictSentence(result)}</p>

      {obligations.length > 0 && (
        <p className="flex flex-wrap items-center gap-1.5 text-sm">
          <span>would emit</span>
          {obligations.map((o, i) => (
            <Badge
              key={`${i}-${o}`}
              variant="outline"
              className="font-mono text-xs"
            >
              {o}
            </Badge>
          ))}
        </p>
      )}
    </div>
  )
}

/**
 * The playground at `/playground` and at `/playground/check/:checkId`.
 *
 * Keyed by the check id, so moving from one check's playground to another's
 * starts a fresh form instead of carrying the last one's edits across.
 */
export function WardenPlaygroundPage({ params }: PluginPageProps) {
  const checkId = params?.checkId
  return <Playground key={checkId ?? ""} checkId={checkId} />
}

function Playground({ checkId }: { checkId: string | undefined }) {
  const ids = useId()
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  // The fields the operator has typed in. A prefill never overwrites these.
  const [touched, setTouched] = useState<ReadonlySet<keyof Draft>>(
    () => new Set()
  )
  // Whether the check's fields have been applied, once, and the time of the
  // check when any field took one.
  const [prefilled, setPrefilled] = useState(false)
  const [prefilledAt, setPrefilledAt] = useState<string | null>(null)
  // A logged check can carry a subject kind outside the four the select
  // offers (the REST API logs "", and Go callers pass anything). The
  // engine evaluates any kind, so the select offers that one too.
  const [extraKind, setExtraKind] = useState<string | null>(null)
  const [jsonErrors, setJsonErrors] = useState<
    Partial<Record<JsonKey, string>>
  >({})
  const [attributesOpen, setAttributesOpen] = useState(false)
  // What was last sent. `null` until the first Run, and the query below waits
  // for it: reading is free, but a check is a request the operator chose to
  // make, not something to fire because the page rendered.
  const [submitted, setSubmitted] = useState<PlaygroundInput | null>(null)
  // The form as it was when that was sent, so the page can tell when what is
  // on screen no longer answers what is in the form.
  const [submittedDraft, setSubmittedDraft] = useState<Draft | null>(null)

  // The check the route names, read only when it names one. It fills the
  // form and nothing more: a check is run only when the operator presses Run.
  const detail = useQuery<CheckDetail>(
    "checkLogs.detail",
    checkId ? { id: checkId } : {},
    {
      enabled: checkId !== undefined,
    }
  )
  // Applied once, when the detail settles, and never again: an operator who
  // has started editing must not have the form pulled back under them. A
  // cached copy still being refreshed is not the answer yet.
  if (checkId !== undefined && !prefilled && !detail.loading && detail.data) {
    const check = detail.data
    const fields: Partial<Draft> = {
      subjectKind: check.subjectKind,
      subjectId: check.subjectId,
      action: check.action,
      resourceType: check.resourceType,
      resourceId: check.resourceId,
      // The builder shows the tenant root as "/".
      namespacePath: check.namespacePath === "" ? "/" : check.namespacePath,
    }
    const patch: Partial<Draft> = {}
    for (const key of Object.keys(fields) as (keyof Draft)[]) {
      if (!touched.has(key)) Object.assign(patch, { [key]: fields[key] })
    }
    setPrefilled(true)
    setDraft((d) => ({ ...d, ...patch }))
    if (
      "subjectKind" in patch &&
      !(CHECK_SUBJECT_KINDS as readonly string[]).includes(check.subjectKind)
    ) {
      setExtraKind(check.subjectKind)
    }
    if (Object.keys(patch).length > 0) setPrefilledAt(check.createdAt)
  }

  const namespaces = useQuery<NamespacesResponse>("namespaces.list")
  // The list is a convenience. When it fails the input still takes any path,
  // and the root, which always exists, is still offered.
  const suggestions = namespaces.data?.namespaces ?? [""]

  const query = useQuery<PlaygroundResult>(
    "playground.explain",
    submitted ? { ...submitted } : {},
    { enabled: submitted !== null }
  )
  // While a run is in flight the previous refusal is not this run's, so it
  // is not shown.
  const refusal = query.loading ? undefined : query.error

  // Only an empty string is unfilled. A space is an id.
  const canRun =
    draft.subjectId !== "" && draft.action !== "" && draft.resourceType !== ""

  // Draft's keys are always in the same order, so comparing them as text is
  // a comparison of the fields. A run whose JSON did not validate was never
  // submitted, so the form differs from it and the note shows then too.
  const stale =
    submittedDraft !== null &&
    JSON.stringify(draft) !== JSON.stringify(submittedDraft)

  function edit(patch: Partial<Draft>) {
    setDraft((d) => ({ ...d, ...patch }))
    setTouched(
      (t) => new Set([...t, ...(Object.keys(patch) as (keyof Draft)[])])
    )
  }

  /**
   * Fills the subject, action and resource from a batch line. It goes through
   * `edit`, so the fields count as typed in and a check prefill that arrives
   * later does not overwrite them. The namespace and the JSON fields stay.
   */
  function openInBuilder(item: BatchItem) {
    edit({
      subjectKind: item.subjectKind,
      subjectId: item.subjectId,
      action: item.action,
      resourceType: item.resourceType,
      resourceId: item.resourceId ?? "",
    })
    // The select offers four kinds. The engine takes any, and so does a line.
    if (
      !(CHECK_SUBJECT_KINDS as readonly string[]).includes(item.subjectKind)
    ) {
      setExtraKind(item.subjectKind)
    }
  }

  function editJson(key: JsonKey, value: string) {
    edit({ [key]: value })
    setJsonErrors((e) => {
      if (!(key in e)) return e
      const next = { ...e }
      delete next[key]
      return next
    })
  }

  function run(event: FormEvent) {
    event.preventDefault()
    if (!canRun) return
    const built = buildInput(draft)
    if ("errors" in built) {
      setJsonErrors(built.errors)
      // The message is under a field inside the disclosure, so it has to be
      // open for the operator to see it.
      setAttributesOpen(true)
      return
    }
    setJsonErrors({})
    // Every press of Run reaches the server. A new key is read by the query
    // once `submitted` changes. The same key is not: the store would treat it
    // as the read it already made, so it is refetched by hand. The key is the
    // store's own, which sorts object keys, so a JSON field with its keys
    // reordered is the same key and is refetched rather than skipped.
    const key = (input: PlaygroundInput | null) =>
      queryStore.keyOf(
        "warden",
        "playground.explain",
        input ? { ...input } : {}
      )
    const sameKey = submitted !== null && key(submitted) === key(built.input)
    setSubmitted(built.input)
    setSubmittedDraft(draft)
    if (sameKey) query.refetch()
  }

  const listId = `${ids}-namespaces`

  return (
    <section className="flex min-w-0 flex-col gap-4">
      <PageHeader title="Playground" />

      {/* Not found leaves the empty builder below it usable. */}
      {checkId !== undefined && !detail.loading && detail.error && (
        <QueryBoundary title="Check" query={detail}>
          {() => null}
        </QueryBoundary>
      )}

      {prefilledAt !== null && (
        <p className="text-sm text-muted-foreground">
          Prefilled from a check logged at{" "}
          <Timestamp value={prefilledAt} label="checked at" />. The check log
          does not record context or attributes, so add any the original check
          carried.
        </p>
      )}

      <div className="grid min-w-0 gap-4 md:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
        <form className="flex min-w-0 flex-col gap-3" onSubmit={run}>
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor={`${ids}-subject-kind`}>Subject kind</Label>
            <NativeSelect
              id={`${ids}-subject-kind`}
              value={draft.subjectKind}
              onChange={(e) => edit({ subjectKind: e.target.value })}
            >
              {CHECK_SUBJECT_KINDS.map((kind) => (
                <NativeSelectOption key={kind} value={kind}>
                  {kind}
                </NativeSelectOption>
              ))}
              {extraKind !== null && (
                <NativeSelectOption value={extraKind}>
                  {extraKind === "" ? NO_KIND : extraKind}
                </NativeSelectOption>
              )}
            </NativeSelect>
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor={`${ids}-subject-id`}>Subject id</Label>
            <Input
              id={`${ids}-subject-id`}
              className="font-mono text-xs"
              aria-required
              value={draft.subjectId}
              onChange={(e) => edit({ subjectId: e.target.value })}
            />
            {/* A subject with no kind has no page: the route cannot carry one. */}
            {draft.subjectKind !== "" && draft.subjectId !== "" && (
              <PluginLink
                to={subjectPath(draft.subjectKind, draft.subjectId)}
                className="text-sm underline underline-offset-4"
              >
                View this subject
              </PluginLink>
            )}
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor={`${ids}-action`}>Action</Label>
            <Input
              id={`${ids}-action`}
              className="font-mono text-xs"
              aria-required
              value={draft.action}
              onChange={(e) => edit({ action: e.target.value })}
            />
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor={`${ids}-resource-type`}>Resource type</Label>
            <Input
              id={`${ids}-resource-type`}
              className="font-mono text-xs"
              aria-required
              value={draft.resourceType}
              onChange={(e) => edit({ resourceType: e.target.value })}
            />
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor={`${ids}-resource-id`}>Resource id</Label>
            <Input
              id={`${ids}-resource-id`}
              className="font-mono text-xs"
              value={draft.resourceId}
              onChange={(e) => edit({ resourceId: e.target.value })}
            />
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor={`${ids}-namespace`}>Namespace</Label>
            <Input
              id={`${ids}-namespace`}
              className="font-mono text-xs"
              list={listId}
              placeholder="/"
              value={draft.namespacePath}
              onChange={(e) => edit({ namespacePath: e.target.value })}
            />
            <datalist id={listId}>
              {suggestions.map((ns) => (
                <option key={ns} value={ns === "" ? "/" : ns} />
              ))}
            </datalist>
          </div>

          <details
            open={attributesOpen}
            onToggle={(e) => setAttributesOpen(e.currentTarget.open)}
            className="flex min-w-0 flex-col gap-3"
          >
            <summary className="cursor-pointer text-sm font-medium">
              attributes and context
            </summary>
            <div className="mt-3 flex min-w-0 flex-col gap-3">
              {JSON_FIELDS.map(({ key, label }) => {
                const message = jsonErrors[key]
                const fieldId = `${ids}-${key}`
                return (
                  <div key={key} className="flex min-w-0 flex-col gap-1.5">
                    <Label htmlFor={fieldId}>{label}</Label>
                    <Textarea
                      id={fieldId}
                      className="font-mono text-xs"
                      spellCheck={false}
                      value={draft[key]}
                      aria-invalid={message ? true : undefined}
                      aria-describedby={
                        message ? `${fieldId}-error` : undefined
                      }
                      onChange={(e) => editJson(key, e.target.value)}
                    />
                    {message && (
                      <p
                        id={`${fieldId}-error`}
                        className="text-xs text-destructive"
                      >
                        {message}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          </details>

          <CommandAlert error={refusal} title="Could not run the check." />

          <div>
            <Button type="submit" disabled={!canRun || query.loading}>
              Run
            </Button>
          </div>
        </form>

        <div>
          {submitted === null || refusal ? (
            <p className="text-sm text-muted-foreground">
              Run a check to see its verdict and what each model did.
            </p>
          ) : (
            <QueryBoundary title="Result" query={query} skeletonRows={4}>
              {(result) => (
                <ResultView result={result} stale={stale} input={submitted} />
              )}
            </QueryBoundary>
          )}
        </div>
      </div>

      <BatchSection
        namespacePath={draft.namespacePath}
        onOpen={openInBuilder}
      />

      <p className="text-xs text-muted-foreground">{DRY_RUN_NOTE}</p>
    </section>
  )
}
