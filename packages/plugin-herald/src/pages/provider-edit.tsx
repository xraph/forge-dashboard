import { useState } from "react"
import type { ComponentType, FormEvent } from "react"
import { PluginLink, useCommand, useNavigateTo, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { CommandAlert, QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { Switch } from "@forge-go/dashboard-kit/components/switch"
import { ProtectionBadge } from "../badges"
import { HeraldHeader, useEngineInfo } from "../components/herald-header"
import { SecretInput, useSecretFields } from "../components/secret-fields"
import { providerPath } from "../keys"
import type { EngineInfoResponse, FieldInfo, ProviderDetail, ProviderResponse, ProvidersDetailResponse, ProvidersUpdateRequest } from "../wire"

const TARGETS = ["base_url", "host"]

function EditForm({ provider, engine }: { provider: ProviderDetail; engine: EngineInfoResponse }) {
  const update = useCommand<ProviderResponse>("providers.update")
  const navigateTo = useNavigateTo()
  const secrets = useSecretFields()
  const schema = engine.drivers.find((d) => d.name === provider.driver)?.fields ?? null
  const schemaless = schema === null || schema.length === 0
  const fieldOf = (key: string): FieldInfo | undefined => schema?.find((f) => f.key === key)

  const storedSettings = provider.settings
  const storedSettingKeys = new Set(storedSettings.map((s) => s.key))
  const storedCredKeys = new Set(provider.credentials.map((c) => c.key))
  const newSettingFields = (schema ?? []).filter((f) => f.placement === "setting" && !storedSettingKeys.has(f.key))
  const newCredentialFields = (schema ?? []).filter((f) => f.placement === "credential" && !storedCredKeys.has(f.key))

  const [name, setName] = useState(provider.name)
  const [priority, setPriority] = useState(String(provider.priority))
  const [enabled, setEnabled] = useState(provider.enabled)
  const [settingDrafts, setSettingDrafts] = useState<Record<string, string>>(() => Object.fromEntries(storedSettings.filter((s) => !s.secret).map((s) => [s.key, s.value ?? ""])))
  const [newValues, setNewValues] = useState<Record<string, string>>({})
  const [replacing, setReplacing] = useState<ReadonlySet<string>>(new Set())
  const [removing, setRemoving] = useState<ReadonlySet<string>>(new Set())

  const toggle = (set: ReadonlySet<string>, key: string): Set<string> => {
    const next = new Set(set)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  }

  // What would change, from state only: secrets count by whether their field
  // is filled, never by their value.
  const settingChanged = (key: string, original: string) => (settingDrafts[key] ?? "").trim() !== original
  const changedSettings = storedSettings.filter((s) => !s.secret && settingChanged(s.key, s.value ?? ""))
  const newSettingsFilled = newSettingFields.filter((f) => (f.secret ? secrets.filled.has(`setting:${f.key}`) : (newValues[`setting:${f.key}`] ?? "").trim() !== ""))
  const newCredsFilled = newCredentialFields.filter((f) => (f.secret ? secrets.filled.has(`cred:${f.key}`) : (newValues[`cred:${f.key}`] ?? "").trim() !== ""))
  const replacedFilled = [...replacing].filter((key) => secrets.filled.has(key.startsWith("setting:") ? key : `cred:${key}`))
  const hasChanges =
    name.trim() !== provider.name ||
    Number(priority) !== provider.priority ||
    enabled !== provider.enabled ||
    changedSettings.length > 0 ||
    newSettingsFilled.length > 0 ||
    newCredsFilled.length > 0 ||
    replacedFilled.length > 0 ||
    removing.size > 0

  // Mirrors the server's rule: moving where the driver connects needs every
  // stored secret entered again, or the next send would hand them to the new
  // server. The server refuses it too; this just says so before you press Save.
  const moved = TARGETS.filter((target) => {
    const stored = storedSettings.find((s) => s.key === target)
    if (stored?.secret) return secrets.filled.has(`setting:${target}`)
    const draft = stored ? (settingDrafts[target] ?? "").trim() : (newValues[`setting:${target}`] ?? "").trim()
    return draft !== "" && draft !== (stored?.value ?? "")
  })
  const mustReenter = provider.credentials
    .map((c) => c.key)
    .filter((key) => (schemaless || fieldOf(key)?.secret === true) && !removing.has(key) && !secrets.filled.has(`cred:${key}`))
    .sort()
  const blockedByMove = moved.length > 0 && mustReenter.length > 0

  const canSubmit = !update.loading && hasChanges && !blockedByMove && name.trim() !== "" && priority.trim() !== "" && Number.isInteger(Number(priority))

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!canSubmit) return
    const secretValues = secrets.read()
    const payload: ProvidersUpdateRequest = { id: provider.id }
    if (name.trim() !== provider.name) payload.name = name.trim()
    if (Number(priority) !== provider.priority) payload.priority = Number(priority)
    if (enabled !== provider.enabled) payload.enabled = enabled
    const setSettings: Record<string, string> = {}
    const removeSettings: string[] = []
    const setCredentials: Record<string, string> = {}
    const removeCredentials: string[] = []
    for (const s of storedSettings) {
      if (s.secret) {
        if (removing.has(`setting:${s.key}`)) removeSettings.push(s.key)
        else if (secretValues[`setting:${s.key}`]) setSettings[s.key] = secretValues[`setting:${s.key}`]
        continue
      }
      const draft = (settingDrafts[s.key] ?? "").trim()
      if (draft === (s.value ?? "")) continue
      if (draft === "") removeSettings.push(s.key)
      else setSettings[s.key] = draft
    }
    for (const f of newSettingFields) {
      const value = f.secret ? secretValues[`setting:${f.key}`] : (newValues[`setting:${f.key}`] ?? "").trim()
      if (value) setSettings[f.key] = value
    }
    for (const c of provider.credentials) {
      if (removing.has(c.key)) removeCredentials.push(c.key)
      else if (secretValues[`cred:${c.key}`]) setCredentials[c.key] = secretValues[`cred:${c.key}`]
    }
    for (const f of newCredentialFields) {
      const value = f.secret ? secretValues[`cred:${f.key}`] : (newValues[`cred:${f.key}`] ?? "").trim()
      if (value) setCredentials[f.key] = value
    }
    if (Object.keys(setSettings).length > 0) payload.setSettings = setSettings
    if (removeSettings.length > 0) payload.removeSettings = removeSettings
    if (Object.keys(setCredentials).length > 0) payload.setCredentials = setCredentials
    if (removeCredentials.length > 0) payload.removeCredentials = removeCredentials
    const result = await update.execute(payload)
    if (result === undefined) return
    secrets.clear()
    navigateTo(providerPath(provider.id))
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="flex max-w-2xl flex-col gap-5">
      <CommandAlert error={update.error} title="Could not save the provider" />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="provider-name">Name</Label>
          <Input id="provider-name" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="provider-priority">Priority</Label>
          <Input id="provider-priority" inputMode="numeric" className="font-mono" value={priority} onChange={(e) => setPriority(e.target.value)} />
        </div>
        <div className="flex items-center gap-2">
          <Switch id="provider-enabled" aria-label="Enabled" checked={enabled} onCheckedChange={setEnabled} />
          <span className="text-sm">Enabled</span>
        </div>
        <p className="text-sm text-muted-foreground">
          Channel {provider.channel} and driver <span className="font-mono text-xs">{provider.driver}</span> can't change. Create a new provider for another driver.
        </p>
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-medium">Settings</legend>
        {storedSettings.map((s) => {
          const field = fieldOf(s.key)
          const id = `setting-${s.key}`
          if (s.secret) {
            const key = `setting:${s.key}`
            return (
              <div key={s.key} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-mono text-xs">{s.key}</span>
                <span className="text-muted-foreground">{removing.has(key) ? "Will be removed" : "Hidden"}</span>
                <Button type="button" size="xs" variant="outline" onClick={() => setReplacing((r) => toggle(r, key))}>
                  {replacing.has(key) ? "Keep" : `Replace ${s.key}`}
                </Button>
                <Button type="button" size="xs" variant="ghost" onClick={() => setRemoving((r) => toggle(r, key))}>
                  {removing.has(key) ? "Undo" : `Remove ${s.key}`}
                </Button>
                {replacing.has(key) && !removing.has(key) && <SecretInput aria-label={`New value for ${s.key}`} name={key} secrets={secrets} />}
              </div>
            )
          }
          return (
            <div key={s.key} className="flex flex-col gap-1.5">
              <Label htmlFor={id}>{field?.label ?? s.key}</Label>
              <Input id={id} className="font-mono" autoComplete="off" spellCheck={false} value={settingDrafts[s.key] ?? ""} onChange={(e) => setSettingDrafts((d) => ({ ...d, [s.key]: e.target.value }))} />
              {field?.help && <p className="text-xs text-muted-foreground">{field.help}</p>}
              {(settingDrafts[s.key] ?? "").trim() === "" && <p className="text-xs text-muted-foreground">Empty removes this setting.</p>}
            </div>
          )
        })}
        {newSettingFields.map((f) => (
          <div key={f.key} className="flex flex-col gap-1.5">
            <Label htmlFor={`setting-${f.key}`}>{f.label}</Label>
            {f.secret ? (
              <SecretInput id={`setting-${f.key}`} name={`setting:${f.key}`} secrets={secrets} />
            ) : (
              <Input id={`setting-${f.key}`} className="font-mono" autoComplete="off" spellCheck={false} value={newValues[`setting:${f.key}`] ?? ""} onChange={(e) => setNewValues((v) => ({ ...v, [`setting:${f.key}`]: e.target.value }))} />
            )}
            {f.help && <p className="text-xs text-muted-foreground">{f.help}</p>}
          </div>
        ))}
        {storedSettings.length === 0 && newSettingFields.length === 0 && <p className="text-sm text-muted-foreground">No settings.</p>}
      </fieldset>

      {blockedByMove && (
        <p role="status" className="rounded-md border px-3 py-2 text-sm">
          Changing {moved.join(" and ")} sends credentials to a new server, so enter {mustReenter.join(", ")} again in this update, or remove {mustReenter.length === 1 ? "it" : "them"}.
        </p>
      )}

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-medium">Credentials</legend>
        <p className="text-xs text-muted-foreground">Write-only. Replace or remove a credential; its value is never shown.</p>
        {provider.credentials.length > 0 && (
          <table className="w-full text-sm" aria-label="Stored credentials">
            <tbody>
              {provider.credentials.map((c) => (
                <tr key={c.key} className="border-b last:border-0">
                  <td className="py-2 font-mono text-xs">{c.key}</td>
                  <td className="py-2">
                    <ProtectionBadge protection={c.protection} />
                  </td>
                  <td className="py-2">
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {removing.has(c.key) ? <span className="text-muted-foreground">Will be removed</span> : null}
                      <Button type="button" size="xs" variant="outline" disabled={removing.has(c.key)} onClick={() => setReplacing((r) => toggle(r, c.key))}>
                        {replacing.has(c.key) ? "Keep" : `Replace ${c.key}`}
                      </Button>
                      <Button type="button" size="xs" variant="ghost" onClick={() => setRemoving((r) => toggle(r, c.key))}>
                        {removing.has(c.key) ? "Undo" : `Remove ${c.key}`}
                      </Button>
                    </div>
                    {replacing.has(c.key) && !removing.has(c.key) && (
                      <div className="mt-2">
                        <SecretInput aria-label={`New value for ${c.key}`} name={`cred:${c.key}`} secrets={secrets} />
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {newCredentialFields.map((f) => (
          <div key={f.key} className="flex flex-col gap-1.5">
            <Label htmlFor={`cred-${f.key}`}>{f.label}</Label>
            {f.secret ? (
              <SecretInput id={`cred-${f.key}`} name={`cred:${f.key}`} secrets={secrets} />
            ) : (
              <Input id={`cred-${f.key}`} className="font-mono" autoComplete="off" spellCheck={false} value={newValues[`cred:${f.key}`] ?? ""} onChange={(e) => setNewValues((v) => ({ ...v, [`cred:${f.key}`]: e.target.value }))} />
            )}
            {f.help && <p className="text-xs text-muted-foreground">{f.help}</p>}
          </div>
        ))}
        {provider.credentials.length === 0 && newCredentialFields.length === 0 && <p className="text-sm text-muted-foreground">No credentials.</p>}
      </fieldset>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={!canSubmit}>
          {update.loading ? "Saving…" : "Save changes"}
        </Button>
        <PluginLink to={providerPath(provider.id)} className="text-sm underline">
          Cancel
        </PluginLink>
      </div>
    </form>
  )
}

function EditBody({ id }: { id: string }) {
  const info = useEngineInfo()
  const detail = useQuery<ProvidersDetailResponse>("providers.detail", { id })
  /*
   * The form is not inside the detail query's boundary. Saving invalidates
   * providers.detail, the host re-issues it, and the boundary would swap the
   * form for a skeleton: its inputs, and any secret typed into them, would be
   * gone before a failed save could be retried, and a success would be
   * navigating from a form that no longer exists. So the first answer is
   * taken as a snapshot and the form is built from that, whatever the query
   * does next. Only the very first load, or its failure, goes through the
   * boundary. The header sits outside everything so every state names the app.
   */
  const [snapshot, setSnapshot] = useState<ProviderDetail | null>(null)
  if (snapshot === null && detail.data) setSnapshot(detail.data.provider)
  return (
    <section className="flex flex-col gap-4">
      <HeraldHeader title={snapshot ? `Edit ${snapshot.name}` : "Edit provider"} description="Only what you change is sent. A credential you leave alone stays as it is." />
      {snapshot ? (
        <QueryBoundary title="Drivers" query={info} skeletonRows={3}>
          {(engine) => <EditForm provider={snapshot} engine={engine} />}
        </QueryBoundary>
      ) : (
        <QueryBoundary title="Provider" query={detail} skeletonRows={5}>
          {() => null}
        </QueryBoundary>
      )}
    </section>
  )
}

export const ProviderEditPage: ComponentType<PluginPageProps> = ({ params }) => {
  const id = params.id
  if (!id) {
    return (
      <section className="flex flex-col gap-4">
        <HeraldHeader title="Edit provider" />
        <p role="status" className="text-sm text-muted-foreground">
          No provider ID in the address, so there is nothing to edit.
        </p>
      </section>
    )
  }
  // Keyed by id so a different provider never inherits another's snapshot.
  return <EditBody key={id} id={id} />
}

export default ProviderEditPage
