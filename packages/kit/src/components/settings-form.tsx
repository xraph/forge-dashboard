import { useMemo, useState } from "react"
import { cn } from "@forge-go/dashboard-kit/lib/utils"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { Switch } from "@forge-go/dashboard-kit/components/switch"
import {
  NativeSelect,
  NativeSelectOption,
} from "@forge-go/dashboard-kit/components/native-select"
import { EmptyState } from "@forge-go/dashboard-kit/components/empty-state"

export type SettingFieldType =
  | "string"
  | "number"
  | "boolean"
  | "select"
  | "secret"

export interface SettingFieldDescriptor {
  key: string
  label: string
  description?: string
  type: SettingFieldType
  value: unknown
  options?: { label: string; value: string }[]
  placeholder?: string
  helpText?: string
  /** Groups fields under a heading. Ungrouped fields render first. */
  section?: string
  /** Set at a higher scope and not overridable here. Renders disabled. */
  enforced?: boolean
  readOnly?: boolean
  required?: boolean
  min?: number
  max?: number
}

export interface SettingsFormProps {
  fields: SettingFieldDescriptor[]
  /** Receives only the keys whose value differs from what was rendered. */
  onSave: (changed: Record<string, unknown>) => void
  saving?: boolean
  emptyMessage?: string
}

function toFormValue(field: SettingFieldDescriptor): string | boolean {
  if (field.type === "boolean") return Boolean(field.value)
  return field.value === undefined || field.value === null
    ? ""
    : String(field.value)
}

/**
 * Renders one namespace of settings.
 *
 * The descriptor type is kit's own. Authsome's `SettingField` maps onto it in
 * the plugin, which is what keeps this component ignorant of any contract and
 * lets all eighteen settings-only sub-plugins share one renderer.
 *
 * Only changed keys reach `onSave`. `settings.update` writes one key at a
 * time, and resending an unchanged key writes an override where none existed,
 * which flips `isOverridden` on the next read and quietly detaches the value
 * from the default it was inheriting.
 *
 * The draft is seeded from `fields` on mount and does not re-seed when
 * `fields` changes. Remount this form with a `key` tied to the namespace when
 * you refetch, or an operator will keep seeing edits made against data that
 * has since been replaced.
 */
export function SettingsForm({
  fields,
  onSave,
  saving = false,
  emptyMessage = "This namespace has no settings.",
}: SettingsFormProps) {
  const initial = useMemo(() => {
    const out: Record<string, string | boolean> = {}
    for (const field of fields) out[field.key] = toFormValue(field)
    return out
  }, [fields])

  const [draft, setDraft] = useState(initial)

  // Keys whose draft value differs from what the server last told us.
  const changedKeys = Object.keys(draft).filter(
    (key) => draft[key] !== initial[key],
  )

  // A numeric field cleared to blank is ambiguous: it could mean "unset this"
  // or "I am about to type". Number("") is 0, so submitting it would write a
  // real zero override and look like a deliberate setting. Refuse instead,
  // and let the operator say what they meant.
  const blankNumbers = changedKeys.filter((key) => {
    const field = fields.find((f) => f.key === key)
    return field?.type === "number" && draft[key] === ""
  })

  const sections = useMemo(() => {
    // Keyed on `string | undefined` directly. A Map takes undefined as a key,
    // so the "no section" bucket needs no sentinel value and therefore cannot
    // collide with a real section name a server happens to send.
    const grouped = new Map<string | undefined, SettingFieldDescriptor[]>()
    for (const field of fields) {
      const name = field.section
      const bucket = grouped.get(name)
      if (bucket) bucket.push(field)
      else grouped.set(name, [field])
    }
    // Ungrouped fields render first, as the doc comment on `section` promises.
    return [...grouped.entries()].sort(([a], [b]) => {
      if (a === undefined) return -1
      if (b === undefined) return 1
      return 0
    })
  }, [fields])

  if (fields.length === 0) return <EmptyState title={emptyMessage} />

  function submit() {
    const changed: Record<string, unknown> = {}
    for (const key of changedKeys) {
      const field = fields.find((f) => f.key === key)
      const raw = draft[key]
      // Numbers go back as numbers. The Go side unmarshals into a typed
      // setting, and "12" against an int field is a type error at the server,
      // surfaced to the operator as a validation failure they cannot act on.
      changed[key] =
        field?.type === "number" && typeof raw === "string" ? Number(raw) : raw
    }
    onSave(changed)
  }

  return (
    <div className="flex flex-col gap-6">
      {sections.map(([section, sectionFields]) => (
        <section key={section ?? ""} className="flex flex-col gap-4">
          {section !== undefined && (
            <h2 className="text-sm font-medium">{section}</h2>
          )}
          {sectionFields.map((field) => (
            <Field
              key={field.key}
              field={field}
              value={draft[field.key]}
              invalid={blankNumbers.includes(field.key)}
              onChange={(value) =>
                setDraft((prev) => ({ ...prev, [field.key]: value }))
              }
            />
          ))}
        </section>
      ))}

      <div className="flex items-center gap-2">
        <Button
          onClick={submit}
          disabled={
            saving || changedKeys.length === 0 || blankNumbers.length > 0
          }
        >
          {saving ? "Saving" : "Save changes"}
        </Button>
        <Button
          variant="ghost"
          onClick={() => setDraft(initial)}
          disabled={saving || changedKeys.length === 0}
        >
          Reset
        </Button>
      </div>
    </div>
  )
}

function Field({
  field,
  value,
  invalid,
  onChange,
}: {
  field: SettingFieldDescriptor
  value: string | boolean
  invalid?: boolean
  onChange: (value: string | boolean) => void
}) {
  const disabled = Boolean(field.enforced || field.readOnly)
  const controlId = `setting-${field.key}`

  return (
    <div className={cn("flex flex-col gap-1.5", disabled && "opacity-70")}>
      <div className="flex items-center gap-2">
        <Label
          htmlFor={field.type === "boolean" ? undefined : controlId}
          id={field.type === "boolean" ? `${controlId}-label` : undefined}
        >
          {field.label}
        </Label>
        {field.enforced && <Badge variant="secondary">enforced</Badge>}
        {field.readOnly && !field.enforced && (
          <Badge variant="outline">read only</Badge>
        )}
      </div>

      {field.description && (
        <p className="text-xs text-muted-foreground">{field.description}</p>
      )}

      {field.type === "boolean" ? (
        <Switch
          id={controlId}
          aria-labelledby={`${controlId}-label`}
          checked={Boolean(value)}
          disabled={disabled}
          onCheckedChange={(checked: boolean) => onChange(checked)}
        />
      ) : field.type === "select" ? (
        <NativeSelect
          id={controlId}
          value={String(value)}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        >
          {(field.options ?? []).map((option) => (
            <NativeSelectOption key={option.value} value={option.value}>
              {option.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      ) : (
        <Input
          id={controlId}
          type={
            field.type === "number"
              ? "number"
              : field.type === "secret"
                ? "password"
                : "text"
          }
          value={String(value)}
          disabled={disabled}
          required={field.required}
          min={field.min}
          max={field.max}
          placeholder={field.placeholder}
          aria-invalid={invalid || undefined}
          onChange={(event) => onChange(event.target.value)}
        />
      )}

      {invalid && (
        <p role="alert" className="text-xs text-destructive">
          Enter a number, or press Reset to restore the current value.
        </p>
      )}

      {field.helpText && (
        <p className="text-xs text-muted-foreground">{field.helpText}</p>
      )}
    </div>
  )
}
