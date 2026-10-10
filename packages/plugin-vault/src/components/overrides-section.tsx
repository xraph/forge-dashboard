import { IconButton } from "@forge-go/dashboard-kit/components/icon-button"
import { useState } from "react"
import type { FormEvent } from "react"
import { useCommand } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@forge-go/dashboard-kit/components/dialog"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { CommandAlert } from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { WrongTypeBadge } from "../badges"
import { isConfigType } from "../config-types"
import type {
  ConfigEntrySummary,
  ConfigType,
  OverrideSummary,
} from "../config-types"
import { sameJson } from "../json-text"
import { ConfigValue } from "./config-value"
import { useRevertOverride } from "./revert-override"
import { ValueInput } from "./value-input"

/** Mirrors the Go `overridesSetResponse`. */
interface SetOverrideResponse {
  override: OverrideSummary
}

/**
 * One dialog is open at a time: adding, or changing one tenant's. The tenant
 * stays with the change so its closing frame keeps its title.
 */
type Open = { mode: "add" } | { mode: "change"; override: OverrideSummary }

const unsupportedId = "config-overrides-unsupported"

/**
 * The tenant overrides of one entry: each tenant's value in place of the app
 * default, with Change and "Revert to app default" per row, and Add override.
 *
 * Reverting deletes the override and the tenant falls back to the entry's
 * value. It is a different act from setting an override to an empty value,
 * which is allowed for a string entry and stays an override; the two never
 * share words.
 *
 * An entry whose type the vault does not validate cannot take a value here
 * (the server would refuse it and the input has no shape to offer), so Add and
 * Change are disabled with the reason, and Revert, which needs no value, is
 * not.
 */
export function OverridesSection({
  entry,
  overrides,
}: {
  entry: ConfigEntrySummary
  overrides: OverrideSummary[]
}) {
  const type = isConfigType(entry.valueType) ? entry.valueType : undefined
  const [open, setOpen] = useState<Open | null>(null)
  const revert = useRevertOverride()

  const columns: Column<OverrideSummary>[] = [
    {
      id: "tenant",
      header: "Tenant",
      className: "font-mono text-xs font-medium",
      cell: (o) => o.tenantId,
    },
    {
      id: "value",
      header: "Value",
      cell: (o) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <ConfigValue value={o.value} valueType={entry.valueType} />
          {o.valueMatchesType ? null : <WrongTypeBadge />}
        </span>
      ),
    },
    {
      id: "updated",
      header: "Updated",
      cell: (o) => <Timestamp value={o.updatedAt} label="update time" />,
    },
  ]

  const count = `${overrides.length} tenant override${overrides.length === 1 ? "" : "s"}`

  return (
    <section className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium">Overrides</h2>
        <Button
          variant="outline"
          size="sm"
          disabled={type === undefined}
          aria-describedby={type === undefined ? unsupportedId : undefined}
          onClick={() => setOpen({ mode: "add" })}
        >
          Add override
        </Button>
      </div>
      {type === undefined ? (
        <p id={unsupportedId} className="text-sm text-muted-foreground">
          {`This entry's type, ${entry.valueType}, is not one the vault validates, so overrides cannot be set here.`}
        </p>
      ) : null}
      <ResourceTable
        columns={columns}
        rows={overrides}
        rowKey={(o) => o.tenantId}
        caption={count}
        emptyMessage="No tenant overrides."
        rowActions={(o) => (
          <>
            <Button
              variant="ghost"
              size="xs"
              aria-label={`Change the override for ${o.tenantId}`}
              disabled={type === undefined}
              aria-describedby={type === undefined ? unsupportedId : undefined}
              onClick={() => setOpen({ mode: "change", override: o })}
            >
              Change
            </Button>
            <IconButton
              variant="outline"
              onClick={() =>
                revert.request(
                  entry.key,
                  o.tenantId,
                  <>
                    {`Tenant ${o.tenantId} goes back to the app default, `}
                    <ConfigValue
                      value={entry.value}
                      valueType={entry.valueType}
                    />
                    {"."}
                  </>
                )
              }
              label={`Revert to app default for ${o.tenantId}`}
            />
          </>
        )}
      />

      {open !== null && type !== undefined && (
        <OverrideDialog
          entry={entry}
          type={type}
          existing={open.mode === "change" ? open.override : undefined}
          onClose={() => setOpen(null)}
        />
      )}
      {revert.dialog}
    </section>
  )
}

/**
 * Adds an override, or changes one. Mounted fresh on each open, so its command
 * starts with no error and its fields with what they should hold, and it
 * cannot outlive a change of entry.
 *
 * `overrides.set` replaces whatever the tenant had, so adding for a tenant that
 * already has an override is a change, and the dialog says so.
 */
function OverrideDialog({
  entry,
  type,
  existing,
  onClose,
}: {
  entry: ConfigEntrySummary
  type: ConfigType
  existing: OverrideSummary | undefined
  onClose: () => void
}) {
  const set = useCommand<SetOverrideResponse>("overrides.set")
  const [tenantId, setTenantId] = useState(existing?.tenantId ?? "")
  // A stored override that is not a value of the type is not offered back as if
  // it were one: the field starts empty and save waits for a real value.
  const [value, setValue] = useState<unknown>(
    existing !== undefined && existing.valueMatchesType
      ? existing.value
      : undefined
  )
  const tenant = tenantId.trim()

  const canSubmit =
    tenant !== "" &&
    value !== undefined &&
    // A change that changes nothing is not sent.
    !(existing !== undefined && sameJson(value, existing.value))

  async function submit(event: FormEvent) {
    event.preventDefault()
    // Enter in a field submits even when the button is disabled.
    if (!canSubmit || set.loading) return
    const result = await set.execute({
      key: entry.key,
      tenantId: tenant,
      value,
    })
    // undefined means the client threw. Everything stays put for a retry.
    if (result === undefined) return
    onClose()
  }

  return (
    <Dialog open onOpenChange={(next) => !next && !set.loading && onClose()}>
      <DialogContent>
        <form
          onSubmit={(e) => void submit(e)}
          className="flex min-w-0 flex-col gap-4"
        >
          <DialogHeader>
            <DialogTitle>
              {existing === undefined
                ? `Add a tenant override for ${entry.key}`
                : `Change the override for ${existing.tenantId}`}
            </DialogTitle>
            <DialogDescription>
              {existing === undefined
                ? "The tenant gets this value instead of the app default. An override that already exists for the tenant is replaced."
                : `Tenant ${existing.tenantId} gets this value instead of the app default.`}
            </DialogDescription>
          </DialogHeader>
          <CommandAlert error={set.error} title="Could not save the override" />
          {existing === undefined ? (
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor="override-tenant">Tenant ID</Label>
              <Input
                id="override-tenant"
                className="font-mono"
                autoComplete="off"
                spellCheck={false}
                value={tenantId}
                onChange={(e) => setTenantId(e.target.value)}
              />
            </div>
          ) : null}
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label id="override-value-label" htmlFor="override-value">
              Value
            </Label>
            <ValueInput
              id="override-value"
              aria-labelledby="override-value-label"
              type={type}
              value={value}
              // Nothing is reported for a stored value that is not valid: it
              // must not be rewritten to "" behind the operator's back.
              reportEmptyOnMount={
                existing === undefined || existing.valueMatchesType
              }
              onChange={setValue}
            />
            {type === "string" ? (
              <p className="text-xs text-muted-foreground">
                An empty value is still an override: the tenant gets the empty
                string. To remove the override, use the button on its row.
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={set.loading}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit || set.loading}>
              {set.loading ? "Saving…" : "Save override"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
