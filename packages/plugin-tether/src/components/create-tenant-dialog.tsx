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
import { TetherCommandAlert } from "./boundary"
import type { CreateTenantInput, Limits, Tenant } from "../types"

const LIMIT_FIELDS: {
  key: keyof Limits
  label: string
  whole: boolean
}[] = [
  { key: "maxConnections", label: "Max connections", whole: true },
  { key: "messagesPerSecond", label: "Messages per second", whole: false },
  { key: "burst", label: "Burst", whole: true },
  {
    key: "maxSessionExpirySeconds",
    label: "Max session expiry (seconds)",
    whole: true,
  },
  { key: "maxSessions", label: "Max sessions", whole: true },
]

/**
 * Reads the limit inputs. Empty is 0, which the broker takes as its default.
 * Returns the limits (null when nothing was set, so the payload leaves the
 * field off) or the first thing wrong, named after its field.
 */
function readLimits(
  raw: Record<keyof Limits, string>
): { limits: Limits | null } | { problem: string } {
  const limits: Limits = {
    maxConnections: 0,
    messagesPerSecond: 0,
    burst: 0,
    maxSessionExpirySeconds: 0,
    maxSessions: 0,
  }
  let any = false
  for (const field of LIMIT_FIELDS) {
    const text = raw[field.key].trim()
    if (text === "") continue
    const n = Number(text)
    if (!Number.isFinite(n) || n < 0) {
      return { problem: `${field.label} must be zero or more.` }
    }
    if (field.whole && !Number.isInteger(n)) {
      return { problem: `${field.label} must be a whole number.` }
    }
    limits[field.key] = n
    if (n > 0) any = true
  }
  return { limits: any ? limits : null }
}

export interface CreateTenantDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Creates a tenant. The form lives in the content, which Base UI mounts only
 * while the dialog is open, so every open starts blank. The command lives
 * here, above it, and is reset on open so the last attempt's refusal is not
 * shown against this one. While it is in flight the dialog refuses to close:
 * the answer would have nowhere to land.
 */
export function CreateTenantDialog({
  open,
  onOpenChange,
}: CreateTenantDialogProps) {
  const create = useCommand<Tenant>("tenants.create")
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
        <CreateTenantForm
          command={create}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

function CreateTenantForm({
  command,
  onClose,
}: {
  command: CommandState<Tenant>
  onClose: () => void
}) {
  const base = useId()
  const id = (name: string) => `${base}-${name}`

  const [name, setName] = useState("")
  const [appId, setAppId] = useState("")
  const [externalId, setExternalId] = useState("")
  const [limits, setLimits] = useState<Record<keyof Limits, string>>({
    maxConnections: "",
    messagesPerSecond: "",
    burst: "",
    maxSessionExpirySeconds: "",
    maxSessions: "",
  })
  const [problem, setProblem] = useState<string | null>(null)
  // Set synchronously, so a second Enter in the same tick cannot slip past a
  // button that has not re-rendered as disabled yet.
  const sending = useRef(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (sending.current || command.loading) return
    if (appId.trim() === "") return setProblem("App ID is required.")
    if (externalId.trim() === "") return setProblem("External ID is required.")
    const read = readLimits(limits)
    if ("problem" in read) return setProblem(read.problem)
    setProblem(null)

    const payload: CreateTenantInput = {
      appId: appId.trim(),
      externalId: externalId.trim(),
      name: name.trim(),
      ...(read.limits && { limits: read.limits }),
    }
    sending.current = true
    let result: Tenant | undefined
    try {
      result = await command.execute(payload)
    } finally {
      sending.current = false
    }
    // execute resolves undefined on failure and never rejects. A failed
    // create must not close the form and throw away what was typed.
    if (result === undefined) return
    onClose()
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="contents" noValidate>
      <DialogHeader>
        <DialogTitle>Create tenant</DialogTitle>
      </DialogHeader>

      <FieldGroup>
        <Field>
          <Label htmlFor={id("name")}>Name</Label>
          <Input
            id={id("name")}
            value={name}
            autoComplete="off"
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field>
          <Label htmlFor={id("app")}>App ID</Label>
          <Input
            id={id("app")}
            value={appId}
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
            onChange={(e) => setAppId(e.target.value)}
          />
        </Field>
        <Field>
          <Label htmlFor={id("external")}>External ID</Label>
          <Input
            id={id("external")}
            value={externalId}
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
            onChange={(e) => setExternalId(e.target.value)}
          />
          <FieldDescription>
            Your own identifier for this tenant. Each one is used once.
          </FieldDescription>
        </Field>

        <fieldset className="flex min-w-0 flex-col gap-3">
          <legend className="text-sm font-medium">Limits</legend>
          <p className="text-xs text-muted-foreground">
            Leave a limit empty for the broker&apos;s default.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {LIMIT_FIELDS.map((field) => (
              <Field key={field.key}>
                <Label htmlFor={id(field.key)}>{field.label}</Label>
                <Input
                  id={id(field.key)}
                  type="number"
                  min={0}
                  step={field.whole ? 1 : "any"}
                  value={limits[field.key]}
                  onChange={(e) =>
                    setLimits((prev) => ({
                      ...prev,
                      [field.key]: e.target.value,
                    }))
                  }
                />
              </Field>
            ))}
          </div>
        </fieldset>
      </FieldGroup>

      {problem ? (
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      ) : (
        <TetherCommandAlert
          error={command.error}
          title="Could not create the tenant"
        />
      )}

      <DialogFooter>
        <DialogClose
          render={<Button type="button" variant="outline" />}
          disabled={command.loading}
        >
          Cancel
        </DialogClose>
        <Button type="submit" disabled={command.loading}>
          Create tenant
        </Button>
      </DialogFooter>
    </form>
  )
}
