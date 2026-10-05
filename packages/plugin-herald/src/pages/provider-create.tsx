import { useState } from "react"
import type { ComponentType, FormEvent } from "react"
import { PluginLink, useCommand, useNavigateTo } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Checkbox } from "@forge-go/dashboard-kit/components/checkbox"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { NativeSelect, NativeSelectOption } from "@forge-go/dashboard-kit/components/native-select"
import { CommandAlert, QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { Switch } from "@forge-go/dashboard-kit/components/switch"
import { HeraldHeader, useEngineInfo } from "../components/herald-header"
import { SecretInput, useSecretFields } from "../components/secret-fields"
import { providerPath } from "../keys"
import type { EngineInfoResponse, FieldInfo, ProviderResponse, ProvidersCreateRequest } from "../wire"

interface FreeRow {
  rowId: number
  key: string
  secret: boolean
  value: string
}

function FieldHelp({ field }: { field: FieldInfo }) {
  return field.help ? <p className="text-xs text-muted-foreground">{field.help}</p> : null
}

function CreateForm({ engine }: { engine: EngineInfoResponse }) {
  const create = useCommand<ProviderResponse>("providers.create")
  const navigateTo = useNavigateTo()
  const secrets = useSecretFields()
  const [name, setName] = useState("")
  const [channel, setChannel] = useState("")
  const [driverName, setDriverName] = useState("")
  const [priority, setPriority] = useState("0")
  const [enabled, setEnabled] = useState(true)
  const [values, setValues] = useState<Record<string, string>>({})
  const [rows, setRows] = useState<FreeRow[]>([])
  const [nextRow, setNextRow] = useState(1)

  const channels = engine.channels.filter((c) => engine.drivers.some((d) => d.channel === c))
  const drivers = engine.drivers.filter((d) => d.channel === channel)
  const driver = drivers.find((d) => d.name === driverName)
  const fields = driver?.fields ?? null
  const priorityNumber = Number(priority)
  const missing = (fields ?? []).filter((f) => f.required && (f.secret ? !secrets.filled.has(f.key) : (values[f.key] ?? "").trim() === ""))
  const rowKeys = rows.map((r) => r.key.trim())
  const rowsValid = rowKeys.every((k) => k !== "") && new Set(rowKeys).size === rowKeys.length
  const canSubmit = !create.loading && name.trim() !== "" && driver !== undefined && priority.trim() !== "" && Number.isInteger(priorityNumber) && missing.length === 0 && rowsValid

  function pickChannel(next: string) {
    secrets.clear()
    setChannel(next)
    setDriverName("")
    setValues({})
    setRows([])
  }

  function pickDriver(next: string) {
    secrets.clear()
    setDriverName(next)
    setValues({})
    setRows([])
  }

  function updateRow(rowId: number, change: Partial<FreeRow>) {
    setRows((prev) => prev.map((r) => (r.rowId === rowId ? { ...r, ...change, ...(change.secret !== undefined ? { value: "" } : {}) } : r)))
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!canSubmit || !driver) return
    const secretValues = secrets.read()
    const credentials: Record<string, string> = {}
    const settings: Record<string, string> = {}
    if (fields) {
      for (const f of fields) {
        if (f.secret) {
          if (secretValues[f.key]) credentials[f.key] = secretValues[f.key]
          continue
        }
        const value = (values[f.key] ?? "").trim()
        if (value === "") continue
        if (f.placement === "setting") settings[f.key] = value
        else credentials[f.key] = value
      }
    } else {
      for (const r of rows) {
        const key = r.key.trim()
        if (r.secret) {
          const value = secretValues[`row-${r.rowId}`]
          if (value) credentials[key] = value
        } else if (r.value.trim() !== "") {
          settings[key] = r.value.trim()
        }
      }
    }
    const payload: ProvidersCreateRequest = { name: name.trim(), channel, driver: driver.name, priority: priorityNumber, enabled }
    if (Object.keys(credentials).length > 0) payload.credentials = credentials
    if (Object.keys(settings).length > 0) payload.settings = settings
    const result = await create.execute(payload)
    // undefined means the client threw: every value stays put for a retry.
    if (result === undefined) return
    secrets.clear()
    navigateTo(providerPath(result.provider.id))
  }

  const settingFields = (fields ?? []).filter((f) => f.placement === "setting")
  const credentialFields = (fields ?? []).filter((f) => f.placement === "credential")

  function renderField(f: FieldInfo) {
    const id = `field-${f.key}`
    return (
      <div key={f.key} className="flex flex-col gap-1.5">
        {/* The asterisk sits beside the label, not in it, so the field's accessible name stays "Host". */}
        <div className="flex items-center gap-1">
          <Label htmlFor={id}>{f.label}</Label>
          {f.required && (
            <span aria-hidden="true" className="text-sm text-muted-foreground">
              *
            </span>
          )}
        </div>
        {f.secret ? (
          <SecretInput id={id} name={f.key} secrets={secrets} aria-required={f.required || undefined} />
        ) : (
          <Input
            id={id}
            className="font-mono"
            autoComplete="off"
            spellCheck={false}
            aria-required={f.required || undefined}
            value={values[f.key] ?? ""}
            onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
          />
        )}
        <FieldHelp field={f} />
      </div>
    )
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="flex max-w-xl flex-col gap-5">
      <CommandAlert error={create.error} title="Could not create the provider" />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="provider-name">Name</Label>
        <Input id="provider-name" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="provider-channel">Channel</Label>
          <NativeSelect id="provider-channel" value={channel} onChange={(e) => pickChannel(e.target.value)}>
            <NativeSelectOption value="">Choose a channel</NativeSelectOption>
            {channels.map((c) => (
              <NativeSelectOption key={c} value={c}>
                {c}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="provider-driver">Driver</Label>
          <NativeSelect id="provider-driver" value={driverName} disabled={channel === ""} onChange={(e) => pickDriver(e.target.value)}>
            <NativeSelectOption value="">{channel === "" ? "Choose a channel first" : "Choose a driver"}</NativeSelectOption>
            {drivers.map((d) => (
              <NativeSelectOption key={d.name} value={d.name}>
                {d.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="provider-priority">Priority</Label>
          <Input id="provider-priority" inputMode="numeric" className="font-mono" value={priority} onChange={(e) => setPriority(e.target.value)} />
          <p className="text-xs text-muted-foreground">Lower goes first when no routing rule picks a provider.</p>
        </div>
        <div className="flex items-center gap-2 self-center">
          <Switch id="provider-enabled" aria-label="Enabled" checked={enabled} onCheckedChange={setEnabled} />
          <span className="text-sm">Enabled</span>
        </div>
      </div>

      {driver && fields && fields.length === 0 && <p className="text-sm text-muted-foreground">This driver needs no settings or credentials.</p>}

      {driver && settingFields.length > 0 && (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-medium">Settings</legend>
          {settingFields.map(renderField)}
        </fieldset>
      )}
      {driver && credentialFields.length > 0 && (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-medium">Credentials</legend>
          <p className="text-xs text-muted-foreground">Write-only. Once saved, a credential can be replaced or removed, never shown.</p>
          {credentialFields.map(renderField)}
        </fieldset>
      )}

      {driver && fields === null && (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-medium">Fields</legend>
          <p className="text-sm text-muted-foreground">
            This driver has no field schema, so Herald can't tell settings from secrets. Mark each secret: secrets are stored as credentials and never shown again, the rest as settings.
          </p>
          {rows.map((r, i) => (
            <div key={r.rowId} className="grid items-end gap-2 sm:grid-cols-[1fr_auto_1fr_auto]">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`row-key-${r.rowId}`}>{`Key, field ${i + 1}`}</Label>
                <Input id={`row-key-${r.rowId}`} className="font-mono" value={r.key} onChange={(e) => updateRow(r.rowId, { key: e.target.value })} />
              </div>
              <div className="flex items-center gap-2 pb-2">
                <Checkbox aria-label={`Secret, field ${i + 1}`} checked={r.secret} onCheckedChange={(checked) => updateRow(r.rowId, { secret: checked === true })} />
                <span className="text-sm" aria-hidden="true">
                  Secret
                </span>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`row-value-${r.rowId}`}>{`Value, field ${i + 1}`}</Label>
                {r.secret ? (
                  <SecretInput id={`row-value-${r.rowId}`} name={`row-${r.rowId}`} secrets={secrets} />
                ) : (
                  <Input id={`row-value-${r.rowId}`} className="font-mono" value={r.value} onChange={(e) => updateRow(r.rowId, { value: e.target.value })} />
                )}
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => setRows((prev) => prev.filter((x) => x.rowId !== r.rowId))}>
                Remove
              </Button>
            </div>
          ))}
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setRows((prev) => [...prev, { rowId: nextRow, key: "", secret: false, value: "" }])
                setNextRow((n) => n + 1)
              }}
            >
              Add a field
            </Button>
          </div>
        </fieldset>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={!canSubmit}>
          {create.loading ? "Creating…" : "Create provider"}
        </Button>
        <PluginLink to="/providers" className="text-sm underline">
          Cancel
        </PluginLink>
      </div>
    </form>
  )
}

export const ProviderCreatePage: ComponentType<PluginPageProps> = () => {
  const info = useEngineInfo()
  return (
    <section className="flex flex-col gap-4">
      <HeraldHeader title="New provider" description="The fields come from the driver. Credentials are write-only: once saved, you can replace them, never read them back." />
      <QueryBoundary title="Drivers" query={info} skeletonRows={4}>
        {(engine) => <CreateForm engine={engine} />}
      </QueryBoundary>
    </section>
  )
}

export default ProviderCreatePage
