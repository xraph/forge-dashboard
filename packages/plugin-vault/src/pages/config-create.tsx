import { useState } from "react"
import type { ComponentType, FormEvent } from "react"
import {
  PluginLink,
  useCommand,
  useNavigateTo,
} from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import {
  NativeSelect,
  NativeSelectOption,
} from "@forge-go/dashboard-kit/components/native-select"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { CommandAlert } from "@forge-go/dashboard-kit/components/query-boundary"
import { ValueInput } from "../components/value-input"
import { CONFIG_TYPES, isConfigType } from "../config-types"
import type { ConfigEntrySummary, ConfigType } from "../config-types"
import { configPath } from "../keys"

/** Mirrors the Go `configEntryResponse`. */
interface CreateResponse {
  entry: ConfigEntrySummary
}

/** The request body of `config.create`. Optional fields are left out, not empty. */
interface CreatePayload {
  key: string
  valueType: ConfigType
  value: unknown
  description?: string
}

/**
 * The create-config form.
 *
 * The value is typed, not text: an int sends a real number and a bool a real
 * boolean, because the server refuses a value that is not one of the entry's
 * type. The type is always sent (the server refuses a create without one).
 * `value` is `undefined` while the input holds no value, and submit waits for
 * one. Json is the plain mono textarea `ValueInput` draws: no code editor is
 * loaded on this route.
 */
export const ConfigCreatePage: ComponentType<PluginPageProps> = () => {
  const create = useCommand<CreateResponse>("config.create")
  const navigateTo = useNavigateTo()
  const [key, setKey] = useState("")
  const [valueType, setValueType] = useState<ConfigType>("string")
  const [value, setValue] = useState<unknown>(undefined)
  const [description, setDescription] = useState("")
  // The key as it was sent. A CONFLICT is about this key, not whatever the
  // field holds now, so its message and link must not follow later edits.
  const [submittedKey, setSubmittedKey] = useState("")

  const trimmedKey = key.trim()
  const canSubmit = !create.loading && trimmedKey !== "" && value !== undefined

  async function submit(event: FormEvent) {
    event.preventDefault()
    // Re-checked here: Enter in a field submits the form whatever the button
    // says.
    if (!canSubmit) return

    const payload: CreatePayload = { key: trimmedKey, valueType, value }
    const trimmedDescription = description.trim()
    if (trimmedDescription !== "") payload.description = trimmedDescription

    setSubmittedKey(trimmedKey)
    const result = await create.execute(payload)
    // execute resolves undefined only when the client throws, so this is the
    // failure check. Everything stays put for a retry.
    if (result === undefined) return
    navigateTo(configPath(trimmedKey))
  }

  const conflict = create.error?.code === "CONFLICT"

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="New config entry"
        description="Give it a key, a type and a value. Tenant overrides come after it exists."
      />
      <CommandAlert
        title="Could not create the entry"
        error={
          create.error && conflict
            ? {
                code: create.error.code,
                message: `A config entry with the key "${submittedKey}" already exists.`,
              }
            : create.error
        }
      />
      {conflict ? (
        <p className="text-sm">
          <PluginLink to={configPath(submittedKey)} className="underline">
            Open the existing entry
          </PluginLink>
        </p>
      ) : null}
      <form onSubmit={(e) => void submit(e)} className="flex max-w-lg flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="config-key">Key</Label>
          <Input
            id="config-key"
            className="font-mono"
            autoComplete="off"
            spellCheck={false}
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="config-type">Type</Label>
          <NativeSelect
            id="config-type"
            value={valueType}
            onChange={(e) => {
              const next = e.target.value
              if (!isConfigType(next)) return
              setValueType(next)
              // A value of one type is not a value of another.
              setValue(undefined)
            }}
          >
            {CONFIG_TYPES.map((t) => (
              <NativeSelectOption key={t} value={t}>
                {t}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label id="config-value-label" htmlFor="config-value">
            Value
          </Label>
          <ValueInput
            id="config-value"
            aria-labelledby="config-value-label"
            type={valueType}
            value={value}
            onChange={setValue}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="config-description">Description</Label>
          <Input
            id="config-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          <Button type="submit" disabled={!canSubmit}>
            {create.loading ? "Creating…" : "Create entry"}
          </Button>
          <PluginLink to="/config" className="text-sm underline self-center">
            Cancel
          </PluginLink>
        </div>
      </form>
    </div>
  )
}
