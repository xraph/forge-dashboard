import { useId, useRef, useState } from "react"
import type { FormEvent } from "react"
import {
  PluginLink,
  useCommand,
  useNavigateTo,
  useQuery,
  type ContractError,
  type PluginPageProps,
} from "@forge-go/dashboard-plugin"
import {
  Button,
  buttonVariants,
} from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import {
  NativeSelect,
  NativeSelectOption,
} from "@forge-go/dashboard-kit/components/native-select"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import {
  CommandAlert,
  QueryBoundary,
} from "@forge-go/dashboard-kit/components/query-boundary"
import { Textarea } from "@forge-go/dashboard-kit/components/textarea"
import { ZeroState } from "@forge-go/dashboard-kit/components/zero-state"
import { CoverageNotice } from "../components/common"
import JsonEditor from "../components/json-editor"
import {
  label,
  singular,
  path,
  type Capabilities,
  type Collection,
  type Field,
  type Page,
  type Row,
} from "../types"
function defaults(fields: Field[]): Record<string, unknown> {
  return Object.fromEntries(
    fields.map((f) => [
      f.key,
      f.type === "array" || f.type === "tags" || f.type === "references"
        ? []
        : f.type === "boolean"
          ? false
          : f.type === "number" || f.type === "integer"
            ? 0
            : f.type === "json"
              ? {}
              : f.type === "json_value"
                ? null
                : f.key === "sensitivity"
                  ? "balanced"
                  : f.key === "severity"
                    ? "warning"
                    : (f.options?.[0] ?? ""),
    ])
  )
}
function ReferencePicker({
  collection,
  value,
  onChange,
  label: fieldLabel,
}: {
  collection: string
  value: string
  onChange: (value: string) => void
  label: string
}) {
  const id = useId()
  const [search, setSearch] = useState("")
  const q = useQuery<Page>(`${collection}.list`, {
    limit: 100,
    offset: 0,
    ...(search ? { search } : {}),
  })
  return (
    <div className="grid gap-1">
      <Input
        aria-label={`Search ${fieldLabel}`}
        placeholder={`Search ${collection}`}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <NativeSelect
        id={id}
        aria-label={fieldLabel}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <NativeSelectOption value="">Choose configuration</NativeSelectOption>
        {value && !q.data?.items.some((r) => r.name === value) && (
          <NativeSelectOption value={value}>
            {value} (current selection)
          </NativeSelectOption>
        )}
        {q.data?.items.map((row) => (
          <NativeSelectOption key={row.id} value={row.name}>
            {row.name}
            {row.enabled ? "" : " (disabled)"}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      {q.loading && (
        <span className="text-xs text-muted-foreground">Loading choices…</span>
      )}
      {q.error && (
        <div role="alert" className="text-xs text-destructive">
          Could not load choices.{" "}
          <button type="button" onClick={q.refetch} className="underline">
            Retry
          </button>
        </div>
      )}
      {q.data?.has_more && (
        <span className="text-xs text-muted-foreground">
          Showing 100 of {q.data.total}. Refine your search.
        </span>
      )}
    </div>
  )
}
function JsonField({
  field,
  value,
  onChange,
  onValidity,
  fieldPath,
}: {
  field: Field
  value: unknown
  onChange: (v: unknown) => void
  onValidity: (path: string, error?: string) => void
  fieldPath: string
}) {
  const [error, setError] = useState("")
  return (
    <div className="min-w-0">
      <JsonEditor
        label={label(field.key)}
        initial={JSON.stringify(
          value ?? (field.type === "json_value" ? null : {}),
          null,
          2
        )}
        onChange={(text) => {
          try {
            if (
              new TextEncoder().encode(text).length >
              (field.json_bytes_max ?? 16384)
            )
              throw new Error("JSON exceeds the field limit")
            const parsed: unknown = JSON.parse(text)
            if (
              field.type === "json" &&
              (parsed === null ||
                typeof parsed !== "object" ||
                Array.isArray(parsed))
            )
              throw new Error("Use a JSON object")
            setError("")
            onValidity(fieldPath)
            onChange(parsed)
          } catch {
            const message =
              field.type === "json"
                ? "Enter a valid JSON object up to 16 KiB"
                : "Enter a valid JSON value up to 16 KiB"
            setError(message)
            onValidity(fieldPath, message)
          }
        }}
      />
      {error && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
function StructuredArray({
  field,
  value,
  onChange,
  onValidity,
  fieldPath,
}: {
  field: Field
  value: unknown
  onChange: (v: unknown) => void
  onValidity: (path: string, error?: string) => void
  fieldPath: string
}) {
  const id = useId()
  const items = Array.isArray(value) ? value : []
  const title = label(field.label)
  const [keys, setKeys] = useState(() => items.map((_, i) => `${id}-${i}`))
  const nextKey = useRef(items.length)
  return (
    <fieldset className="col-span-full grid min-w-0 gap-2 rounded-md border p-2.5">
      <legend className="px-1 text-sm font-medium">{title}</legend>
      {items.length === 0 && (
        <span className="text-xs text-muted-foreground">
          No {field.label} configured.
        </span>
      )}
      {items.map((item, index) => (
        <div
          key={keys[index]}
          className="grid min-w-0 gap-2 rounded-md bg-muted/30 p-2 md:grid-cols-2"
        >
          {field.fields?.map((child) => (
            <FieldControl
              key={child.key}
              field={child}
              value={(item as Record<string, unknown>)[child.key]}
              onChange={(v) =>
                onChange(
                  items.map((r, i) =>
                    i === index
                      ? { ...(r as Record<string, unknown>), [child.key]: v }
                      : r
                  )
                )
              }
              onValidity={onValidity}
              fieldPath={`${fieldPath}.${keys[index]}.${child.key}`}
            />
          ))}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="w-fit"
            aria-label={`Remove ${field.key} ${index + 1}`}
            onClick={() => {
              for (const child of field.fields ?? [])
                onValidity(`${fieldPath}.${keys[index]}.${child.key}`)
              setKeys(keys.filter((_, i) => i !== index))
              onChange(items.filter((_, i) => i !== index))
            }}
          >
            Remove
          </Button>
        </div>
      ))}
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={items.length >= (field.max_items ?? 64)}
        className="w-fit"
        onClick={() => {
          setKeys([...keys, `${id}-${nextKey.current++}`])
          onChange([...items, defaults(field.fields ?? [])])
        }}
      >
        Add {singular(field.label)}
      </Button>
    </fieldset>
  )
}
function FieldControl({
  field,
  value,
  onChange,
  onValidity,
  fieldPath,
}: {
  field: Field
  value: unknown
  onChange: (v: unknown) => void
  onValidity: (path: string, error?: string) => void
  fieldPath: string
}) {
  const id = useId()
  const title = label(field.label)
  const items = Array.isArray(value) ? value : []
  if (field.type === "array")
    return (
      <StructuredArray
        field={field}
        value={value}
        onChange={onChange}
        onValidity={onValidity}
        fieldPath={fieldPath}
      />
    )
  if (field.type === "references")
    return (
      <fieldset className="grid gap-2 rounded-md border p-2.5">
        <legend className="px-1 text-sm font-medium">{title}</legend>
        {items.map((item, index) => (
          <div
            key={index}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2"
          >
            <ReferencePicker
              collection={field.key}
              value={String(item)}
              label={`${title} ${index + 1}`}
              onChange={(v) =>
                onChange(items.map((old, i) => (i === index ? v : old)))
              }
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label={`Remove ${field.key} ${index + 1}`}
              onClick={() => onChange(items.filter((_, i) => i !== index))}
            >
              Remove
            </Button>
          </div>
        ))}
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="w-fit"
          disabled={items.length >= (field.max_items ?? 64)}
          onClick={() => onChange([...items, ""])}
        >
          Add {singular(field.label)}
        </Button>
      </fieldset>
    )
  let control
  if (field.type === "boolean")
    control = (
      <input
        id={id}
        type="checkbox"
        checked={value === true}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 accent-primary"
      />
    )
  else if (field.type === "select")
    control = (
      <NativeSelect
        id={id}
        aria-label={title}
        required={field.required}
        value={String(value ?? "")}
        onChange={(e) => onChange(e.target.value)}
      >
        {!field.required && (
          <NativeSelectOption value="">Default</NativeSelectOption>
        )}
        {Boolean(value) && !field.options?.includes(String(value)) && (
          <NativeSelectOption value={String(value)}>
            {String(value)} (unsupported stored value)
          </NativeSelectOption>
        )}
        {field.options?.map((v) => (
          <NativeSelectOption key={v} value={v}>
            {label(v)}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    )
  else if (field.type === "reference")
    control = (
      <ReferencePicker
        collection={
          field.key.replace(/_name$/, "") +
          (field.key === "awareness_name" ? "" : "s")
        }
        value={String(value ?? "")}
        onChange={onChange}
        label={title}
      />
    )
  else if (field.type === "json" || field.type === "json_value")
    control = (
      <JsonField
        field={field}
        value={value}
        onChange={onChange}
        onValidity={onValidity}
        fieldPath={fieldPath}
      />
    )
  else if (field.type === "textarea" || field.type === "tags")
    control = (
      <Textarea
        id={id}
        rows={2}
        maxLength={field.type === "tags" ? 65536 : 4096}
        value={field.type === "tags" ? items.join("\n") : String(value ?? "")}
        onChange={(e) =>
          onChange(
            field.type === "tags"
              ? e.target.value.split("\n").filter(Boolean)
              : e.target.value
          )
        }
        placeholder={field.type === "tags" ? "One entry per line" : undefined}
      />
    )
  else
    control = (
      <Input
        id={id}
        type={
          field.type === "number" || field.type === "integer"
            ? "number"
            : "text"
        }
        min={
          field.minimum ??
          (field.type === "number" || field.type === "integer" ? 0 : undefined)
        }
        max={
          field.maximum ??
          (field.type === "number"
            ? 1
            : field.type === "integer"
              ? 1000000
              : undefined)
        }
        step={
          field.type === "number"
            ? "any"
            : field.type === "integer"
              ? 1
              : undefined
        }
        maxLength={field.max_length ?? 512}
        value={String(value ?? "")}
        onChange={(e) =>
          onChange(
            field.type === "number" || field.type === "integer"
              ? e.target.value === ""
                ? ""
                : Number(e.target.value)
              : e.target.value
          )
        }
      />
    )
  return (
    <div
      className={`grid min-w-0 gap-1.5 ${field.type === "json" || field.type === "json_value" ? "col-span-full" : ""}`}
    >
      <Label htmlFor={id}>
        {title}
        {field.required ? " *" : ""}
      </Label>
      {control}
    </div>
  )
}
export function EditorForm({
  collection,
  capabilities,
  initial,
  pending,
  error,
  onSubmit,
}: {
  collection: Collection
  capabilities: Capabilities
  initial?: Row
  pending: boolean
  error?: ContractError
  onSubmit: (row: Record<string, unknown>) => Promise<void>
}) {
  const schema = capabilities.schemas[collection] ?? []
  const [draft, setDraft] = useState<Record<string, unknown>>(() => {
    const row = initial ?? {
      ...defaults(schema),
      name: "",
      description: "",
      enabled: true,
      metadata: {},
    }
    return Object.fromEntries(
      Object.entries(row).filter(
        ([key]) =>
          ![
            "id",
            "app_id",
            "tenant_id",
            "scope_key",
            "scope_level",
            "created_at",
            "updated_at",
          ].includes(key)
      )
    )
  })
  const [invalid, setInvalid] = useState<Record<string, string>>({})
  const busy = useRef(false)
  const errors = error?.details?.fields as Record<string, string> | undefined
  function validity(path: string, message?: string) {
    setInvalid((old) => {
      const next = { ...old }
      if (message) next[path] = message
      else delete next[path]
      return next
    })
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy.current || pending || Object.keys(invalid).length) return
    busy.current = true
    try {
      await onSubmit(draft)
    } finally {
      busy.current = false
    }
  }
  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="grid min-w-0 gap-2"
    >
      <CommandAlert error={error} title="Could not save configuration" />
      {errors && (
        <ul
          role="alert"
          className="list-inside list-disc text-xs text-destructive"
        >
          {Object.entries(errors).map(([key, message]) => (
            <li key={key}>
              {label(key)}: {message}
            </li>
          ))}
        </ul>
      )}
      <div className="grid min-w-0 gap-2 rounded-md border p-2.5 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="shield-name">Name *</Label>
          <Input
            id="shield-name"
            className="h-8 text-xs"
            required
            maxLength={128}
            value={String(draft.name ?? "")}
            disabled={!!initial}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </div>
        <div className="flex items-center gap-2">
          <input
            id="shield-enabled"
            type="checkbox"
            checked={draft.enabled === true}
            onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
          />
          <Label htmlFor="shield-enabled">Enabled</Label>
        </div>
        <div className="col-span-full grid gap-1.5">
          <Label htmlFor="shield-description">Description</Label>
          <Textarea
            id="shield-description"
            className="min-h-12"
            rows={2}
            maxLength={4096}
            value={String(draft.description ?? "")}
            onChange={(e) =>
              setDraft({ ...draft, description: e.target.value })
            }
          />
        </div>
      </div>
      {collection === "policies" && (
        <p className="text-xs text-muted-foreground">
          Scope: {capabilities.scope.policy_level ?? "app"}{" "}
          <code>
            {capabilities.scope.policy_key ?? capabilities.scope.app_id}
          </code>
          . The server assigns this scope.
        </p>
      )}
      <div className="grid min-w-0 gap-2 sm:grid-cols-2">
        {schema.map((field) => (
          <FieldControl
            key={field.key}
            field={field}
            value={draft[field.key]}
            onChange={(v) => setDraft((old) => ({ ...old, [field.key]: v }))}
            onValidity={validity}
            fieldPath={field.key}
          />
        ))}
      </div>
      <details className="rounded-md border p-2.5">
        <summary className="cursor-pointer text-sm font-medium">
          Metadata JSON
        </summary>
        <div className="mt-2">
          <JsonField
            field={{ key: "metadata", label: "metadata", type: "json" }}
            value={draft.metadata}
            onChange={(v) => setDraft((old) => ({ ...old, metadata: v }))}
            onValidity={validity}
            fieldPath="metadata"
          />
        </div>
      </details>
      <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-2 border-t bg-background/95 py-2">
        <span className="mr-auto text-xs text-muted-foreground">
          Saving stores configuration. Evaluation remains unavailable.
        </span>
        <PluginLink
          to={path(collection, initial?.id)}
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          Cancel
        </PluginLink>
        <Button
          type="submit"
          size="sm"
          disabled={pending || Object.keys(invalid).length > 0}
        >
          {pending
            ? "Saving…"
            : initial
              ? "Save configuration"
              : "Create configuration"}
        </Button>
      </div>
    </form>
  )
}
export default function EditorPage({
  collection,
  params,
}: { collection: Collection } & PluginPageProps) {
  const caps = useQuery<Capabilities>("capabilities")
  const id = params.id
  const detail = useQuery<Row>(
    `${collection}.detail`,
    { id },
    { enabled: !!id }
  )
  const command = useCommand<Row>(`${collection}.${id ? "update" : "create"}`)
  const navigate = useNavigateTo()
  const attempt = useRef<{ payload: string; key: string } | undefined>(
    undefined
  )
  const form = (cap: Capabilities, row?: Row) =>
    cap.can_manage ? (
      <EditorForm
        key={row?.id ?? collection}
        collection={collection}
        capabilities={cap}
        initial={row}
        pending={command.loading}
        error={command.error}
        onSubmit={async (fields) => {
          const payload = { ...(id ? { id } : {}), row: fields }
          const serialized = JSON.stringify(payload)
          if (attempt.current?.payload !== serialized)
            attempt.current = { payload: serialized, key: crypto.randomUUID() }
          const result = await command.execute(payload, {
            idempotencyKey: attempt.current.key,
          })
          if (result !== undefined) navigate(path(collection, result.id))
        }}
      />
    ) : (
      <ZeroState
        title="Read access only"
        body="You need Shield manage permission to change configuration."
        action={
          <PluginLink to={path(collection)}>Back to {collection}</PluginLink>
        }
      />
    )
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <PageHeader title={`${id ? "Edit" : "New"} ${singular(collection)}`} />
      <CoverageNotice />
      <QueryBoundary title="Editor permissions" query={caps}>
        {(cap) =>
          id ? (
            <QueryBoundary title="Configuration" query={detail}>
              {(row) => form(cap, row)}
            </QueryBoundary>
          ) : (
            form(cap)
          )
        }
      </QueryBoundary>
    </section>
  )
}
