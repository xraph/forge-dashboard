import { useEffect, useEffectEvent, useId, useRef, useState } from "react"
import type { FormEvent } from "react"
import { useCommand, useQuery } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
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
import type { ContractError } from "@forge-go/dashboard-plugin"
import { alreadyRan, useAttemptKey } from "../attempt"
import type { ExplainedError } from "../errors"
import type { Ack, Credentials, Device, RolesList } from "../types"
import { TetherCommandAlert } from "./boundary"
import { RolePicker } from "./role-picker"

/**
 * An error as the dialog should show it. A replayed provision or rotate is a
 * CONFLICT whose bare message says nothing an operator can act on, so it gets
 * the next step: the password was shown once and is gone.
 */
function attemptError(
  error: ContractError | undefined,
  what: "provision" | "rotate"
): ExplainedError | undefined {
  if (!alreadyRan(error)) return error
  return {
    code: "CONFLICT",
    message:
      what === "provision"
        ? "This request already ran, and its password was shown once and is gone. The device exists: close this dialog and rotate its key to get a new password."
        : "This request already ran, and its password was shown once and is gone. Close this dialog and rotate the key again to get a new password.",
  }
}

/** The label of a device in a sentence: its name, else its ID. */
export function deviceLabel(device: Pick<Device, "name" | "id">): string {
  return device.name.trim() === "" ? device.id : device.name
}

// ---------------------------------------------------------------- provision

export interface ProvisionDeviceDialogProps {
  tenantId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The credentials, once. The caller shows them and forgets them. */
  onProvisioned: (credentials: Credentials) => void
  /** The server ran the request but the answer is gone: reread the list. */
  onStale: () => void
}

/**
 * Provisions a device. The form lives in the dialog content, which Base UI
 * mounts only while open, so every open starts blank and with a fresh
 * idempotency key; the command and the role read live above it.
 */
export function ProvisionDeviceDialog({
  tenantId,
  open,
  onOpenChange,
  onProvisioned,
  onStale,
}: ProvisionDeviceDialogProps) {
  const provision = useCommand<Credentials>("devices.provision")
  const roles = useQuery<RolesList>(
    "roles.list",
    { tenantId },
    { enabled: open }
  )
  const { reset } = provision
  const locked = provision.loading

  // The last attempt's refusal is not about this one.
  useEffect(() => {
    if (open) reset()
  }, [open, reset])

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
        <ProvisionForm
          tenantId={tenantId}
          command={provision}
          roles={roles}
          onClose={() => onOpenChange(false)}
          onProvisioned={onProvisioned}
          onStale={onStale}
        />
      </DialogContent>
    </Dialog>
  )
}

function ProvisionForm({
  tenantId,
  command,
  roles,
  onClose,
  onProvisioned,
  onStale,
}: {
  tenantId: string
  command: ReturnType<typeof useCommand<Credentials>>
  roles: ReturnType<typeof useQuery<RolesList>>
  onClose: () => void
  onProvisioned: (credentials: Credentials) => void
  onStale: () => void
}) {
  const base = useId()
  const id = (name: string) => `${base}-${name}`
  const attempt = useAttemptKey()
  const sending = useRef(false)

  // A fresh form per open: reset belongs to the open, and this mounts then.
  const [name, setName] = useState("")
  const [clientId, setClientId] = useState("")
  const [expires, setExpires] = useState("")
  const [selected, setSelected] = useState<string[]>([])
  const [problem, setProblem] = useState<string | null>(null)

  // The request ran but its answer is gone: the device exists, so the list
  // behind this dialog is out of date.
  const stale = useEffectEvent(onStale)
  useEffect(() => {
    if (alreadyRan(command.error)) stale()
  }, [command.error])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (sending.current || command.loading) return
    if (name.trim() === "") return setProblem("Name is required.")
    let expiresAt: string | undefined
    if (expires !== "") {
      const at = new Date(expires)
      if (Number.isNaN(at.getTime())) return setProblem("Expiry is not a date.")
      expiresAt = at.toISOString()
    }
    setProblem(null)

    const payload = {
      tenantId,
      name: name.trim(),
      ...(clientId.trim() !== "" && { clientId: clientId.trim() }),
      ...(selected.length > 0 && { roles: selected }),
      ...(expiresAt !== undefined && { expiresAt }),
    }
    sending.current = true
    let result: Credentials | undefined
    try {
      result = await command.execute(payload, {
        idempotencyKey: attempt.keyFor(payload),
      })
    } finally {
      sending.current = false
    }
    if (result === undefined) return
    attempt.end()
    // The hook keeps its last answer, and this one holds a password. The
    // caller has it now, for as long as the credentials dialog is up.
    command.reset()
    onProvisioned(result)
    onClose()
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="contents" noValidate>
      <DialogHeader>
        <DialogTitle>Provision device</DialogTitle>
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
          <Label htmlFor={id("client")}>Client ID</Label>
          <Input
            id={id("client")}
            value={clientId}
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
            onChange={(e) => setClientId(e.target.value)}
          />
          <FieldDescription>
            Optional. Locks the device to one MQTT client ID. Leave empty to let
            it use any.
          </FieldDescription>
        </Field>
        <Field>
          <Label htmlFor={id("expires")}>Expires</Label>
          <Input
            id={id("expires")}
            type="datetime-local"
            value={expires}
            onChange={(e) => setExpires(e.target.value)}
          />
          <FieldDescription>
            Optional. The key stops working at this time, in your time zone.
          </FieldDescription>
        </Field>
        <fieldset className="flex min-w-0 flex-col gap-2">
          <legend className="text-sm font-medium">Roles</legend>
          <RolePicker
            roles={roles}
            selected={selected}
            onChange={setSelected}
          />
        </fieldset>
      </FieldGroup>

      {problem ? (
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      ) : (
        <TetherCommandAlert
          error={attemptError(command.error, "provision")}
          title="Could not provision the device"
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
          Provision
        </Button>
      </DialogFooter>
    </form>
  )
}

// ------------------------------------------------------------------- rotate

export interface DeviceDialogProps {
  tenantId: string
  /** The device the dialog is for, or null for closed. */
  device: Device | null
  onClose: () => void
}

/**
 * Rotates a device's key. The body mounts when a device is picked and goes
 * with it, so each device starts with a fresh command, an empty grace field and
 * no refusal left over from the last one.
 */
export function RotateDeviceDialog({
  device,
  onRotated,
  onStale,
  ...rest
}: DeviceDialogProps & {
  onRotated: (credentials: Credentials) => void
  onStale: () => void
}) {
  if (device === null) return null
  return (
    <RotateBody
      key={device.id}
      device={device}
      onRotated={onRotated}
      onStale={onStale}
      {...rest}
    />
  )
}

function RotateBody({
  tenantId,
  device,
  onClose,
  onRotated,
  onStale,
}: DeviceDialogProps & {
  device: Device
  onRotated: (credentials: Credentials) => void
  onStale: () => void
}) {
  const rotate = useCommand<Credentials>("devices.rotate")
  const attempt = useAttemptKey()
  const [grace, setGrace] = useState("")
  const [problem, setProblem] = useState<string | null>(null)
  const graceId = useId()

  const stale = useEffectEvent(onStale)
  useEffect(() => {
    if (alreadyRan(rotate.error)) stale()
  }, [rotate.error])

  async function confirm() {
    const text = grace.trim()
    let graceSeconds: number | undefined
    if (text !== "") {
      graceSeconds = Number(text)
      if (!Number.isInteger(graceSeconds) || graceSeconds < 0) {
        return setProblem("Grace period must be a whole number of seconds.")
      }
    }
    setProblem(null)
    const payload = {
      tenantId,
      deviceId: device.id,
      ...(graceSeconds !== undefined && { graceSeconds }),
    }
    const result = await rotate.execute(payload, {
      idempotencyKey: attempt.keyFor(payload),
    })
    if (result === undefined) return
    attempt.end()
    onRotated(result)
    onClose()
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={`Rotate the key of “${deviceLabel(device)}”?`}
      description="Makes a new password. The old one keeps working for the grace period, so a device can be updated before it stops."
      confirmLabel="Rotate"
      destructive={false}
      // Required. Without it a double-click rotates twice.
      pending={rotate.loading}
      onConfirm={() => void confirm()}
    >
      <Field>
        <Label htmlFor={graceId}>Grace period (seconds)</Label>
        <Input
          id={graceId}
          type="number"
          min={0}
          step={1}
          value={grace}
          onChange={(e) => setGrace(e.target.value)}
        />
        <FieldDescription>
          Leave empty for keysmith&apos;s default.
        </FieldDescription>
      </Field>
      {problem ? (
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      ) : (
        <TetherCommandAlert
          error={attemptError(rotate.error, "rotate")}
          title="Could not rotate the key"
        />
      )}
    </ConfirmDialog>
  )
}

// ------------------------------------------------------------------- revoke

export function RevokeDeviceDialog({ device, ...rest }: DeviceDialogProps) {
  if (device === null) return null
  return <RevokeBody key={device.id} device={device} {...rest} />
}

function RevokeBody({
  tenantId,
  device,
  onClose,
}: DeviceDialogProps & { device: Device }) {
  const revoke = useCommand<Ack>("devices.revoke")
  const [reason, setReason] = useState("")
  const reasonId = useId()

  async function confirm() {
    const why = reason.trim()
    const result = await revoke.execute({
      tenantId,
      deviceId: device.id,
      ...(why !== "" && { reason: why }),
    })
    // Close on success only: a failure stays in front of the person who
    // caused it, inside the dialog.
    if (result !== undefined) onClose()
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={`Revoke “${deviceLabel(device)}”?`}
      description="The key stops working and live connections end. The device record stays, and cannot be rotated afterwards."
      confirmLabel="Revoke"
      pending={revoke.loading}
      onConfirm={() => void confirm()}
    >
      <Field>
        <Label htmlFor={reasonId}>Reason</Label>
        <Input
          id={reasonId}
          value={reason}
          autoComplete="off"
          onChange={(e) => setReason(e.target.value)}
        />
        <FieldDescription>Optional.</FieldDescription>
      </Field>
      <TetherCommandAlert
        error={revoke.error}
        title="Could not revoke the device"
      />
    </ConfirmDialog>
  )
}

// ------------------------------------------------------------------- delete

export function DeleteDeviceDialog({
  device,
  onDeleted,
  ...rest
}: DeviceDialogProps & { onDeleted?: () => void }) {
  if (device === null) return null
  return (
    <DeleteBody
      key={device.id}
      device={device}
      onDeleted={onDeleted}
      {...rest}
    />
  )
}

function DeleteBody({
  tenantId,
  device,
  onClose,
  onDeleted,
}: DeviceDialogProps & { device: Device; onDeleted?: () => void }) {
  const remove = useCommand<Ack>("devices.delete")

  async function confirm() {
    const result = await remove.execute({ tenantId, deviceId: device.id })
    if (result === undefined) return
    onClose()
    onDeleted?.()
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={`Delete “${deviceLabel(device)}”?`}
      description="Removes the device and its key. Live connections end."
      confirmLabel="Delete"
      pending={remove.loading}
      onConfirm={() => void confirm()}
    >
      <TetherCommandAlert
        error={remove.error}
        title="Could not delete the device"
      />
    </ConfirmDialog>
  )
}

// -------------------------------------------------------------------- roles

export function DeviceRolesDialog({ device, ...rest }: DeviceDialogProps) {
  if (device === null) return null
  return <RolesBody key={device.id} device={device} {...rest} />
}

function RolesBody({
  tenantId,
  device,
  onClose,
}: DeviceDialogProps & { device: Device }) {
  const set = useCommand<Device>("devices.roles.set")
  const roles = useQuery<RolesList>("roles.list", { tenantId })
  const [selected, setSelected] = useState<string[]>(device.roles)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (set.loading) return
    // The whole set, [] included: an absent list is BAD_REQUEST, and [] is how
    // every role comes off.
    const result = await set.execute({
      tenantId,
      deviceId: device.id,
      roles: selected,
    })
    if (result !== undefined) onClose()
  }

  return (
    <Dialog
      open
      onOpenChange={(open, details) => {
        if (open) return
        if (set.loading) details.cancel()
        else onClose()
      }}
      disablePointerDismissal={set.loading}
    >
      <DialogContent showCloseButton={!set.loading} className="sm:max-w-md">
        <form onSubmit={(e) => void submit(e)} className="contents">
          <DialogHeader>
            <DialogTitle>{`Roles of ${deviceLabel(device)}`}</DialogTitle>
          </DialogHeader>
          <FieldGroup>
            <RolePicker
              roles={roles}
              selected={selected}
              onChange={setSelected}
            />
          </FieldGroup>
          <TetherCommandAlert
            error={set.error}
            title="Could not save the roles"
          />
          <DialogFooter>
            <DialogClose
              render={<Button type="button" variant="outline" />}
              disabled={set.loading}
            >
              Cancel
            </DialogClose>
            <Button type="submit" disabled={set.loading}>
              Save roles
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
