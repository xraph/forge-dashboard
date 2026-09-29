import { useId, useState } from "react"
import { useCommand, useNavigateTo } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { CommandAlert } from "@forge-go/dashboard-kit/components/query-boundary"
import { Textarea } from "@forge-go/dashboard-kit/components/textarea"
import type { Ack } from "../types"
import { parsePayload } from "./event-send"

/**
 * Registers an event type, or updates one: registering a name that exists
 * replaces its definition, as the catalog does.
 */
export function RelayEventTypeRegisterPage() {
  const register = useCommand<Ack>("eventTypes.register")
  const navigate = useNavigateTo()
  const id = useId()
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [group, setGroup] = useState("")
  const [version, setVersion] = useState("1")
  const [schema, setSchema] = useState("")
  const [example, setExample] = useState("")

  const parsedSchema = parsePayload(schema)
  const schemaError =
    parsedSchema.error ??
    (parsedSchema.value !== undefined &&
    (parsedSchema.value === null ||
      typeof parsedSchema.value !== "object" ||
      Array.isArray(parsedSchema.value))
      ? "A JSON Schema is an object, in braces."
      : undefined)
  const parsedExample = parsePayload(example)
  const ready = name.trim() !== "" && !schemaError && !parsedExample.error
  const refused = register.error?.details?.field

  async function submit(e: { preventDefault: () => void }) {
    e.preventDefault()
    if (!ready || register.loading) return
    const res = await register.execute({
      name: name.trim(),
      description: description.trim(),
      group: group.trim(),
      version: version.trim(),
      ...(parsedSchema.value !== undefined
        ? { schema: parsedSchema.value }
        : {}),
      ...(parsedExample.value !== undefined
        ? { example: parsedExample.value }
        : {}),
    })
    if (res === undefined) return
    navigate(`/event-types/${encodeURIComponent(name.trim())}`)
  }

  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title="Register an event type"
        description="Registering a name that already exists replaces its definition."
      />
      <form
        className="flex max-w-xl flex-col gap-4"
        onSubmit={submit}
        noValidate
      >
        <CommandAlert
          error={register.error}
          title="Could not register the type"
        />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-name`}>Name</Label>
          <Input
            id={`${id}-name`}
            className="font-mono"
            placeholder="invoice.paid"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={refused === "name" || undefined}
          />
          <span className="text-xs text-muted-foreground">
            Dotted, so endpoints can subscribe with a pattern like invoice.*
          </span>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-description`}>Description</Label>
          <Input
            id={`${id}-description`}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="flex gap-4">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor={`${id}-group`}>Group</Label>
            <Input
              id={`${id}-group`}
              value={group}
              onChange={(e) => setGroup(e.target.value)}
            />
          </div>
          <div className="flex w-28 flex-col gap-1.5">
            <Label htmlFor={`${id}-version`}>Version</Label>
            <Input
              id={`${id}-version`}
              value={version}
              onChange={(e) => setVersion(e.target.value)}
            />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-schema`}>JSON Schema</Label>
          <Textarea
            id={`${id}-schema`}
            className="min-h-32 font-mono"
            value={schema}
            onChange={(e) => setSchema(e.target.value)}
            aria-invalid={
              Boolean(schemaError) || refused === "schema" || undefined
            }
            aria-describedby={`${id}-schema-help`}
          />
          <span
            id={`${id}-schema-help`}
            className={
              schemaError
                ? "text-xs font-medium text-destructive"
                : "text-xs text-muted-foreground"
            }
          >
            {schemaError ??
              "Optional. Every event of this type is checked against it before it is stored."}
          </span>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-example`}>Example payload</Label>
          <Textarea
            id={`${id}-example`}
            className="min-h-24 font-mono"
            value={example}
            onChange={(e) => setExample(e.target.value)}
            aria-invalid={Boolean(parsedExample.error) || undefined}
          />
          {parsedExample.error && (
            <span className="text-xs font-medium text-destructive">
              {parsedExample.error}
            </span>
          )}
        </div>
        <div>
          <Button type="submit" disabled={!ready || register.loading}>
            {register.loading ? "Registering…" : "Register"}
          </Button>
        </div>
      </form>
    </section>
  )
}
