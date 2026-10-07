import { useEffect, useId, useRef, useState } from "react"
import type { FormEvent } from "react"
import { useCommand, useQuery } from "@forge-go/dashboard-plugin"
import type { CommandState } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@forge-go/dashboard-kit/components/dialog"
import {
  Field,
  FieldDescription,
  FieldGroup,
} from "@forge-go/dashboard-kit/components/field"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import {
  NativeSelect,
  NativeSelectOption,
} from "@forge-go/dashboard-kit/components/native-select"
import { Textarea } from "@forge-go/dashboard-kit/components/textarea"
import { plural, SCENARIO_TYPES, scenarioLabel } from "../format"
import type { Redaction, SentinelConfig, TestCase } from "../types"

// The server's words (handlers_cases.go). The create and update refusals for a
// missing name or input differ, and the form uses whichever its command would.
const CREATE_REQUIRED = "a case needs a name and an input"
const NAME_REQUIRED = "a case needs a name"
const INPUT_REQUIRED = "a case needs an input"
const SUBSTRING_REQUIRED = "a not_contains scorer needs a non-empty substring"
const CONTEXT_NOT_JSON = "The context is not valid JSON."
const CONTEXT_NOT_OBJECT = "The context must be a JSON object."

type Problem = "name" | "input" | "scenario" | "scorers" | "context"

function fieldFor(message: string | undefined): Problem | null {
  if (!message) return null
  if (message === NAME_REQUIRED) return "name"
  if (message === INPUT_REQUIRED) return "input"
  if (message === CREATE_REQUIRED) return "name"
  if (message.startsWith("unknown scenario type")) return "scenario"
  if (message === CONTEXT_NOT_JSON || message === CONTEXT_NOT_OBJECT || message.startsWith("invalid payload: context")) {
    return "context"
  }
  if (message.startsWith('scorer "') || message.startsWith("Scorer ") || message === SUBSTRING_REQUIRED) {
    return "scorers"
  }
  return null
}

/** One scorer row as the form holds it: its config as editable JSON text. */
interface ScorerRow {
  key: number
  name: string
  configText: string
  /** The value the server withheld for this row, if any. */
  redacted?: Redaction
}

// Row keys only need to be unique among the rows on screen; a module counter
// gives that without a ref read during render.
let rowSequence = 0
function nextKey(): number {
  rowSequence += 1
  return rowSequence
}

function rowsFrom(testCase: TestCase | undefined): ScorerRow[] {
  return (testCase?.scorers ?? []).map((sc) => ({
    key: nextKey(),
    name: sc.name,
    configText: Object.keys(sc.config).length === 0 ? "" : JSON.stringify(sc.config, null, 2),
    redacted: sc.redacted,
  }))
}

/** A scorer row's config, or the reason it cannot be sent. */
function parseConfig(text: string, position: number): { config: Record<string, unknown> } | { problem: string } {
  if (text.trim() === "") return { config: {} }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return { problem: `Scorer ${position}'s config is not valid JSON.` }
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { problem: `Scorer ${position}'s config must be a JSON object.` }
  }
  return { config: value as Record<string, unknown> }
}

/**
 * The context as the field shows it: pretty JSON without attack_type, which
 * no write can change (the server keeps the stored one), or empty for none.
 */
function contextText(testCase: TestCase | undefined): string {
  const rest = Object.fromEntries(Object.entries(testCase?.context ?? {}).filter(([k]) => k !== "attack_type"))
  return Object.keys(rest).length === 0 ? "" : JSON.stringify(rest, null, 2)
}

/** The context field as an object, or the reason it cannot be sent. */
function parseContext(text: string): { context: Record<string, unknown> } | { problem: string } {
  if (text.trim() === "") return { context: {} }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return { problem: CONTEXT_NOT_JSON }
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return { problem: CONTEXT_NOT_OBJECT }
  return { context: value as Record<string, unknown> }
}

/** "billing, churn" as the tags the server stores. */
function parseTags(text: string): string[] {
  return text
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
}

export interface CaseFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The suite a new case goes into. */
  suiteId: string
  /** The case being edited. Without one the dialog creates a case. */
  testCase?: TestCase
}

/**
 * Creates or edits a case: its name, input, expected output, scenario type,
 * tags, context and scorers. Both commands answer the saved case and invalidate the
 * case list (and the suite's counts), so pages refresh through
 * `meta.invalidates`.
 *
 * A red-team case's leakage check carries the system prompt as its substring,
 * and the server never sends it. Its scorer row says how long it is, and
 * sending the row without a substring keeps the stored one (the contract's
 * rule), so an operator can edit everything else about the case without ever
 * seeing the prompt it guards.
 */
export function CaseFormDialog({ open, onOpenChange, suiteId, testCase }: CaseFormDialogProps) {
  const command = useCommand<TestCase>(testCase ? "cases.update" : "cases.create")
  const { reset } = command
  useEffect(() => {
    if (open) reset()
  }, [open, reset])
  const locked = command.loading
  return (
    <Dialog
      open={open}
      onOpenChange={(next, details) => {
        if (!next && locked) {
          details.cancel()
          return
        }
        onOpenChange(next)
      }}
      disablePointerDismissal={locked}
    >
      <DialogContent showCloseButton={!locked} className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-2xl">
        <CaseForm
          command={command}
          suiteId={suiteId}
          testCase={testCase}
          onSaved={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

function CaseForm({
  command,
  suiteId,
  testCase,
  onSaved,
}: {
  command: CommandState<TestCase>
  suiteId: string
  testCase?: TestCase
  onSaved: () => void
}) {
  const base = useId()
  const id = (name: string) => `${base}-${name}`
  const config = useQuery<SentinelConfig>("config.get")
  const [name, setName] = useState(testCase?.name ?? "")
  const [input, setInput] = useState(testCase?.input ?? "")
  const [expected, setExpected] = useState(testCase?.expected ?? "")
  const [scenario, setScenario] = useState(testCase?.scenarioType ?? "standard")
  // The tags as the field first showed them. While the field still reads this,
  // the case's own tags go back exactly: an imported tag may hold a comma, and
  // splitting the joined text would turn one tag into two.
  const [initialTags] = useState(() => (testCase?.tags ?? []).join(", "))
  const [tags, setTags] = useState(initialTags)
  const [scorers, setScorers] = useState<ScorerRow[]>(() => rowsFrom(testCase))
  // Like the tags: an untouched context is not sent, so whatever the store
  // holds (a mongo nested value need not survive a JSON round trip) stays.
  const [initialContext] = useState(() => contextText(testCase))
  const [contextField, setContextField] = useState(initialContext)
  const attackType = typeof testCase?.context.attack_type === "string" ? testCase.context.attack_type : undefined
  const [problem, setProblem] = useState<string | null>(null)
  const sending = useRef(false)

  const registered = (config.data?.scorers ?? []).map((s) => s.name)
  const message = problem ?? command.error?.message
  const invalid = fieldFor(message)
  const invalidProps = (field: Problem) =>
    invalid === field ? { "aria-invalid": true as const, "aria-describedby": id("error") } : {}

  function updateRow(key: number, patch: Partial<ScorerRow>) {
    setScorers((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (sending.current || command.loading) return
    if (testCase) {
      if (name.trim() === "") return setProblem(NAME_REQUIRED)
      if (input.trim() === "") return setProblem(INPUT_REQUIRED)
    } else if (name.trim() === "" || input.trim() === "") {
      return setProblem(CREATE_REQUIRED)
    }
    const built: { name: string; config: Record<string, unknown> }[] = []
    for (const [i, row] of scorers.entries()) {
      const parsed = parseConfig(row.configText, i + 1)
      if ("problem" in parsed) return setProblem(parsed.problem)
      built.push({ name: row.name, config: parsed.config })
    }
    let context: Record<string, unknown> | undefined
    if (contextField !== initialContext) {
      const parsed = parseContext(contextField)
      if ("problem" in parsed) return setProblem(parsed.problem)
      context = parsed.context
    }
    setProblem(null)
    const fields = {
      name: name.trim(),
      input,
      expected,
      scenarioType: scenario,
      tags: testCase && tags === initialTags ? testCase.tags : parseTags(tags),
      scorers: built,
      ...(context !== undefined && { context }),
    }
    sending.current = true
    let saved: TestCase | undefined
    try {
      saved = testCase
        ? await command.execute({ caseId: testCase.id, ...fields })
        : await command.execute({ suiteId, ...fields })
    } finally {
      sending.current = false
    }
    if (saved) onSaved()
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="contents" noValidate>
      <DialogHeader>
        <DialogTitle>{testCase ? `Edit ${testCase.name}` : "Add case"}</DialogTitle>
      </DialogHeader>
      <FieldGroup>
        <Field>
          <Label htmlFor={id("name")}>Name</Label>
          <Input
            id={id("name")}
            value={name}
            autoComplete="off"
            {...invalidProps("name")}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field>
          <Label htmlFor={id("input")}>Input</Label>
          <Textarea
            id={id("input")}
            rows={3}
            value={input}
            {...invalidProps("input")}
            onChange={(e) => setInput(e.target.value)}
          />
          <FieldDescription>Sent to the target exactly as written.</FieldDescription>
        </Field>
        <Field>
          <Label htmlFor={id("expected")}>Expected output</Label>
          <Textarea
            id={id("expected")}
            rows={2}
            value={expected}
            onChange={(e) => setExpected(e.target.value)}
          />
          <FieldDescription>
            What exact and contains compare against when they have no config of their own.
          </FieldDescription>
        </Field>
        <Field>
          <Label htmlFor={id("scenario")}>Scenario type</Label>
          <NativeSelect
            id={id("scenario")}
            className="w-full"
            value={scenario}
            {...invalidProps("scenario")}
            onChange={(e) => setScenario(e.target.value)}
          >
            {SCENARIO_TYPES.map((t) => (
              <NativeSelectOption key={t} value={t}>
                {scenarioLabel(t)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Field>
          <Label htmlFor={id("tags")}>Tags</Label>
          <Input
            id={id("tags")}
            value={tags}
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
            onChange={(e) => setTags(e.target.value)}
          />
          <FieldDescription>Separated by commas.</FieldDescription>
        </Field>
        <Field>
          <Label htmlFor={id("context")}>Context</Label>
          <Textarea
            id={id("context")}
            rows={3}
            spellCheck={false}
            className="font-mono text-xs"
            value={contextField}
            placeholder="{}"
            {...invalidProps("context")}
            onChange={(e) => setContextField(e.target.value)}
          />
          <FieldDescription>
            A JSON object every scorer gets with the case. A run sets latency_ms and cost itself.
          </FieldDescription>
          {attackType !== undefined && (
            <FieldDescription>{`The attack type, ${attackType}, is kept. No edit can change it.`}</FieldDescription>
          )}
        </Field>
        <fieldset className="flex flex-col gap-3" aria-describedby={invalid === "scorers" ? id("error") : undefined}>
          <legend className="text-sm font-medium">Scorers</legend>
          <p className="text-xs text-muted-foreground">
            Each case's own scorers, with their settings. They run after the
            run's scorers, and a case any scorer cannot judge counts as an
            error.
          </p>
          {scorers.length === 0 && (
            <p className="text-sm text-muted-foreground">No scorers of its own.</p>
          )}
          {scorers.map((row, i) => {
            const options = registered.includes(row.name) || row.name === "" ? registered : [...registered, row.name]
            return (
              <div key={row.key} className="flex flex-col gap-2 rounded-md border p-3">
                <div className="flex items-end gap-2">
                  <Field className="flex-1">
                    <Label htmlFor={id(`scorer-${row.key}`)}>{`Scorer ${i + 1}`}</Label>
                    <NativeSelect
                      id={id(`scorer-${row.key}`)}
                      className="w-full font-mono"
                      value={row.name}
                      // The server matches a withheld value to its row by
                      // position among the same scorer's rows, so a hidden
                      // check keeps its name and its place.
                      disabled={row.redacted !== undefined}
                      onChange={(e) => updateRow(row.key, { name: e.target.value })}
                    >
                      {options.map((n) => (
                        <NativeSelectOption key={n} value={n}>
                          {n}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={`Remove scorer ${i + 1}`}
                    disabled={row.redacted !== undefined}
                    onClick={() => setScorers((rows) => rows.filter((r) => r.key !== row.key))}
                  >
                    Remove
                  </Button>
                </div>
                <Field>
                  <Label htmlFor={id(`config-${row.key}`)}>{`Scorer ${i + 1} config`}</Label>
                  <Textarea
                    id={id(`config-${row.key}`)}
                    rows={2}
                    spellCheck={false}
                    className="font-mono text-xs"
                    value={row.configText}
                    placeholder="{}"
                    onChange={(e) => updateRow(row.key, { configText: e.target.value })}
                  />
                  {row.redacted && (
                    <FieldDescription>
                      {`The ${row.redacted.key} (${plural(row.redacted.length, "character", "characters")}) is hidden, because it is the system prompt this case guards. It is kept unless you add a "${row.redacted.key}" key here. A hidden check cannot be removed or changed to another scorer here.`}
                    </FieldDescription>
                  )}
                </Field>
              </div>
            )
          })}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            disabled={registered.length === 0}
            onClick={() =>
              setScorers((rows) => [...rows, { key: nextKey(), name: registered[0] ?? "", configText: "" }])
            }
          >
            Add scorer
          </Button>
          {config.error && (
            <p className="text-xs text-muted-foreground">The registered scorers could not be loaded right now.</p>
          )}
        </fieldset>
      </FieldGroup>
      {message && (
        <p id={id("error")} role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />} disabled={command.loading}>
          Cancel
        </DialogClose>
        <Button type="submit" disabled={command.loading}>
          {testCase ? "Save case" : "Add case"}
        </Button>
      </DialogFooter>
    </form>
  )
}
