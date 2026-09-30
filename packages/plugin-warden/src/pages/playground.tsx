import { useId, useState, type FormEvent } from "react"
import { useQuery } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import {
  NativeSelect,
  NativeSelectOption,
} from "@forge-go/dashboard-kit/components/native-select"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { CommandAlert, QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { Textarea } from "@forge-go/dashboard-kit/components/textarea"
import { CHECK_SUBJECT_KINDS, decisionVariant, formatEvalTime } from "../components/check-log"
import type { NamespacesResponse } from "../components/namespace-filter"
import {
  LaneRow,
  decidingLane,
  verdictSentence,
  type PlaygroundInput,
  type PlaygroundResult,
} from "../components/playground-lanes"

const NOT_JSON = "This is not valid JSON."
const NOT_OBJECT = "This must be a JSON object."

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

type Bag = { absent: true } | { absent?: false; value: Record<string, unknown> } | { error: string }

/** A JSON field's text: absent when blank, else an object or the reason it is not one. */
function parseBag(text: string): Bag {
  const trimmed = text.trim()
  if (trimmed === "") return { absent: true }
  let value: unknown
  try {
    value = JSON.parse(trimmed)
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
 * An optional field nobody filled in is ABSENT from the request, not empty:
 * the server reads "" as a value. `namespacePath` is the one field that is
 * always sent, because a playground check runs at a namespace and "" is the
 * tenant root. The namespace input shows the root as "/", so that is
 * accepted as the root too.
 */
function buildInput(
  draft: Draft,
): { input: PlaygroundInput } | { errors: Partial<Record<JsonKey, string>> } {
  const errors: Partial<Record<JsonKey, string>> = {}
  const bags: Partial<Record<JsonKey, Record<string, unknown>>> = {}
  for (const { key } of JSON_FIELDS) {
    const bag = parseBag(draft[key])
    if ("error" in bag) errors[key] = bag.error
    else if (!bag.absent) bags[key] = bag.value
  }
  if (Object.keys(errors).length > 0) return { errors }

  const namespace = draft.namespacePath.trim()
  const resourceId = draft.resourceId.trim()
  const input: PlaygroundInput = {
    subjectKind: draft.subjectKind,
    subjectId: draft.subjectId.trim(),
    action: draft.action.trim(),
    resourceType: draft.resourceType.trim(),
    ...(resourceId !== "" && { resourceId }),
    namespacePath: namespace === "/" ? "" : namespace,
    ...(bags.context && { context: bags.context }),
    ...(bags.subjectAttributes && { subjectAttributes: bags.subjectAttributes }),
    ...(bags.resourceAttributes && { resourceAttributes: bags.resourceAttributes }),
  }
  return { input }
}

function ResultView({ result }: { result: PlaygroundResult }) {
  const failed = result.decision === "error"
  const deciding = decidingLane(result)
  const obligations = result.obligations ?? []
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant={decisionVariant(result.decision)}>{result.decision}</Badge>
          {failed ? (
            result.error && <span className="text-destructive">{result.error}</span>
          ) : (
            result.reason && <span className="text-muted-foreground">{result.reason}</span>
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

      <ol aria-label="Models" className="flex flex-col gap-2">
        {(result.lanes ?? []).map((lane) => (
          <LaneRow key={lane.model} lane={lane} deciding={lane.model === deciding} />
        ))}
      </ol>

      <p className="text-sm">{verdictSentence(result)}</p>

      {obligations.length > 0 && (
        <p className="flex flex-wrap items-center gap-1.5 text-sm">
          <span>would emit</span>
          {obligations.map((o, i) => (
            <Badge key={`${i}-${o}`} variant="outline" className="font-mono text-xs">
              {o}
            </Badge>
          ))}
        </p>
      )}
    </div>
  )
}

export function WardenPlaygroundPage() {
  const ids = useId()
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [jsonErrors, setJsonErrors] = useState<Partial<Record<JsonKey, string>>>({})
  const [attributesOpen, setAttributesOpen] = useState(false)
  // What was last sent. `null` until the first Run, and the query below waits
  // for it: reading is free, but a check is a request the operator chose to
  // make, not something to fire because the page rendered.
  const [submitted, setSubmitted] = useState<PlaygroundInput | null>(null)

  const namespaces = useQuery<NamespacesResponse>("namespaces.list")
  // The list is a convenience. When it fails the input still takes any path,
  // and the root, which always exists, is still offered.
  const suggestions = namespaces.data?.namespaces ?? [""]

  const query = useQuery<PlaygroundResult>(
    "playground.explain",
    submitted ? { ...submitted } : {},
    { enabled: submitted !== null },
  )
  // While a run is in flight the previous refusal is not this run's, so it
  // is not shown.
  const refusal = query.loading ? undefined : query.error

  const canRun =
    draft.subjectId.trim() !== "" && draft.action.trim() !== "" && draft.resourceType.trim() !== ""

  function edit(patch: Partial<Draft>) {
    setDraft((d) => ({ ...d, ...patch }))
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
    // The same input again is a new question with the same answer's key, so
    // it is refetched by hand: the store would otherwise treat it as the
    // read it already made.
    if (submitted !== null && JSON.stringify(submitted) === JSON.stringify(built.input)) {
      query.refetch()
    } else {
      setSubmitted(built.input)
    }
  }

  const listId = `${ids}-namespaces`

  return (
    <section className="flex flex-col gap-4">
      <PageHeader title="Playground" />

      <div className="grid gap-6 md:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
        <form className="flex flex-col gap-3" onSubmit={run}>
          <span className="flex flex-col gap-1.5">
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
            </NativeSelect>
          </span>
          <span className="flex flex-col gap-1.5">
            <Label htmlFor={`${ids}-subject-id`}>Subject id</Label>
            <Input
              id={`${ids}-subject-id`}
              className="font-mono text-xs"
              value={draft.subjectId}
              onChange={(e) => edit({ subjectId: e.target.value })}
            />
          </span>
          <span className="flex flex-col gap-1.5">
            <Label htmlFor={`${ids}-action`}>Action</Label>
            <Input
              id={`${ids}-action`}
              className="font-mono text-xs"
              value={draft.action}
              onChange={(e) => edit({ action: e.target.value })}
            />
          </span>
          <span className="flex flex-col gap-1.5">
            <Label htmlFor={`${ids}-resource-type`}>Resource type</Label>
            <Input
              id={`${ids}-resource-type`}
              className="font-mono text-xs"
              value={draft.resourceType}
              onChange={(e) => edit({ resourceType: e.target.value })}
            />
          </span>
          <span className="flex flex-col gap-1.5">
            <Label htmlFor={`${ids}-resource-id`}>Resource id</Label>
            <Input
              id={`${ids}-resource-id`}
              className="font-mono text-xs"
              value={draft.resourceId}
              onChange={(e) => edit({ resourceId: e.target.value })}
            />
          </span>
          <span className="flex flex-col gap-1.5">
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
          </span>

          <details
            open={attributesOpen}
            onToggle={(e) => setAttributesOpen(e.currentTarget.open)}
            className="flex flex-col gap-3"
          >
            <summary className="cursor-pointer text-sm font-medium">
              attributes and context
            </summary>
            <div className="mt-3 flex flex-col gap-3">
              {JSON_FIELDS.map(({ key, label }) => {
                const message = jsonErrors[key]
                const fieldId = `${ids}-${key}`
                return (
                  <span key={key} className="flex flex-col gap-1.5">
                    <Label htmlFor={fieldId}>{label}</Label>
                    <Textarea
                      id={fieldId}
                      className="font-mono text-xs"
                      spellCheck={false}
                      value={draft[key]}
                      aria-invalid={message ? true : undefined}
                      aria-describedby={message ? `${fieldId}-error` : undefined}
                      onChange={(e) => editJson(key, e.target.value)}
                    />
                    {message && (
                      <p id={`${fieldId}-error`} className="text-xs text-destructive">
                        {message}
                      </p>
                    )}
                  </span>
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
              {(result) => <ResultView result={result} />}
            </QueryBoundary>
          )}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Runs as a dry run: writes nothing to the check log, fires no hooks, and neither reads nor
        fills the result cache.
      </p>
    </section>
  )
}
