import type { SettingFieldDescriptor } from "@forge-go/dashboard-kit/components/settings-form"

/** `settings.namespace`'s field shape, from handlers_settings.go. */
export interface SettingOption {
  label: string
  value: string
}
export interface SettingValidation {
  required?: boolean
  min?: number
  max?: number
  minLen?: number
  maxLen?: number
  pattern?: string
}
export interface SettingCategory {
  name: string
  settings: SettingField[]
}
export interface SettingsNamespaceResponse {
  namespace: string
  displayName?: string
  scope: string
  categories: SettingCategory[]
}
export interface SettingField {
  key: string
  displayName: string
  description?: string
  type: string
  inputType?: string
  default?: unknown
  effectiveValue?: unknown
  isOverridden: boolean
  isEnforced: boolean
  canOverride: boolean
  readOnly?: boolean
  sensitive?: boolean
  placeholder?: string
  helpText?: string
  options?: SettingOption[]
  validation?: SettingValidation
  order: number
  section?: string
  scopes?: string[]
}

/**
 * Flattens the server's categories into one ordered list of fields.
 *
 * The response groups settings into named categories, and kit's `SettingsForm`
 * groups by a `section` on each field. Those are the same idea arriving in two
 * shapes, so the category name becomes the section for any field that does not
 * carry one of its own. Dropping the category name instead would collapse a
 * grouped namespace into one undifferentiated wall of inputs.
 *
 * Takes `undefined` because the page calls this while the query behind it is
 * still loading, before there is a response to flatten.
 */
export function flattenCategories(res: SettingsNamespaceResponse | undefined): SettingField[] {
  return (res?.categories ?? []).flatMap((category) =>
    (category.settings ?? []).map((field) => ({
      ...field,
      section: field.section || category.name,
    })),
  )
}

/**
 * Turns the contract's `SettingField` into kit's `SettingFieldDescriptor`.
 *
 * This is the one place the two shapes meet, deliberately. Kit owns its
 * descriptor and knows nothing about any contract, which is what lets all
 * eighteen settings-only sub-plugins share one renderer. Widening kit to
 * understand `SettingField` would trade that away for nothing.
 */
export function toDescriptors(fields: SettingField[]): SettingFieldDescriptor[] {
  return [...(fields ?? [])]
    .sort((a, b) => a.order - b.order)
    .map((field) => ({
      key: field.key,
      label: field.displayName,
      description: field.description,
      // Sensitive wins over everything. A masked field that should have been
      // plain is a small annoyance; the reverse is a leak.
      type: field.sensitive ? "secret" : kitType(field),
      // The effective value is what is in force. `default` is only what would
      // apply if nothing were set, so it is the fallback and never the first
      // choice.
      value: field.effectiveValue ?? field.default,
      options: field.options,
      placeholder: field.placeholder,
      helpText: field.helpText,
      section: field.section,
      // Two different server-side facts, one operator-facing consequence: you
      // cannot change this here. `readOnly` stays separate because it means
      // nobody changes it anywhere, which reads differently in the UI.
      enforced: field.isEnforced || !field.canOverride,
      readOnly: field.readOnly,
      required: field.validation?.required,
      min: field.validation?.min,
      max: field.validation?.max,
    }))
}

function kitType(field: SettingField): SettingFieldDescriptor["type"] {
  if (field.options && field.options.length > 0) return "select"
  switch (field.type) {
    case "bool":
    case "boolean":
      return "boolean"
    case "int":
    case "integer":
    case "float":
    case "number":
      return "number"
    case "string":
      return "string"
    default:
      // A newer server may declare a type this UI predates. A text box is a
      // poor rendering of a duration; refusing to render the namespace at all
      // is a worse one.
      return "string"
  }
}
