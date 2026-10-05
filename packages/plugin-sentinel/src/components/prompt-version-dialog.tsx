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
import type { PromptVersion } from "../types"

const PROMPT_REQUIRED = "a prompt version needs a system prompt"

export interface PromptVersionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  suiteId: string
  /** The prompt runs use today, to start the new version from. */
  initialPrompt: string
}

/**
 * prompts.create. The server numbers the version (one above the highest), so
 * the form asks only for the prompt, a changelog line and whether runs should
 * use it from now on.
 */
export function PromptVersionDialog({ open, onOpenChange, suiteId, initialPrompt }: PromptVersionDialogProps) {
  const command = useCommand<PromptVersion>("prompts.create")
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
      <DialogContent showCloseButton={!locked} className="sm:max-w-2xl">
        <PromptVersionForm
          command={command}
          suiteId={suiteId}
          initialPrompt={initialPrompt}
          onSaved={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

function PromptVersionForm({
  command,
  suiteId,
  initialPrompt,
  onSaved,
}: {
  command: CommandState<PromptVersion>
  suiteId: string
  initialPrompt: string
  onSaved: () => void
}) {
  const base = useId()
  const id = (name: string) => `${base}-${name}`
  const [systemPrompt, setSystemPrompt] = useState(initialPrompt)
  const [changelog, setChangelog] = useState("")
  const [makeCurrent, setMakeCurrent] = useState(true)
  const [problem, setProblem] = useState<string | null>(null)
  const sending = useRef(false)
  const message = problem ?? command.error?.message

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (sending.current || command.loading) return
    if (systemPrompt.trim() === "") return setProblem(PROMPT_REQUIRED)
    setProblem(null)
    sending.current = true
    let saved: PromptVersion | undefined
    try {
      saved = await command.execute({ suiteId, systemPrompt, changelog: changelog.trim(), makeCurrent })
    } finally {
      sending.current = false
    }
    if (saved) onSaved()
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="contents" noValidate>
      <DialogHeader>
        <DialogTitle>New prompt version</DialogTitle>
      </DialogHeader>
      <FieldGroup>
        <Field>
          <Label htmlFor={id("prompt")}>System prompt</Label>
          <Textarea
            id={id("prompt")}
            rows={10}
            value={systemPrompt}
            aria-invalid={message === PROMPT_REQUIRED ? true : undefined}
            aria-describedby={message ? id("error") : undefined}
            onChange={(e) => setSystemPrompt(e.target.value)}
          />
          <FieldDescription>Starts from the prompt runs use today.</FieldDescription>
        </Field>
        <Field>
          <Label htmlFor={id("changelog")}>Changelog</Label>
          <Input
            id={id("changelog")}
            value={changelog}
            autoComplete="off"
            onChange={(e) => setChangelog(e.target.value)}
          />
          <FieldDescription>One line on what changed and why.</FieldDescription>
        </Field>
        <Label className="font-normal">
          <Checkbox checked={makeCurrent} onCheckedChange={(on) => setMakeCurrent(on === true)} />
          Make it current, so runs started from now use it
        </Label>
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
          Create version
        </Button>
      </DialogFooter>
    </form>
  )
}
