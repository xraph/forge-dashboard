import { useState } from "react"
import { useCommand, useQuery } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import {
  CommandAlert,
  QueryBoundary,
} from "@forge-go/dashboard-kit/components/query-boundary"
import type { AckResponse } from "./users"

/** One entry of `FormField.options`. */
export interface SelectOption {
  label: string
  value: string
}

/** `formConfigs.signup`'s row shape, from `handlers_form_configs.go`. */
export interface FormField {
  key: string
  label: string
  type: string
  placeholder?: string
  description?: string
  options?: SelectOption[]
  default?: string
  validation?: Record<string, unknown>
  order: number
}

/** `formConfigs.signup` -> this. There is no `active` here; see below. */
export interface SignupFormResponse {
  appId?: string
  fields: FormField[]
  updatedAt: string
}

function emptyField(order: number): FormField {
  return { key: "", label: "", type: "text", order }
}

/**
 * The reordering primitive both Move up and Move down go through.
 *
 * Swaps the two ORDER VALUES between the fields at `a` and `b`, not merely
 * their positions in the array. The server persists `order` and sorts by it
 * on the next read, so a swap that only moved array elements around would
 * save the array back with the same `order` numbers it started with -
 * looking right on screen for exactly as long as nobody reloads.
 */
function swapOrder(fields: FormField[], a: number, b: number): FormField[] {
  const next = [...fields]
  const fieldA = next[a]
  const fieldB = next[b]
  next[a] = { ...fieldB, order: fieldA.order }
  next[b] = { ...fieldA, order: fieldB.order }
  return next
}

function EditorBody({ fields: initialFields }: { fields: FormField[] }) {
  const [fields, setFields] = useState<FormField[]>(
    [...initialFields].sort((a, b) => a.order - b.order),
  )
  const save = useCommand<AckResponse>("formConfigs.saveSignup")

  function updateField(index: number, patch: Partial<FormField>) {
    setFields((prev) => prev.map((f, i) => (i === index ? { ...f, ...patch } : f)))
  }

  function addField() {
    setFields((prev) => {
      const nextOrder = prev.length > 0 ? Math.max(...prev.map((f) => f.order)) + 1 : 1
      return [...prev, emptyField(nextOrder)]
    })
  }

  function removeField(index: number) {
    setFields((prev) =>
      prev
        .filter((_, i) => i !== index)
        // Removing a field must leave the rest contiguous: it is the ORDER
        // VALUES that close over the gap, not only the array positions,
        // since `order` is what the server persists and sorts by.
        .map((f, i) => ({ ...f, order: i + 1 })),
    )
  }

  function moveUp(index: number) {
    if (index === 0) return
    setFields((prev) => swapOrder(prev, index - 1, index))
  }

  function moveDown(index: number) {
    setFields((prev) => {
      if (index >= prev.length - 1) return prev
      return swapOrder(prev, index, index + 1)
    })
  }

  async function submit() {
    // `formConfigs.saveSignup` takes the whole array, not pointers, so this
    // sends every field every time rather than a diff - unlike
    // `webhooks.update` or `roles.update`, this intent has nothing to
    // compare against.
    //
    // `formConfigs.signup` never returns an `active` flag - only
    // `formConfigs.list` does, as a property of the saved version, not of
    // the draft being edited. Saving from this editor always publishes the
    // result as the active signup form; there is no "save as inactive draft"
    // affordance to preserve here.
    await save.execute({ fields, active: true })
  }

  return (
    <div className="flex flex-col gap-4">
      <CommandAlert error={save.error} title="Could not save the signup form" />
      <div className="flex flex-col gap-3">
        {fields.map((field, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-md border p-3">
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`field-key-${i}`}>Key</Label>
                <Input
                  id={`field-key-${i}`}
                  value={field.key}
                  onChange={(e) => updateField(i, { key: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`field-label-${i}`}>Label</Label>
                <Input
                  id={`field-label-${i}`}
                  value={field.label}
                  onChange={(e) => updateField(i, { label: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`field-type-${i}`}>Type</Label>
                <Input
                  id={`field-type-${i}`}
                  value={field.type}
                  onChange={(e) => updateField(i, { type: e.target.value })}
                />
              </div>
              <span className="text-xs text-muted-foreground">Order {field.order}</span>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                aria-label={`Move ${field.label || field.key || "field " + (i + 1)} up`}
                onClick={() => moveUp(i)}
                disabled={i === 0}
              >
                Move up
              </Button>
              <Button
                variant="outline"
                size="sm"
                aria-label={`Move ${field.label || field.key || "field " + (i + 1)} down`}
                onClick={() => moveDown(i)}
                disabled={i === fields.length - 1}
              >
                Move down
              </Button>
              <Button
                variant="destructive"
                size="sm"
                aria-label={`Remove ${field.label || field.key || "field " + (i + 1)}`}
                onClick={() => removeField(i)}
              >
                Remove
              </Button>
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <Button variant="outline" onClick={addField}>
          Add field
        </Button>
        <Button onClick={() => void submit()} disabled={save.loading}>
          {save.loading ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  )
}

/**
 * `/signup-forms/edit`: the field editor for the app's signup form.
 *
 * A fixed route rather than a parameterised one - `formConfigs.signup` reads
 * the one signup form for the current app/environment context, not a form
 * by id.
 */
export function AuthSignupFormEditorPage() {
  const query = useQuery<SignupFormResponse>("formConfigs.signup")

  return (
    <section className="flex flex-col gap-4">
      <PageHeader title="Edit signup form" />
      <QueryBoundary title="Signup form" query={query} skeletonRows={3}>
        {(data) => (
          // Remounted on `updatedAt`, the same reseed-via-remount pattern the
          // kit consumer notes require of `SettingsForm`: this editor seeds
          // its draft once, from whatever was on the wire when it mounted,
          // and a refetch after a save must not leave it holding a draft
          // built against data the server has already replaced.
          <EditorBody key={data.updatedAt} fields={data.fields ?? []} />
        )}
      </QueryBoundary>
    </section>
  )
}
