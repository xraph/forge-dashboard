import { useEffect, useId, useRef, useState } from "react"
import type { FormEvent } from "react"
import { useCommand } from "@forge-go/dashboard-plugin"
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
import { Textarea } from "@forge-go/dashboard-kit/components/textarea"
import type { Suite } from "../types"

// The server's words (handlers_suites.go), checked here first so an obvious
// mistake never makes a round trip, and matched when they come back so the
// form can mark the field they are about.
const NAME_REQUIRED = "a suite needs a name"
const NAME_TAKEN = "a suite with this name already exists"
const TEMPERATURE_RANGE = "temperature must be between 0 and 2"

type Problem = "name" | "temperature"

function fieldFor(message: string | undefined): Problem | null {
  if (message === NAME_REQUIRED || message === NAME_TAKEN) return "name"
  if (message === TEMPERATURE_RANGE) return "temperature"
  return null
}

/** The temperature box as a number, undefined when empty, NaN when not a number. */
function parseTemperature(text: string): number | undefined {
  const trimmed = text.trim()
  if (trimmed === "") return undefined
  return Number(trimmed)
}

export interface SuiteFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The suite being edited. Without one the dialog creates a suite. */
  suite?: Suite
  /** Called with the saved suite once the server has it. */
  onSaved?: (suite: Suite) => void
}

/**
 * Creates or edits a suite. Both commands answer the saved suite, and both
 * invalidate the suite list (and an edit the detail), so the pages refresh
 * through `meta.invalidates` and nothing here refetches.
 *
 * The form lives in the dialog's content, which mounts only while open, so
 * every open starts from the suite as it is now (or blank). The command lives
 * above it and is reset on open, so the last attempt's refusal is not shown
 * against this one. While it is in flight the dialog refuses to close.
 */
export function SuiteFormDialog({ open, onOpenChange, suite, onSaved }: SuiteFormDialogProps) {
  const command = useCommand<Suite>(suite ? "suites.update" : "suites.create")
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
      <DialogContent showCloseButton={!locked} className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-xl">
        <SuiteForm
          command={command}
          suite={suite}
          onSaved={(saved) => {
            onOpenChange(false)
            onSaved?.(saved)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}

function SuiteForm({
  command,
  suite,
  onSaved,
}: {
  command: CommandState<Suite>
  suite?: Suite
  onSaved: (suite: Suite) => void
}) {
  const base = useId()
  const id = (name: string) => `${base}-${name}`
  const [name, setName] = useState(suite?.name ?? "")
  const [description, setDescription] = useState(suite?.description ?? "")
  const [model, setModel] = useState(suite?.model ?? "")
  // Zero is "not set" to the engine, so an existing suite at zero shows an
  // empty box rather than a temperature of 0.
  const [temperature, setTemperature] = useState(
    suite && suite.temperature !== 0 ? String(suite.temperature) : "",
  )
  const [personaRef, setPersonaRef] = useState(suite?.personaRef ?? "")
  const [systemPrompt, setSystemPrompt] = useState(suite?.systemPrompt ?? "")
  const [problem, setProblem] = useState<string | null>(null)
  // Set synchronously, so a second click in the same tick cannot slip past a
  // button that has not re-rendered as disabled yet.
  const sending = useRef(false)

  const message = problem ?? command.error?.message
  const invalid = fieldFor(message)
  const invalidProps = (field: Problem) =>
    invalid === field ? { "aria-invalid": true as const, "aria-describedby": id("error") } : {}

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (sending.current || command.loading) return
    if (name.trim() === "") {
      setProblem(NAME_REQUIRED)
      return
    }
    const temp = parseTemperature(temperature)
    if (temp !== undefined && (Number.isNaN(temp) || temp < 0 || temp > 2)) {
      setProblem(TEMPERATURE_RANGE)
      return
    }
    setProblem(null)
    const fields = {
      name: name.trim(),
      description,
      model: model.trim(),
      personaRef: personaRef.trim(),
      systemPrompt,
    }
    sending.current = true
    let saved: Suite | undefined
    try {
      saved = suite
        ? // Every field goes out, prefilled from the suite, so nothing the
          // operator did not touch changes. An empty temperature is 0: the
          // engine's own.
          await command.execute({ suiteId: suite.id, ...fields, temperature: temp ?? 0 })
        : // On create an empty temperature is left out, and an empty model
          // is the engine's default model.
          await command.execute({ ...fields, ...(temp !== undefined && { temperature: temp }) })
    } finally {
      sending.current = false
    }
    if (saved) onSaved(saved)
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="contents" noValidate>
      <DialogHeader>
        <DialogTitle>{suite ? `Edit ${suite.name}` : "Create suite"}</DialogTitle>
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
          <Label htmlFor={id("description")}>Description</Label>
          <Textarea
            id={id("description")}
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <Field>
          <Label htmlFor={id("model")}>Model</Label>
          <Input
            id={id("model")}
            value={model}
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
            onChange={(e) => setModel(e.target.value)}
          />
          <FieldDescription>
            {suite
              ? "Empty leaves the choice to each run, then to the engine's default model."
              : "Empty uses the engine's default model."}
          </FieldDescription>
        </Field>
        <Field>
          <Label htmlFor={id("temperature")}>Temperature</Label>
          <Input
            id={id("temperature")}
            value={temperature}
            inputMode="decimal"
            autoComplete="off"
            className="font-mono"
            {...invalidProps("temperature")}
            onChange={(e) => setTemperature(e.target.value)}
          />
          <FieldDescription>From 0 to 2. Empty uses the engine's temperature.</FieldDescription>
        </Field>
        <Field>
          <Label htmlFor={id("persona")}>Persona</Label>
          <Input
            id={id("persona")}
            value={personaRef}
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
            onChange={(e) => setPersonaRef(e.target.value)}
          />
        </Field>
        <Field>
          <Label htmlFor={id("prompt")}>System prompt</Label>
          <Textarea
            id={id("prompt")}
            rows={6}
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
          />
          {suite?.currentPromptVersion && (
            <FieldDescription>
              {`Runs use version ${suite.currentPromptVersion.version}'s prompt while it is current. This is the suite's own.`}
            </FieldDescription>
          )}
        </Field>
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
          {suite ? "Save suite" : "Create suite"}
        </Button>
      </DialogFooter>
    </form>
  )
}
