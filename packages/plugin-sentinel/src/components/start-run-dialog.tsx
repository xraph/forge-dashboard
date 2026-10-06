import { useEffect, useId, useRef, useState } from "react"
import type { FormEvent } from "react"
import { useCommand, useNavigateTo, useQuery } from "@forge-go/dashboard-plugin"
import type { CommandState } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Checkbox } from "@forge-go/dashboard-kit/components/checkbox"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@forge-go/dashboard-kit/components/dialog"
import { Field, FieldDescription, FieldGroup } from "@forge-go/dashboard-kit/components/field"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import {
  NativeSelect,
  NativeSelectOption,
} from "@forge-go/dashboard-kit/components/native-select"
import { LlmBadge, NeedsConfigBadge } from "../badges"
import { formatCost, plural, runPath } from "../format"
import type { Run, RunsList, SentinelConfig, Suite } from "../types"

const SCORER_REQUIRED = "choose at least one scorer"

/**
 * runs.start, and the one place the dashboard spends money. The dialog names
 * everything the run will use before it starts: the suite and its case count,
 * the target and what it is, the model, and the scorers, with every scorer
 * that calls an LLM flagged. It shows what the last completed run of this
 * suite reported as its cost, with the caveat that LLM judge calls are not in
 * that figure. On success the page moves to the new run, which shows its own
 * progress.
 *
 * The caller opens it only when a target is registered and the suite has a
 * case; the server refuses both anyway.
 */
export function StartRunDialog({
  open,
  onOpenChange,
  suite,
  config,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  suite: Suite
  config: SentinelConfig
}) {
  const command = useCommand<Run>("runs.start")
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
      <DialogContent showCloseButton={!locked} className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-lg">
        {/* Mounted per open, so each opening starts from the defaults. */}
        {open && (
          <StartRunForm command={command} suite={suite} config={config} onStarted={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  )
}

function StartRunForm({
  command,
  suite,
  config,
  onStarted,
}: {
  command: CommandState<Run>
  suite: Suite
  config: SentinelConfig
  onStarted: () => void
}) {
  const id = useId()
  const navigate = useNavigateTo()
  const [target, setTarget] = useState(config.targets[0]?.name ?? "")
  const [model, setModel] = useState("")
  const [scorers, setScorers] = useState<string[]>([])
  const [problem, setProblem] = useState<string | null>(null)
  const sending = useRef(false)
  const last = useQuery<RunsList>("runs.list", { suiteId: suite.id, state: "completed", limit: 1 })
  const message = problem ?? command.error?.message
  const chosenTarget = config.targets.find((t) => t.name === target)
  const effectiveModel = model.trim() || suite.model || config.defaultModel
  const llmChosen = config.scorers.some((s) => s.usesLlm && scorers.includes(s.name))

  function toggle(name: string, on: boolean) {
    setProblem(null)
    // Kept in the order the engine lists them, whatever order they were ticked.
    setScorers((current) =>
      config.scorers.map((s) => s.name).filter((n) => (n === name ? on : current.includes(n))),
    )
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (sending.current || command.loading) return
    if (scorers.length === 0) return setProblem(SCORER_REQUIRED)
    setProblem(null)
    sending.current = true
    let run: Run | undefined
    try {
      run = await command.execute({
        suiteId: suite.id,
        target,
        scorers,
        // Empty means the suite's model, then the engine's.
        ...(model.trim() !== "" && { model: model.trim() }),
      })
    } finally {
      sending.current = false
    }
    if (!run) return
    onStarted()
    navigate(runPath(run.id))
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="contents" noValidate>
      <DialogHeader>
        <DialogTitle>{`Run ${suite.name}`}</DialogTitle>
        <DialogDescription>
          {`Every one of its ${plural(suite.caseCount, "case", "cases")} goes to the target, then each scorer judges the answer.`}
        </DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <Field>
          <Label htmlFor={`${id}-target`}>Target</Label>
          <NativeSelect
            id={`${id}-target`}
            value={target}
            disabled={command.loading}
            aria-describedby={`${id}-target-about`}
            onChange={(e) => setTarget(e.target.value)}
          >
            {config.targets.map((t) => (
              <NativeSelectOption key={t.name} value={t.name}>
                {t.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <FieldDescription id={`${id}-target-about`}>
            {chosenTarget?.description || "This target has no description."}
          </FieldDescription>
        </Field>
        <Field>
          <Label htmlFor={`${id}-model`}>Model</Label>
          <Input
            id={`${id}-model`}
            value={model}
            autoComplete="off"
            disabled={command.loading}
            placeholder={suite.model || config.defaultModel}
            onChange={(e) => setModel(e.target.value)}
          />
          <FieldDescription>
            {suite.model
              ? `Leave it empty to use the suite's model, ${suite.model}.`
              : `Leave it empty to use the engine's default, ${config.defaultModel}.`}
          </FieldDescription>
        </Field>
        <fieldset className="flex flex-col gap-2" aria-describedby={`${id}-scorers-about`}>
          <legend className="text-sm font-medium">Scorers</legend>
          <p id={`${id}-scorers-about`} className="text-sm text-muted-foreground">
            Each case's own scorers run as well. A scorer that needs config of its own can only run from a case.
          </p>
          {config.scorers.map((s) => (
            <Label key={s.name} className="items-start font-normal">
              <Checkbox
                checked={scorers.includes(s.name)}
                disabled={s.requiresConfig || command.loading}
                onCheckedChange={(on) => toggle(s.name, on === true)}
              />
              <span className="flex flex-col gap-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs">{s.name}</span>
                  {s.usesLlm && <LlmBadge />}
                  {s.requiresConfig && <NeedsConfigBadge />}
                </span>
                {s.description && <span className="text-xs text-muted-foreground">{s.description}</span>}
              </span>
            </Label>
          ))}
        </fieldset>
      </FieldGroup>
      <section aria-label="What this run uses" className="flex flex-col gap-1 rounded-md border p-3 text-sm">
        <p>
          {`${plural(suite.caseCount, "case", "cases")} to `}
          <span className="font-mono text-xs">{target}</span>
          {" on "}
          <span className="font-mono text-xs">{effectiveModel}</span>
          {scorers.length > 0 ? `, judged by ${plural(scorers.length, "scorer", "scorers")}` : ", no scorer chosen yet"}
          {llmChosen ? ", some of which call an LLM." : "."}
        </p>
        <p className="text-muted-foreground">{lastCost(last.data, Boolean(last.error))}</p>
      </section>
      {message && (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />} disabled={command.loading}>
          Cancel
        </DialogClose>
        <Button type="submit" disabled={command.loading}>
          {`Start run on ${plural(suite.caseCount, "case", "cases")}`}
        </Button>
      </DialogFooter>
    </form>
  )
}

/** The last completed run's reported cost, or why there is none to show. */
function lastCost(data: RunsList | undefined, failed: boolean): string {
  if (failed) return "The last run's cost could not be read."
  if (!data) return "Reading the last run's cost."
  const run = data.items[0]
  if (!run) return "This suite has no completed run yet, so there is no cost to go on."
  return `The last completed run reported ${formatCost(run.totalCost)}. That is what the target reported; LLM judge calls are not metered and are not in it.`
}
