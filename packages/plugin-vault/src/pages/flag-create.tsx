import { useState } from "react"
import type { ComponentType, FormEvent } from "react"
import {
  PluginLink,
  useCommand,
  useNavigateTo,
} from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Checkbox } from "@forge-go/dashboard-kit/components/checkbox"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import {
  NativeSelect,
  NativeSelectOption,
} from "@forge-go/dashboard-kit/components/native-select"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { CommandAlert } from "@forge-go/dashboard-kit/components/query-boundary"
import { ValueInput } from "../components/value-input"
import { FLAG_TYPES, isFlagType } from "../flag-types"
import type { FlagType } from "../flag-types"
import { flagPath } from "../keys"
import type { FlagSummary } from "./flags"

/** Mirrors the Go `flagResponse`. */
interface CreateResponse {
  flag: FlagSummary
}

/** The request body of `flags.create`. Optional fields are left out, not empty. */
interface CreatePayload {
  key: string
  type: FlagType
  defaultValue: unknown
  description?: string
  tags?: string[]
  enabled: boolean
}

/** "a, b ,, c" becomes ["a", "b", "c"]. */
function parseTags(text: string): string[] {
  return text
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t !== "")
}

/**
 * The create-flag form.
 *
 * The default is typed, not text: a bool sends a real boolean and an int a
 * real number, because the server refuses a default that is not a value of the
 * flag's type. `defaultValue` is `undefined` while the input holds no value,
 * and submit waits for one. `null` is a value (a json flag may default to it).
 */
export const FlagCreatePage: ComponentType<PluginPageProps> = () => {
  const create = useCommand<CreateResponse>("flags.create")
  const navigateTo = useNavigateTo()
  const [key, setKey] = useState("")
  const [type, setType] = useState<FlagType>("bool")
  const [defaultValue, setDefaultValue] = useState<unknown>(undefined)
  const [description, setDescription] = useState("")
  const [tags, setTags] = useState("")
  const [enabled, setEnabled] = useState(true)
  // The key as it was sent. A CONFLICT is about this key, not whatever the
  // field holds now, so its message and link must not follow later edits.
  const [submittedKey, setSubmittedKey] = useState("")

  const trimmedKey = key.trim()
  const canSubmit =
    !create.loading && trimmedKey !== "" && defaultValue !== undefined

  async function submit(event: FormEvent) {
    event.preventDefault()
    // Re-checked here: Enter in a field submits the form whatever the button
    // says.
    if (!canSubmit) return

    const payload: CreatePayload = {
      key: trimmedKey,
      type,
      defaultValue,
      enabled,
    }
    const trimmedDescription = description.trim()
    if (trimmedDescription !== "") payload.description = trimmedDescription
    const tagList = parseTags(tags)
    if (tagList.length > 0) payload.tags = tagList

    setSubmittedKey(trimmedKey)
    const result = await create.execute(payload)
    // execute resolves undefined only when the client throws, so this is the
    // failure check. Everything stays put for a retry.
    if (result === undefined) return
    navigateTo(flagPath(trimmedKey))
  }

  const conflict = create.error?.code === "CONFLICT"

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="New flag"
        description="Give it a key, a type and a default. Rules and tenant overrides come after it exists."
      />
      <CommandAlert
        title="Could not create the flag"
        error={
          create.error && conflict
            ? {
                code: create.error.code,
                message: `A flag with the key "${submittedKey}" already exists.`,
              }
            : create.error
        }
      />
      {conflict ? (
        <p className="text-sm">
          <PluginLink to={flagPath(submittedKey)} className="underline">
            Open the existing flag
          </PluginLink>
        </p>
      ) : null}
      <form onSubmit={(e) => void submit(e)} className="flex max-w-lg flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="flag-key">Key</Label>
          <Input
            id="flag-key"
            className="font-mono"
            autoComplete="off"
            spellCheck={false}
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="flag-type">Type</Label>
          <NativeSelect
            id="flag-type"
            value={type}
            onChange={(e) => {
              const next = e.target.value
              if (!isFlagType(next)) return
              setType(next)
              // A default of one type is not a default of another.
              setDefaultValue(undefined)
            }}
          >
            {FLAG_TYPES.map((t) => (
              <NativeSelectOption key={t} value={t}>
                {t}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label id="flag-default-label" htmlFor="flag-default">
            Default
          </Label>
          <ValueInput
            id="flag-default"
            aria-labelledby="flag-default-label"
            type={type}
            value={defaultValue}
            onChange={setDefaultValue}
          />
          <p className="text-xs text-muted-foreground">
            What the flag returns when nothing else decides it.
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="flag-description">Description</Label>
          <Input
            id="flag-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="flag-tags">Tags</Label>
          <Input
            id="flag-tags"
            className="font-mono"
            autoComplete="off"
            spellCheck={false}
            value={tags}
            onChange={(e) => setTags(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">Comma separated.</p>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="flag-enabled"
            checked={enabled}
            onCheckedChange={(checked) => setEnabled(checked === true)}
          />
          <Label htmlFor="flag-enabled">Enabled</Label>
        </div>
        <div className="flex gap-2">
          <Button type="submit" disabled={!canSubmit}>
            {create.loading ? "Creating…" : "Create flag"}
          </Button>
          <PluginLink to="/flags" className="text-sm underline self-center">
            Cancel
          </PluginLink>
        </div>
      </form>
    </div>
  )
}
