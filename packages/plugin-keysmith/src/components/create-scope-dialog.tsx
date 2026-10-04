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
import type { ScopesList, ScopeSummary } from "../types"

const NAME_REQUIRED = "name is required"
// The same params as the page and the other pickers, so they share one entry.
const PICKER_LIMIT = 200
const PICKER_PARAMS = { limit: PICKER_LIMIT }

type Problem = "name" | "parent" | "description"

/**
 * Which field a scopes.create refusal is about, so the form can mark it. The
 * messages are the server's (handlers_scope_write.go), shown as they come.
 */
function fieldFor(message: string | undefined): Problem | null {
  if (!message) return null
  if (
    message === NAME_REQUIRED ||
    message === "name is too long" ||
    message === "name cannot contain spaces" ||
    message === "a scope with this name already exists"
  ) {
    return "name"
  }
  if (message === "description is too long") return "description"
  if (
    message === "parent is too long" ||
    message === "a scope cannot be its own parent" ||
    /^parent scope ".*" does not exist in this tenant$/.test(message)
  ) {
    return "parent"
  }
  return null
}

export interface CreateScopeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Creates a scope: a name, an optional parent from the scopes that exist, and
 * a description.
 *
 * The form lives in the content, which Base UI mounts only while the dialog
 * is open, so every open starts blank. The command lives here, above it, and
 * is reset on open so the last attempt's refusal is not shown against this
 * one. While it is in flight the dialog refuses to close: the answer would
 * have nowhere to land.
 */
export function CreateScopeDialog({ open, onOpenChange }: CreateScopeDialogProps) {
  const create = useCommand<{ scope: ScopeSummary }>("scopes.create")
  const { reset } = create

  useEffect(() => {
    if (open) reset()
  }, [open, reset])

  const locked = create.loading

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
      <DialogContent showCloseButton={!locked} className="sm:max-w-lg">
        <CreateScopeForm command={create} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function CreateScopeForm({
  command,
  onClose,
}: {
  command: CommandState<{ scope: ScopeSummary }>
  onClose: () => void
}) {
  const base = useId()
  const id = (name: string) => `${base}-${name}`
  const scopes = useQuery<ScopesList>("scopes.list", PICKER_PARAMS)

  const [name, setName] = useState("")
  const [parent, setParent] = useState("")
  const [description, setDescription] = useState("")
  const [problem, setProblem] = useState<string | null>(null)
  // Set synchronously, so a second click in the same tick cannot slip past a
  // button that has not re-rendered as disabled yet.
  const sending = useRef(false)

  // Every listed scope, plus the chosen parent when the list no longer has it.
  // A failed refetch drops the list, and a select whose value has no option
  // shows "No parent" while the form would still send the parent.
  const listed = (scopes.data?.scopes ?? []).map((s) => s.name)
  const parents =
    parent !== "" && !listed.includes(parent) ? [...listed, parent] : listed

  const message = problem ?? command.error?.message
  const invalid = fieldFor(message)
  const invalidProps = (field: Problem) =>
    invalid === field
      ? { "aria-invalid": true as const, "aria-describedby": id("error") }
      : {}

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (sending.current || command.loading) return
    const trimmed = name.trim()
    if (trimmed === "") {
      setProblem(NAME_REQUIRED)
      return
    }
    setProblem(null)

    sending.current = true
    let result: { scope: ScopeSummary } | undefined
    try {
      // The parent always goes out: "" is no parent, which the server reads
      // the same as leaving it off.
      result = await command.execute({
        name: trimmed,
        parent,
        description: description.trim(),
      })
    } finally {
      sending.current = false
    }
    if (!result) return
    onClose()
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="contents" noValidate>
      <DialogHeader>
        <DialogTitle>Create scope</DialogTitle>
      </DialogHeader>

      <FieldGroup>
        <Field>
          <Label htmlFor={id("name")}>Name</Label>
          <Input
            id={id("name")}
            value={name}
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
            placeholder="billing:read"
            {...invalidProps("name")}
            onChange={(e) => setName(e.target.value)}
          />
          <FieldDescription>No spaces.</FieldDescription>
        </Field>

        <Field>
          <Label htmlFor={id("parent")}>Parent</Label>
          <NativeSelect
            id={id("parent")}
            className="w-full"
            value={parent}
            {...invalidProps("parent")}
            onChange={(e) => setParent(e.target.value)}
          >
            <NativeSelectOption value="">No parent</NativeSelectOption>
            {parents.map((n) => (
              <NativeSelectOption key={n} value={n}>
                {n}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          {scopes.error && (
            <FieldDescription>Scopes could not be loaded right now.</FieldDescription>
          )}
          {scopes.data?.hasMore && (
            <FieldDescription>
              {`Only the first ${PICKER_LIMIT} scopes are listed.`}
            </FieldDescription>
          )}
        </Field>

        <Field>
          <Label htmlFor={id("description")}>Description</Label>
          <Textarea
            id={id("description")}
            rows={2}
            value={description}
            {...invalidProps("description")}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
      </FieldGroup>

      {message && (
        <p id={id("error")} role="alert" className="text-sm text-destructive">
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
          Create scope
        </Button>
      </DialogFooter>
    </form>
  )
}
