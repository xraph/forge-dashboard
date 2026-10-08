import { useId, useState } from "react"
import { useQuery } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import {
  NativeSelect,
  NativeSelectOption,
} from "@forge-go/dashboard-kit/components/native-select"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { ZeroState } from "@forge-go/dashboard-kit/components/zero-state"
import { Code, IconAction } from "./components"
import {
  Plus,
  Trash2,
  ChevronLeft,
  ChevronRight,
} from "@forge-go/dashboard-kit/icons"
import { initialFields, type Field } from "./schema"
import type { Entity, Page, Resource } from "./types"
export type Draft = Record<string, unknown>
export function changedFields(initial: Draft, draft: Draft, fields: Field[]) {
  return Object.fromEntries(
    fields
      .filter(
        (f) =>
          f.key !== "name" &&
          JSON.stringify(initial[f.key]) !== JSON.stringify(draft[f.key])
      )
      .map((f) => [
        f.key,
        draft[f.key] ??
          (f.kind === "array"
            ? []
            : f.kind === "object" || f.kind === "json" || f.kind === "map"
              ? {}
              : f.kind === "boolean"
                ? false
                : f.kind === "number"
                  ? 0
                  : ""),
      ])
  )
}
function Reference({
  field,
  value,
  onChange,
  owner,
}: {
  field: Field
  value: unknown
  onChange: (v: unknown) => void
  owner?: { kind: Resource; id: string }
}) {
  const [search, setSearch] = useState(""),
    [page, setPage] = useState(0),
    uid = useId()
  const q = useQuery<Page<Entity>>("references.list", {
    kind: field.ref,
    owner_kind: owner?.kind,
    owner_id: owner?.id,
    search,
    limit: 20,
    offset: page * 20,
  })
  return (
    <div className="flex flex-col gap-1">
      <Input
        aria-label={`Find ${field.label}`}
        placeholder={`Find ${field.label.toLowerCase()}`}
        value={search}
        onChange={(e) => {
          setSearch(e.target.value)
          setPage(0)
        }}
      />
      <QueryBoundary
        title={`${field.label} choices`}
        query={q}
        skeletonRows={1}
        keepPreviousData
      >
        {(data) => (
          <>
            <NativeSelect
              id={uid}
              aria-label={field.label}
              value={String(value ?? "")}
              onChange={(e) => onChange(e.target.value)}
              required={field.required}
            >
              <NativeSelectOption value="">None</NativeSelectOption>
              {value && !data.items.some((r) => r.name === value) ? (
                <NativeSelectOption value={String(value)}>
                  {String(value)} (saved)
                </NativeSelectOption>
              ) : null}
              {data.items.map((r) => (
                <NativeSelectOption key={r.id} value={r.name}>
                  {r.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>{data.total} available</span>
              {page > 0 && (
                <IconAction
                  label="Previous choices"
                  icon={ChevronLeft}
                  onClick={() => setPage(page - 1)}
                />
              )}
              {(page + 1) * 20 < data.total && (
                <IconAction
                  label="More choices"
                  icon={ChevronRight}
                  onClick={() => setPage(page + 1)}
                />
              )}
            </div>
          </>
        )}
      </QueryBoundary>
    </div>
  )
}
function JSONField({
  value,
  label,
  onChange,
  onValidity,
  allowArray = false,
}: {
  allowArray?: boolean
  value: unknown
  label: string
  onChange: (v: unknown) => void
  onValidity: (valid: boolean) => void
}) {
  const [text, setText] = useState(() => JSON.stringify(value ?? {}, null, 2)),
    [error, setError] = useState("")
  return (
    <>
      <Code
        text={text}
        label={label}
        json
        onChange={(next) => {
          setText(next)
          try {
            const parsed: unknown = JSON.parse(next)
            if (
              parsed === null ||
              typeof parsed !== "object" ||
              (!allowArray && Array.isArray(parsed))
            )
              throw Error(
                allowArray ? "Use a JSON object or array" : "Use a JSON object"
              )
            setError("")
            onValidity(true)
            onChange(parsed)
          } catch (err) {
            setError(err instanceof Error ? err.message : "Invalid JSON")
            onValidity(false)
          }
        }}
      />
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </>
  )
}
function ScalarValue({
  value,
  onChange,
  label,
  onValidity,
}: {
  onValidity: (valid: boolean) => void
  value: unknown
  onChange: (v: unknown) => void
  label: string
}) {
  const kind =
    typeof value === "number"
      ? "number"
      : typeof value === "boolean"
        ? "boolean"
        : typeof value === "object" && value !== null
          ? "json"
          : "text"
  return (
    <div className="flex flex-col gap-1">
      <NativeSelect
        aria-label={`${label} type`}
        value={kind}
        onChange={(e) => {
          onValidity(true)
          onChange(
            e.target.value === "number"
              ? 0
              : e.target.value === "boolean"
                ? false
                : e.target.value === "json"
                  ? {}
                  : ""
          )
        }}
      >
        <NativeSelectOption value="text">Text</NativeSelectOption>
        <NativeSelectOption value="number">Number</NativeSelectOption>
        <NativeSelectOption value="boolean">Boolean</NativeSelectOption>
        <NativeSelectOption value="json">Object or array</NativeSelectOption>
      </NativeSelect>
      {kind === "boolean" ? (
        <input
          type="checkbox"
          aria-label={label}
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
        />
      ) : kind === "json" ? (
        <JSONField
          value={value}
          label={label}
          onChange={onChange}
          onValidity={onValidity}
          allowArray
        />
      ) : (
        <Input
          aria-label={label}
          type={kind === "number" ? "number" : "text"}
          required={kind === "number"}
          step="any"
          value={String(value ?? "")}
          onChange={(e) =>
            onChange(
              kind === "number"
                ? e.target.value === ""
                  ? ""
                  : Number(e.target.value)
                : e.target.value
            )
          }
        />
      )}
    </div>
  )
}
function MapField({
  field,
  value,
  onChange,
}: {
  field: Field
  value: unknown
  onChange: (v: unknown) => void
}) {
  const entries = Object.entries((value ?? {}) as Draft),
    [name, setName] = useState("")
  return (
    <div className="flex flex-col gap-2">
      {entries.map(([key, item]) => (
        <div key={key} className="flex flex-wrap items-center gap-2">
          <Label className="min-w-24">{key}</Label>
          <Input
            aria-label={`${field.label} ${key}`}
            className="w-28"
            type="number"
            required
            min={field.min}
            max={field.max}
            step={field.step ?? "any"}
            value={String(item)}
            onChange={(e) =>
              onChange({
                ...(value as Draft),
                [key]: e.target.value === "" ? "" : Number(e.target.value),
              })
            }
          />
          <IconAction
            label={`Remove ${key}`}
            icon={Trash2}
            onClick={() =>
              onChange(Object.fromEntries(entries.filter(([k]) => k !== key)))
            }
          />
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Input
          className="max-w-64"
          aria-label={`New ${field.label} key`}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <IconAction
          label="Add dimension"
          icon={Plus}
          disabled={!name.trim() || Object.hasOwn(value ?? {}, name)}
          onClick={() => {
            onChange({ ...(value as Draft), [name]: 0 })
            setName("")
          }}
        />
      </div>
    </div>
  )
}
function FieldContent({
  field,
  value,
  onChange,
  path,
  onValidity,
  owner,
}: {
  field: Field
  value: unknown
  onChange: (v: unknown) => void
  path: string
  onValidity: (path: string, valid: boolean) => void
  owner?: { kind: Resource; id: string }
}) {
  const uid = useId(),
    kind = field.kind ?? "text"
  const isGroup = kind === "array" || kind === "object"
  return (
    <div
      className={
        isGroup || kind === "prompt" || kind === "json"
          ? "col-span-full min-w-0"
          : "min-w-0"
      }
    >
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <Label htmlFor={uid}>
          {field.label}
          {field.required ? " *" : ""}
        </Label>
        {kind === "array" && (
          <IconAction
            label={`Add ${field.label.toLowerCase()}`}
            icon={Plus}
            onClick={() =>
              onChange([
                ...(Array.isArray(value) ? value : []),
                field.item?.kind === "object"
                  ? initialFields(field.item.fields ?? [])
                  : (field.item?.default ?? ""),
              ])
            }
          />
        )}
      </div>
      {field.help && (
        <p className="mb-2 text-xs text-muted-foreground">{field.help}</p>
      )}
      {field.ref ? (
        <Reference
          field={field}
          value={value}
          onChange={onChange}
          owner={owner}
        />
      ) : kind === "array" ? (
        <div className="flex flex-col gap-2">
          {Array.isArray(value) && value.length ? (
            value.map((row, index) => (
              <div key={index} className="min-w-0 rounded-md border p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    {field.label} {index + 1}
                  </span>
                  <IconAction
                    label={`Remove ${field.label.toLowerCase()} ${index + 1}`}
                    icon={Trash2}
                    onClick={() => {
                      onValidity(path, true)
                      onChange(value.filter((_, i) => i !== index))
                    }}
                  />
                </div>
                <FieldControl
                  field={field.item!}
                  value={row}
                  onChange={(next) =>
                    onChange(
                      value.map((item, i) => (i === index ? next : item))
                    )
                  }
                  path={`${path}.${index}`}
                  onValidity={onValidity}
                  owner={owner}
                />
              </div>
            ))
          ) : (
            <ZeroState
              title={`No ${field.label.toLowerCase()}`}
              body="Add an entry when this configuration needs one."
              action={
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() =>
                    onChange([
                      field.item?.kind === "object"
                        ? initialFields(field.item.fields ?? [])
                        : (field.item?.default ?? ""),
                    ])
                  }
                >
                  Add {field.label.toLowerCase()}
                </Button>
              }
            />
          )}
        </div>
      ) : kind === "object" ? (
        <div className="grid grid-cols-1 gap-3 rounded-md border p-3 sm:grid-cols-2">
          <FormFields
            fields={field.fields ?? []}
            value={(value ?? {}) as Draft}
            onChange={onChange}
            path={path}
            onValidity={onValidity}
            owner={owner}
          />
        </div>
      ) : kind === "json" ? (
        <JSONField
          value={value}
          label={field.label}
          onChange={onChange}
          onValidity={(valid) => onValidity(path, valid)}
        />
      ) : kind === "map" ? (
        <MapField field={field} value={value} onChange={onChange} />
      ) : kind === "value" ? (
        <ScalarValue
          value={value}
          label={field.label}
          onChange={onChange}
          onValidity={(valid) => onValidity(path, valid)}
        />
      ) : kind === "prompt" ? (
        <Code
          text={String(value ?? "")}
          label={field.label}
          onChange={onChange}
        />
      ) : kind === "boolean" ? (
        <input
          id={uid}
          type="checkbox"
          className="size-4 accent-primary"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
        />
      ) : kind === "select" ? (
        <NativeSelect
          id={uid}
          aria-label={field.label}
          required={field.required}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        >
          <NativeSelectOption value="">Default</NativeSelectOption>
          {value && !field.options?.includes(String(value)) ? (
            <NativeSelectOption value={String(value)}>
              {String(value)} (saved)
            </NativeSelectOption>
          ) : null}
          {field.options?.map((v) => (
            <NativeSelectOption key={v} value={v}>
              {v}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      ) : (
        <Input
          id={uid}
          aria-label={field.label}
          required={field.required}
          type={kind === "number" ? "number" : "text"}
          min={field.min}
          max={field.max}
          step={field.step ?? "any"}
          value={String(value ?? field.default ?? "")}
          onChange={(e) =>
            onChange(
              kind === "number"
                ? e.target.value === ""
                  ? ""
                  : Number(e.target.value)
                : e.target.value
            )
          }
        />
      )}
    </div>
  )
}
export function FieldControl(props: Parameters<typeof FieldContent>[0]) {
  const { field, value } = props
  if (["array", "object", "json", "map"].includes(field.kind ?? "")) {
    const count = Array.isArray(value)
      ? value.length
      : value && typeof value === "object"
        ? Object.keys(value).length
        : 0
    return (
      <details className="col-span-full min-w-0 rounded-md border px-3 py-2">
        <summary className="cursor-pointer text-xs font-medium">
          {field.label}{" "}
          <span className="ml-1 font-normal text-muted-foreground">
            {field.kind === "array"
              ? `${count} entries`
              : count
                ? "Configured"
                : "Optional"}
          </span>
        </summary>
        <div className="mt-2">
          <FieldContent {...props} />
        </div>
      </details>
    )
  }
  return <FieldContent {...props} />
}
export function FormFields({
  fields,
  value,
  onChange,
  path = "form",
  onValidity,
  owner,
}: {
  fields: Field[]
  value: Draft
  onChange: (v: Draft) => void
  path?: string
  onValidity: (path: string, valid: boolean) => void
  owner?: { kind: Resource; id: string }
}) {
  return (
    <>
      {fields.map((field) => (
        <FieldControl
          key={field.key}
          field={field}
          value={value[field.key]}
          onChange={(next) => onChange({ ...value, [field.key]: next })}
          path={`${path}.${field.key}`}
          onValidity={onValidity}
          owner={owner}
        />
      ))}
    </>
  )
}
