import { useEffect, useId, useRef, useState } from "react"
import type { FormEvent } from "react"
import { useCommand } from "@forge-go/dashboard-plugin"
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
import { Label } from "@forge-go/dashboard-kit/components/label"
import {
  NativeSelect,
  NativeSelectOption,
} from "@forge-go/dashboard-kit/components/native-select"
import { ATTACK_TYPES, attackLabel, plural } from "../format"
import type { GenerateResult } from "../types"

/** The engine's templates per attack type, so the most one type can add. */
const PER_TYPE = 5

const TYPE_REQUIRED = "choose at least one attack type"

const ABOUT: Record<(typeof ATTACK_TYPES)[number], string> = {
  injection:
    "Instructions hidden in the input that try to override the system prompt.",
  jailbreak:
    "Role-play and framing that try to talk the target out of its rules.",
  leakage: "Requests for the system prompt itself. Scored with a hidden check.",
  hallucination:
    "Questions about things that do not exist, to see if the target invents them.",
  offtopic: "Requests outside the assistant's job, to see if it stays on task.",
}

/**
 * redteam.generate. It adds ordinary cases tagged red team to the suite, from
 * the engine's templates; nothing runs until a run is started. The dialog says
 * how many cases at most it will add before anything is sent.
 */
export function GenerateDialog({
  open,
  onOpenChange,
  suiteId,
  onGenerated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  suiteId: string
  onGenerated: (result: GenerateResult) => void
}) {
  const command = useCommand<GenerateResult>("redteam.generate")
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
      <DialogContent
        showCloseButton={!locked}
        className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-lg"
      >
        {open && (
          <GenerateForm
            command={command}
            suiteId={suiteId}
            onDone={(result) => {
              onOpenChange(false)
              onGenerated(result)
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function GenerateForm({
  command,
  suiteId,
  onDone,
}: {
  command: CommandState<GenerateResult>
  suiteId: string
  onDone: (result: GenerateResult) => void
}) {
  const id = useId()
  const [types, setTypes] = useState<string[]>([])
  const [count, setCount] = useState(PER_TYPE)
  const [problem, setProblem] = useState<string | null>(null)
  const sending = useRef(false)
  const message = problem ?? command.error?.message

  function toggle(type: string, on: boolean) {
    setProblem(null)
    setTypes((current) =>
      ATTACK_TYPES.filter((t) => (t === type ? on : current.includes(t)))
    )
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (sending.current || command.loading) return
    if (types.length === 0) return setProblem(TYPE_REQUIRED)
    setProblem(null)
    sending.current = true
    let result: GenerateResult | undefined
    try {
      result = await command.execute({ suiteId, attackTypes: types, count })
    } finally {
      sending.current = false
    }
    if (result) onDone(result)
  }

  const most = types.length * count
  return (
    <form onSubmit={(e) => void submit(e)} className="contents" noValidate>
      <DialogHeader>
        <DialogTitle>Generate red-team cases</DialogTitle>
        <DialogDescription>
          The cases join this suite, tagged red team, and every later run scores
          them with the rest. Nothing runs now.
        </DialogDescription>
      </DialogHeader>
      <fieldset className="flex min-w-0 flex-col gap-2">
        <legend className="text-sm font-medium">Attack types</legend>
        {ATTACK_TYPES.map((type) => (
          <Label key={type} className="items-start font-normal">
            <Checkbox
              checked={types.includes(type)}
              disabled={command.loading}
              onCheckedChange={(on) => toggle(type, on === true)}
            />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span>{attackLabel(type)}</span>
              <span className="text-xs text-muted-foreground">
                {ABOUT[type]}
              </span>
            </span>
          </Label>
        ))}
      </fieldset>
      <div className="flex min-w-0 flex-col gap-1">
        <Label htmlFor={`${id}-count`}>Cases per type</Label>
        <NativeSelect
          id={`${id}-count`}
          value={String(count)}
          disabled={command.loading}
          onChange={(e) => setCount(Number(e.target.value))}
        >
          {Array.from({ length: PER_TYPE }, (_, i) => i + 1).map((n) => (
            <NativeSelectOption key={n} value={String(n)}>
              {String(n)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <p className="text-xs text-muted-foreground">{`Each type has ${PER_TYPE} templates, so ${PER_TYPE} is the most it can add.`}</p>
      </div>
      {message && (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}
      <DialogFooter>
        <DialogClose
          render={<Button type="button" variant="outline" />}
          disabled={command.loading}
        >
          Cancel
        </DialogClose>
        <Button type="submit" disabled={command.loading}>
          {most === 0
            ? "Generate cases"
            : `Generate up to ${plural(most, "case", "cases")}`}
        </Button>
      </DialogFooter>
    </form>
  )
}
