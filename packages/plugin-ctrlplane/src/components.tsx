import { lazy, Suspense, useState } from "react"
import {
  PluginLink,
  useCommand,
  useNavigateTo,
} from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { CommandAlert } from "@forge-go/dashboard-kit/components/query-boundary"
import { DescriptionList } from "@forge-go/dashboard-kit/components/detail-layout"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import type { Action, Field, Row } from "./types"
import { label, record, rows, text } from "./types"
const JsonEditor = lazy(() => import("./json-editor"))
export function JsonView({ value, title }: { value: unknown; title: string }) {
  return (
    <Suspense fallback={<p role="status">Loading {title} editor…</p>}>
      <JsonEditor
        value={JSON.stringify(value, null, 2) ?? "null"}
        label={title}
      />
    </Suspense>
  )
}
export function State({ value }: { value: unknown }) {
  const state = text(value)
  return (
    <Badge
      variant={
        ["failed", "unhealthy", "offline", "error"].includes(state)
          ? "destructive"
          : ["running", "active", "healthy", "succeeded", "verified"].includes(
                state
              )
            ? "outline"
            : "secondary"
      }
    >
      {state || "unknown"}
    </Badge>
  )
}
export function Value({ name, value }: { name: string; value: unknown }) {
  if (value === undefined || value === null || value === "")
    return <NoneCell label={label(name).toLowerCase()} />
  if (
    ["interval", "timeout", "duration", "latency", "last_duration"].includes(
      name
    ) &&
    typeof value === "number"
  ) {
    const seconds = value / 1e9
    return (
      <span className="font-mono text-xs">
        {seconds >= 3600
          ? `${seconds / 3600}h`
          : seconds >= 60
            ? `${seconds / 60}m`
            : seconds >= 1
              ? `${seconds}s`
              : `${value / 1e6}ms`}
      </span>
    )
  }
  if (
    name.endsWith("_at") ||
    ["last_run", "last_checked", "timestamp", "cert_expiry"].includes(name)
  )
    return <Timestamp value={text(value)} label={label(name)} />
  if (name === "state" || name === "status") return <State value={value} />
  if (typeof value === "boolean") return <span>{value ? "Yes" : "No"}</span>
  if (Array.isArray(value))
    return (
      <span className="text-xs">
        {value
          .map((v) => (typeof v === "string" ? v : text(record(v).name)))
          .join(", ") || <NoneCell label={label(name).toLowerCase()} />}
      </span>
    )
  const target: Record<string, string> = {
    instance_id: "instances",
    workload_id: "workloads",
    datacenter_id: "datacenters",
    release_id: "releases",
    current_release: "releases",
    current_release_id: "releases",
    template_id: "templates",
  }
  if (target[name])
    return (
      <PluginLink
        className="font-mono text-xs underline underline-offset-2"
        to={`/${target[name]}/${encodeURIComponent(text(value))}`}
      >
        {text(value)}
      </PluginLink>
    )
  if (typeof value === "object")
    return (
      <details>
        <summary className="cursor-pointer py-1 text-xs">
          Inspect {label(name).toLowerCase()}
        </summary>
        <JsonView value={value} title={label(name)} />
      </details>
    )
  return (
    <span
      className={
        name === "id" || name.endsWith("_id") || name.includes("sha")
          ? "font-mono text-xs break-all"
          : "break-words"
      }
    >
      {text(value)}
    </span>
  )
}
export function Details({ row, fields }: { row: Row; fields: string[] }) {
  return (
    <DescriptionList
      items={fields.map((name) => ({
        term: label(name),
        value: <Value name={name} value={row[name]} />,
      }))}
    />
  )
}
export function StructuredServices({
  value,
  onChange,
  deploy = false,
}: {
  value: unknown
  onChange: (value: Row[]) => void
  deploy?: boolean
}) {
  const services = rows(value)
  function patch(index: number, key: string, value: unknown) {
    onChange(
      services.map((service, i) =>
        i === index
          ? {
              ...Object.fromEntries(
                Object.entries(service).filter(([key]) => !key.startsWith("__"))
              ),
              [key]: value,
            }
          : service
      )
    )
  }
  return (
    <div className="space-y-2">
      {services.map((service, index) => (
        <div className="space-y-2 rounded-md border p-2" key={index}>
          <div
            className={`grid gap-2 ${deploy ? "grid-cols-1 sm:grid-cols-[8rem_minmax(0,1fr)]" : "grid-cols-[minmax(0,1fr)_7rem] sm:grid-cols-[8rem_7rem_minmax(0,1fr)]"}`}
          >
            <Input
              aria-label={`Service ${index + 1} name`}
              placeholder="Service name"
              value={text(service.name)}
              onChange={(e) => patch(index, "name", e.target.value)}
            />
            {!deploy && (
              <select
                aria-label={`Service ${index + 1} role`}
                className="h-9 rounded-md border bg-background px-2 text-sm"
                value={text(service.role) || "main"}
                onChange={(e) => patch(index, "role", e.target.value)}
              >
                {["main", "sidecar", "init"].map((role) => (
                  <option key={role}>{role}</option>
                ))}
              </select>
            )}
            <Input
              className={deploy ? undefined : "col-span-2 sm:col-span-1"}
              aria-label={`Service ${index + 1} image`}
              placeholder="Image"
              value={text(service.image)}
              onChange={(e) => patch(index, "image", e.target.value)}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!deploy &&
              ["cpu_millis", "memory_mb"].map((key) => (
                <label key={key} className="flex items-center gap-2 text-xs">
                  {label(key)}
                  <Input
                    className="w-24"
                    type="number"
                    min={0}
                    value={text(record(service.resources)[key])}
                    onChange={(e) =>
                      patch(index, "resources", {
                        ...record(service.resources),
                        [key]: Number(e.target.value),
                      })
                    }
                  />
                </label>
              ))}
            <Button
              size="xs"
              variant="ghost"
              type="button"
              onClick={() => onChange(services.filter((_, i) => i !== index))}
            >
              Remove service {index + 1}
            </Button>
          </div>
          <details>
            <summary className="cursor-pointer py-1 text-xs">
              {deploy
                ? "Environment and health check"
                : "Environment, ports, secrets and config files"}
            </summary>
            <div className="mt-2">
              <JsonField
                label={`Service ${index + 1} configuration`}
                value={
                  text(service.__draft) ||
                  JSON.stringify(
                    Object.fromEntries(
                      Object.entries(service).filter(
                        ([key]) => !key.startsWith("__")
                      )
                    ),
                    null,
                    2
                  )
                }
                onChange={(input) => {
                  try {
                    const parsed = record(JSON.parse(input))
                    onChange(
                      services.map((s, i) =>
                        i === index ? { ...parsed, __draft: input } : s
                      )
                    )
                  } catch {
                    onChange(
                      services.map((s, i) =>
                        i === index
                          ? {
                              ...s,
                              __draft: input,
                              __error: "Invalid service JSON.",
                            }
                          : s
                      )
                    )
                  }
                }}
              />
            </div>
          </details>
        </div>
      ))}
      <Button
        size="xs"
        variant="outline"
        type="button"
        onClick={() =>
          onChange([
            ...services,
            {
              name: services.length ? `service-${services.length + 1}` : "main",
              ...(!deploy
                ? { role: services.length ? "sidecar" : "main" }
                : {}),
              image: "",
            },
          ])
        }
      >
        Add service
      </Button>
    </div>
  )
}
function JsonField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <Suspense fallback={<p role="status">Loading editor…</p>}>
      <JsonEditor value={value} onChange={onChange} label={label} />
    </Suspense>
  )
}

function AdvancedJsonField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="cursor-pointer text-sm font-medium">{label}</summary>
      {open && (
        <div className="mt-2">
          <JsonField label={label} value={value} onChange={onChange} />
        </div>
      )}
    </details>
  )
}

export function Fields({
  fields,
  values,
  setValues,
}: {
  fields: Field[]
  values: Row
  setValues: (value: Row) => void
}) {
  return (
    <div className="grid grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-2">
      {fields.map((field) => (
        <div
          key={field.key}
          className={`space-y-1 ${["group", "services", "json"].includes(field.type ?? "") || field.key === "notes" ? "sm:col-span-2" : ""}`}
        >
          {field.type !== "json" && (
            <label
              className="text-xs font-medium"
              htmlFor={`ctrlplane-${field.key}`}
            >
              {field.label}
              {field.required ? " *" : ""}
            </label>
          )}
          {field.type === "group" ? (
            <Fields
              fields={field.children ?? []}
              values={record(values[field.key])}
              setValues={(value) =>
                setValues({ ...values, [field.key]: value })
              }
            />
          ) : field.type === "services" ? (
            <StructuredServices
              deploy={field.deploy}
              value={values[field.key]}
              onChange={(value) => setValues({ ...values, [field.key]: value })}
            />
          ) : field.type === "json" ? (
            <AdvancedJsonField
              label={field.label}
              value={text(values[field.key])}
              onChange={(value) => setValues({ ...values, [field.key]: value })}
            />
          ) : field.type === "select" ? (
            <select
              id={`ctrlplane-${field.key}`}
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              value={text(values[field.key])}
              onChange={(e) =>
                setValues({ ...values, [field.key]: e.target.value })
              }
            >
              {field.options?.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          ) : field.type === "checkbox" ? (
            <input
              id={`ctrlplane-${field.key}`}
              type="checkbox"
              checked={values[field.key] === true}
              onChange={(e) =>
                setValues({ ...values, [field.key]: e.target.checked })
              }
            />
          ) : (
            <Input
              id={`ctrlplane-${field.key}`}
              autoComplete="off"
              type={field.type || "text"}
              value={text(values[field.key])}
              onChange={(e) =>
                setValues({
                  ...values,
                  [field.key]:
                    field.type === "number"
                      ? e.target.value === ""
                        ? ""
                        : Number(e.target.value)
                      : e.target.value,
                })
              }
            />
          )}
          {field.hint && (
            <p className="text-xs text-muted-foreground">{field.hint}</p>
          )}
        </div>
      ))}
    </div>
  )
}
const deployServiceKeys = ["name", "image", "env", "health_check"]
export function initialValues(fields: Field[], row: Row = {}): Row {
  return Object.fromEntries(
    fields.map((field) => {
      let value = row[field.key] ?? field.value
      if (field.type === "services") {
        value ??= [{ name: "main", role: "main", image: "" }]
        return [
          field.key,
          rows(value).map((service) =>
            field.deploy
              ? Object.fromEntries(
                  Object.entries(service).filter(([key]) =>
                    deployServiceKeys.includes(key)
                  )
                )
              : service
          ),
        ]
      }
      return [
        field.key,
        field.type === "group"
          ? initialValues(field.children ?? [], record(value))
          : field.type === "json"
            ? value === undefined
              ? ""
              : JSON.stringify(value, null, 2)
            : (value ??
              (field.type === "checkbox"
                ? false
                : field.type === "select"
                  ? field.options?.[0]
                  : "")),
      ]
    })
  )
}
export function payloadFor(fields: Field[], values: Row): Row {
  const payload: Row = {}
  for (const field of fields) {
    const value = values[field.key]
    if (field.required && (value === "" || value === undefined))
      throw new Error(`${field.label} is required.`)
    if (
      field.type === "services" &&
      field.required &&
      rows(value).length === 0 &&
      !(typeof values.source === "string" && values.source)
    )
      throw new Error("Add a service or provide a deployment source.")
    if (field.type === "group") {
      payload[field.key] = payloadFor(field.children ?? [], record(value))
    } else if (field.type === "json") {
      if (value !== "") payload[field.key] = JSON.parse(text(value))
    } else if (field.type === "services") {
      payload[field.key] = rows(value).map((service) => {
        if (service.__error) throw new Error(text(service.__error))
        if (
          field.deploy &&
          Object.keys(service).some(
            (key) => !key.startsWith("__") && !deployServiceKeys.includes(key)
          )
        )
          throw new Error(
            "Deployments support name, image, env and health_check only."
          )
        return Object.fromEntries(
          Object.entries(service).filter(([key]) => !key.startsWith("__"))
        )
      })
    } else if (value !== "") payload[field.key] = value
  }
  if (
    record(payload.source).type === "services" &&
    Array.isArray(payload.services)
  ) {
    payload.source = { type: "services", services: payload.services }
  }
  return payload
}
export function CommandButton({
  action,
  target,
  seed = {},
  title,
}: {
  action: Action
  target: Row
  seed?: Row
  title?: string
}) {
  const command = useCommand<Row>(action.intent)
  const navigate = useNavigateTo()
  const [open, setOpen] = useState(false)
  const [outcome, setOutcome] = useState<unknown>()
  const [values, setValues] = useState<Row>({})
  const [validation, setValidation] = useState("")
  const fields = action.fields ?? []
  async function execute() {
    try {
      const body = payloadFor(fields, values)
      setValidation("")
      const result = await command.execute({
        ...target,
        ...(action.nested ? { request: body } : body),
      })
      if (result !== undefined) {
        setOutcome(result)
        setOpen(false)
        if (action.redirect) navigate(action.redirect, { replace: true })
      }
    } catch (error) {
      setValidation(error instanceof Error ? error.message : "Invalid fields.")
    }
  }
  return (
    <>
      <Button
        size="xs"
        variant={action.destructive ? "outline" : "secondary"}
        onClick={() => {
          command.reset()
          setValidation("")
          setValues(
            initialValues(
              fields,
              action.intent === "workloads.scale"
                ? { ...seed, replicas: seed.replica_count }
                : seed
            )
          )
          setOpen(true)
        }}
      >
        {action.label}
      </Button>
      {outcome !== undefined &&
        ["providers.test", "providers.purge", "health.run"].includes(
          action.intent
        ) && (
          <details open className="text-xs">
            <summary role="status">{action.label} result</summary>
            <JsonView value={outcome} title={`${action.label} result`} />
          </details>
        )}
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`${action.label}${title ? ` ${title}` : ""}?`}
        description={
          action.description ?? "Confirm this change to the selected resource."
        }
        confirmLabel={action.label}
        destructive={action.destructive ?? false}
        pending={command.loading}
        onConfirm={() => void execute()}
      >
        <div className="max-h-[65vh] space-y-3 overflow-y-auto pr-1">
          <Fields fields={fields} values={values} setValues={setValues} />
          {validation && (
            <p role="alert" className="text-sm text-destructive">
              {validation}
            </p>
          )}
          <CommandAlert
            error={command.error}
            title={`${action.label} failed`}
          />
          {command.error?.details && (
            <JsonView value={command.error.details} title="Failure details" />
          )}
        </div>
      </ConfirmDialog>
    </>
  )
}
