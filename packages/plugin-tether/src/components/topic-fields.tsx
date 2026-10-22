import { useId } from "react"
import {
  Field,
  FieldDescription,
} from "@forge-go/dashboard-kit/components/field"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { Textarea } from "@forge-go/dashboard-kit/components/textarea"
import { checkFilters } from "../topics"
import type { CheckedFilters } from "../topics"

export interface TopicFieldsProps {
  publish: string
  subscribe: string
  onPublish: (text: string) => void
  onSubscribe: (text: string) => void
  /** Locks both lists, e.g. while a save is in flight. */
  disabled?: boolean
}

/** What the two text areas hold, read as filters. */
export function readTopics(publish: string, subscribe: string) {
  const pub = checkFilters(publish)
  const sub = checkFilters(subscribe)
  return {
    publish: pub,
    subscribe: sub,
    valid: pub.problems.length === 0 && sub.problems.length === 0,
  }
}

/**
 * The publish and subscribe filter lists of a role, one filter per line, with
 * every wildcard mistake named under the list it is in. The hint carries the
 * two placeholders the broker expands per client.
 */
export function TopicFields({
  publish,
  subscribe,
  onPublish,
  onSubscribe,
  disabled,
}: TopicFieldsProps) {
  const read = readTopics(publish, subscribe)
  return (
    <>
      <p className="text-xs text-muted-foreground">
        One filter per line. <code className="font-mono">+</code> and{" "}
        <code className="font-mono">#</code> each take a whole level, and{" "}
        <code className="font-mono">#</code> only the last. The broker swaps{" "}
        <code className="font-mono">%c</code> for the client ID and{" "}
        <code className="font-mono">%u</code> for the username.
      </p>
      <FilterList
        label="Publish filters"
        description="What a device with this role may publish to."
        value={publish}
        onChange={onPublish}
        checked={read.publish}
        disabled={disabled}
      />
      <FilterList
        label="Subscribe filters"
        description="What a device with this role may subscribe to."
        value={subscribe}
        onChange={onSubscribe}
        checked={read.subscribe}
        disabled={disabled}
      />
    </>
  )
}

function FilterList({
  label,
  description,
  value,
  onChange,
  checked,
  disabled,
}: {
  label: string
  description: string
  value: string
  onChange: (text: string) => void
  checked: CheckedFilters
  disabled?: boolean
}) {
  const id = useId()
  const problemsId = `${id}-problems`
  const bad = checked.problems.length > 0
  return (
    <Field>
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        value={value}
        rows={3}
        disabled={disabled}
        spellCheck={false}
        autoComplete="off"
        className="font-mono"
        aria-invalid={bad || undefined}
        aria-describedby={bad ? problemsId : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      <FieldDescription>{description}</FieldDescription>
      {bad && (
        <ul
          id={problemsId}
          className="flex flex-col gap-0.5 text-xs text-destructive"
        >
          {checked.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
    </Field>
  )
}
