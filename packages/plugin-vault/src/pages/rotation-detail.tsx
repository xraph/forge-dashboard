import { IconButton } from "@forge-go/dashboard-kit/components/icon-button"
import { useState } from "react"
import type { ComponentType, FormEvent } from "react"
import { PluginLink, useCommand, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import {
  Button,
  buttonVariants,
} from "@forge-go/dashboard-kit/components/button"
import { Checkbox } from "@forge-go/dashboard-kit/components/checkbox"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { DescriptionList } from "@forge-go/dashboard-kit/components/detail-layout"
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
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { formatTimestamp } from "@forge-go/dashboard-kit/lib/format"
import { PolicyStatusBadge, RotatorBadge } from "../badges"
import { formatInterval } from "../interval"
import { secretPath } from "../keys"
import type { RotationPolicy } from "./rotation"

/** Mirrors the Go `RotationRecordSummary`. */
interface RotationRecord {
  id: string
  oldVersion: number
  newVersion: number
  rotatedBy?: string
  rotatedAt: string
}

/** Mirrors the Go `rotationDetailResponse`. `policy` is an explicit null. */
interface RotationDetail {
  policy: RotationPolicy | null
  rotatable: boolean
  records: RotationRecord[] | null
}

/** Mirrors the Go `rotationSavePolicyResponse`. */
interface SaveResponse {
  policy: RotationPolicy
}

/** Mirrors the Go `rotationDeletePolicyResponse`. */
interface DeleteResponse {
  ok: boolean
  key: string
}

/** Mirrors the Go `rotationRotateNowResponse`. */
interface RotateResponse {
  key: string
  oldVersion: number
  newVersion: number
}

type Unit = "hours" | "days"

const UNIT_SECONDS: Record<Unit, number> = { hours: 3600, days: 86400 }

/** The server refuses anything shorter: the loop only checks once a minute. */
const MIN_INTERVAL_SECONDS = 60

/**
 * A stored interval as the number and unit the form shows. Whole days show as
 * days, everything else as hours, possibly fractional, so an interval set by
 * another client survives a save that does not touch it.
 */
function seedInterval(seconds: number): { amount: string; unit: Unit } {
  if (seconds > 0 && seconds % UNIT_SECONDS.days === 0) {
    return { amount: String(seconds / UNIT_SECONDS.days), unit: "days" }
  }
  return { amount: String(seconds / UNIT_SECONDS.hours), unit: "hours" }
}

/** Whole seconds for what the operator typed, or undefined when it is not a number. */
function toSeconds(amount: string, unit: Unit): number | undefined {
  if (amount.trim() === "") return undefined
  const n = Number(amount)
  if (!Number.isFinite(n)) return undefined
  const seconds = Math.round(n * UNIT_SECONDS[unit])
  return Number.isSafeInteger(seconds) ? seconds : undefined
}

const recordColumns: Column<RotationRecord>[] = [
  {
    id: "rotatedAt",
    header: "Rotated at",
    cell: (r) => <Timestamp value={r.rotatedAt} label="rotation time" />,
  },
  {
    id: "versions",
    header: "Versions",
    className: "font-mono text-xs",
    cell: (r) => `v${r.oldVersion} → v${r.newVersion}`,
  },
  {
    id: "rotatedBy",
    header: "Rotated by",
    cell: (r) =>
      r.rotatedBy ? (
        <span className="font-mono text-xs">{r.rotatedBy}</span>
      ) : (
        <NoneCell label="user" />
      ),
  },
]

/**
 * The rotation page for one secret.
 *
 * `params.key` arrives already decoded by the router. It is split from the
 * body so a missing key renders a status line without the body's hooks ever
 * running: a hook cannot be skipped, and a query with no key would ask the
 * server about a secret called "".
 */
export const RotationDetailPage: ComponentType<PluginPageProps> = ({
  params,
}) => {
  const key = params.key
  if (!key) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        No secret key in the address, so there is nothing to show.
      </p>
    )
  }
  return <RotationDetailBody secretKey={key} />
}

function RotationDetailBody({ secretKey }: { secretKey: string }) {
  const detail = useQuery<RotationDetail>("rotation.detail", { key: secretKey })
  const save = useCommand<SaveResponse>("rotation.savePolicy")
  const remove = useCommand<DeleteResponse>("rotation.deletePolicy")
  const rotate = useCommand<RotateResponse>("rotation.rotateNow")

  const [rotating, setRotating] = useState(false)
  const [deleting, setDeleting] = useState(false)
  // Held here, above the boundary: a refetch after a command swaps the page
  // for a skeleton, and a result kept in the body's own state survives that.
  const [notice, setNotice] = useState<string | null>(null)

  function openRotate() {
    // Reset at open, not at close: the operator is about to read whatever the
    // dialog shows now, so an error from an earlier attempt must not greet them.
    rotate.reset()
    setRotating(true)
  }

  function openDelete() {
    remove.reset()
    setDeleting(true)
  }

  async function confirmRotate() {
    setNotice(null)
    const result = await rotate.execute({ key: secretKey })
    // execute() resolves undefined only when the client throws.
    if (result === undefined) return
    setRotating(false)
    setNotice(`Rotated from v${result.oldVersion} to v${result.newVersion}.`)
  }

  async function confirmDelete() {
    setNotice(null)
    const result = await remove.execute({ key: secretKey })
    if (result === undefined) return
    setDeleting(false)
    setNotice("Policy deleted.")
  }

  async function savePolicy(intervalSeconds: number, enabled: boolean) {
    setNotice(null)
    const result = await save.execute({
      key: secretKey,
      intervalSeconds,
      enabled,
    })
    if (result === undefined) return
    setNotice("Policy saved.")
  }

  return (
    <QueryBoundary title="Rotation" query={detail} skeletonRows={4}>
      {(data) => {
        const records = data.records ?? []
        const policy = data.policy
        return (
          <section className="flex flex-col gap-6">
            <PageHeader
              title={secretKey}
              description="Rotation policy and history for this secret."
              actions={
                <PluginLink
                  to={secretPath(secretKey)}
                  className={buttonVariants({ variant: "outline" })}
                >
                  View secret
                </PluginLink>
              }
            />

            {notice !== null && (
              <p role="status" className="text-sm font-medium">
                {notice}
              </p>
            )}

            <section className="flex flex-col gap-3">
              <h2 className="text-sm font-medium">Policy</h2>
              {policy !== null && <PolicySummary policy={policy} />}
              <CommandAlert
                error={save.error}
                title="Could not save the policy"
              />
              <PolicyForm
                // Remounts when the stored policy changes, so the fields show
                // what was saved and not what was typed before the refetch.
                key={
                  policy === null ? "new" : `${policy.id}:${policy.updatedAt}`
                }
                policy={policy}
                rotatable={data.rotatable}
                saving={save.loading}
                onSave={savePolicy}
              />
              {policy !== null && (
                <div>
                  <IconButton
                    variant="destructive"
                    onClick={openDelete}
                    label="Delete policy"
                  />
                </div>
              )}
            </section>

            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-medium">Rotate now</h2>
              <div className="flex flex-wrap items-center gap-3">
                <IconButton
                  disabled={!data.rotatable}
                  aria-describedby={
                    data.rotatable ? undefined : "rotate-unavailable"
                  }
                  onClick={openRotate}
                  label="Rotate now"
                />
                {!data.rotatable && (
                  <p
                    id="rotate-unavailable"
                    className="text-sm text-muted-foreground"
                  >
                    No rotator is registered for this secret. Rotators are
                    registered in application code, so this secret cannot be
                    rotated from here and a policy will not rotate it on
                    schedule.
                  </p>
                )}
              </div>
            </section>

            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-medium">Rotation history</h2>
              <ResourceTable<RotationRecord>
                columns={recordColumns}
                rows={records}
                rowKey={(r) => r.id}
                caption={`${records.length} ${records.length === 1 ? "rotation" : "rotations"}`}
                emptyMessage="No rotations recorded yet."
              />
            </section>

            <ConfirmDialog
              open={rotating}
              // Escape and the X go through here too. Closing mid-rotation
              // would unmount the dialog and hide a failure that arrives later.
              onOpenChange={(open) =>
                !open && !rotate.loading && setRotating(false)
              }
              title={`Rotate ${secretKey} now?`}
              description="This creates a new version of the secret. Applications must pick up the new value."
              confirmLabel="Rotate now"
              destructive={false}
              pending={rotate.loading}
              onConfirm={() => void confirmRotate()}
            >
              <CommandAlert error={rotate.error} title="Could not rotate" />
            </ConfirmDialog>
            <ConfirmDialog
              open={deleting}
              onOpenChange={(open) =>
                !open && !remove.loading && setDeleting(false)
              }
              title={`Delete the rotation policy for ${secretKey}?`}
              description="The secret and its versions are kept. It will no longer rotate on schedule."
              confirmLabel="Delete policy"
              pending={remove.loading}
              onConfirm={() => void confirmDelete()}
            >
              <CommandAlert
                error={remove.error}
                title="Could not delete the policy"
              />
            </ConfirmDialog>
          </section>
        )
      }}
    </QueryBoundary>
  )
}

function PolicySummary({ policy }: { policy: RotationPolicy }) {
  return (
    <DescriptionList
      items={[
        {
          term: "Interval",
          value: `Every ${formatInterval(policy.intervalSeconds)}`,
        },
        {
          term: "Status",
          value: <PolicyStatusBadge enabled={policy.enabled} />,
        },
        {
          term: "Rotator",
          value: <RotatorBadge rotatable={policy.rotatable} />,
        },
        {
          term: "Next rotation",
          // Only a policy that will really rotate shows a time: enabled, with
          // a rotator registered. Otherwise show "none" whatever the payload
          // carries rather than a time that will not happen.
          value: (
            <Timestamp
              value={
                policy.enabled && policy.rotatable
                  ? policy.nextRotationAt
                  : undefined
              }
              label="next rotation"
            />
          ),
        },
        {
          term: "Last rotated",
          value: (
            <Timestamp value={policy.lastRotatedAt} label="last rotation" />
          ),
        },
      ]}
    />
  )
}

/**
 * Create or edit. Seeded once from `policy`; the caller remounts it with a key
 * when the stored policy changes.
 */
function PolicyForm({
  policy,
  rotatable,
  saving,
  onSave,
}: {
  policy: RotationPolicy | null
  rotatable: boolean
  saving: boolean
  onSave: (intervalSeconds: number, enabled: boolean) => Promise<void>
}) {
  const seed = policy
    ? seedInterval(policy.intervalSeconds)
    : { amount: "1", unit: "days" as Unit }
  const [amount, setAmount] = useState(seed.amount)
  const [unit, setUnit] = useState<Unit>(seed.unit)
  const [enabled, setEnabled] = useState(policy ? policy.enabled : true)
  // The clock as of the last edit. Reading it in an event handler keeps render
  // pure; the preview says "about", so it need not tick.
  const [now, setNow] = useState(() => Date.now())

  const seconds = toSeconds(amount, unit)
  const tooShort = seconds !== undefined && seconds < MIN_INTERVAL_SECONDS
  const canSubmit = !saving && seconds !== undefined && !tooShort
  // Mirrors the server's savePolicy: only these give the policy a fresh due
  // time of now plus the interval. Any other save keeps the stored one.
  const resets =
    policy === null ||
    seconds !== policy.intervalSeconds ||
    (enabled && !policy.enabled) ||
    (enabled && !policy.nextRotationAt)

  function submit(event: FormEvent) {
    event.preventDefault()
    // Enter in a field submits even when the button is disabled.
    if (!canSubmit || seconds === undefined) return
    void onSave(seconds, enabled)
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3"
      aria-label="Rotation policy"
    >
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rotation-interval">Rotate every</Label>
          <Input
            id="rotation-interval"
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            className="w-28"
            value={amount}
            onChange={(e) => {
              setNow(Date.now())
              setAmount(e.target.value)
            }}
            aria-invalid={tooShort || undefined}
          />
        </div>
        <NativeSelect
          aria-label="Interval unit"
          value={unit}
          onChange={(e) => {
            setNow(Date.now())
            setUnit(e.target.value as Unit)
          }}
        >
          <NativeSelectOption value="hours">hours</NativeSelectOption>
          <NativeSelectOption value="days">days</NativeSelectOption>
        </NativeSelect>
      </div>
      {tooShort && (
        <p role="alert" className="text-sm text-destructive">
          The interval must be at least {MIN_INTERVAL_SECONDS} seconds. Due
          policies are checked once a minute, so a shorter interval cannot be
          honoured.
        </p>
      )}
      <div className="flex items-center gap-2">
        <Checkbox
          id="rotation-enabled"
          checked={enabled}
          onCheckedChange={(checked) => {
            setNow(Date.now())
            setEnabled(checked === true)
          }}
        />
        <Label htmlFor="rotation-enabled">Enable this policy</Label>
      </div>
      {rotatable && enabled && seconds !== undefined && !tooShort && (
        <p className="text-sm text-muted-foreground">
          {resets ? (
            <>
              This secret will rotate every {formatInterval(seconds)}, next at
              about{" "}
              {formatTimestamp(new Date(now + seconds * 1000).toISOString())}.
            </>
          ) : (
            <>
              Saving keeps the next rotation at{" "}
              {formatTimestamp(policy?.nextRotationAt)}. This secret rotates
              every {formatInterval(seconds)}.
            </>
          )}{" "}
          Applications must pick up each new value.
        </p>
      )}
      <div>
        <Button type="submit" disabled={!canSubmit}>
          {saving ? "Saving…" : policy ? "Save policy" : "Create policy"}
        </Button>
      </div>
    </form>
  )
}
