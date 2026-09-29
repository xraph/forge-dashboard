import { useState } from "react"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Textarea } from "@forge-go/dashboard-kit/components/textarea"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@forge-go/dashboard-kit/components/toggle-group"
import type { FlagType } from "../flag-types"

export { FLAG_TYPES } from "../flag-types"
export type { FlagType } from "../flag-types"

export interface ValueInputProps {
  type: FlagType
  /**
   * The value to start from. It is read once, when the input mounts or its
   * type changes; after that the input owns what is on screen, because a
   * half-typed "-" or "1." has no value to render from.
   */
  value: unknown
  /**
   * Called with the typed value on every change, and with `undefined` while
   * what is on screen is not a value: empty, half-typed, or invalid. A caller
   * gates submit on it not being `undefined`. Note `null` is a value: it is a
   * valid json default.
   */
  onChange: (value: unknown) => void
  /** Goes on the control itself, so a `<Label htmlFor>` reaches it. */
  id: string
  invalid?: boolean
  /**
   * For a label that cannot use `htmlFor`. The bool control is a group of
   * buttons, not a labelable element, so it needs this to be named.
   */
  "aria-labelledby"?: string
}

const INT_PREFIX = /^-?\d*$/
const FLOAT_PREFIX = /^-?\d*\.?\d*$/
const INT = /^-?\d+$/
const FLOAT = /^-?(\d+\.?\d*|\.\d+)$/

interface Parsed {
  value: unknown
  error?: string
}

/** Whether `text` may sit in the field at all, mid-typing. */
function accepts(type: FlagType, text: string): boolean {
  if (type === "int") return INT_PREFIX.test(text)
  if (type === "float") return FLOAT_PREFIX.test(text)
  return true
}

function parse(type: FlagType, text: string): Parsed {
  switch (type) {
    case "string":
      return { value: text === "" ? undefined : text }
    case "int": {
      if (!INT.test(text)) return { value: undefined }
      const n = Number(text)
      if (!Number.isSafeInteger(n)) {
        return {
          value: undefined,
          error: "That integer is too large to hold exactly.",
        }
      }
      return { value: n }
    }
    case "float": {
      if (!FLOAT.test(text)) return { value: undefined }
      const n = Number(text)
      return { value: Number.isFinite(n) ? n : undefined }
    }
    case "json": {
      if (text.trim() === "") return { value: undefined }
      try {
        return { value: JSON.parse(text) as unknown }
      } catch (err) {
        const why = err instanceof Error ? err.message : "could not be parsed"
        return { value: undefined, error: `Not valid JSON: ${why}` }
      }
    }
    default:
      return { value: undefined }
  }
}

function initialText(type: FlagType, value: unknown): string {
  if (value === undefined) return ""
  if (type === "json") return JSON.stringify(value, null, 2)
  if (type === "string") return typeof value === "string" ? value : ""
  if (typeof value === "number") return String(value)
  return ""
}

function BoolInput({
  value,
  onChange,
  id,
  invalid,
  "aria-labelledby": labelledBy,
}: ValueInputProps) {
  const pressed = value === true ? ["true"] : value === false ? ["false"] : []
  return (
    <ToggleGroup
      id={id}
      variant="outline"
      size="sm"
      spacing={0}
      value={pressed}
      aria-labelledby={labelledBy}
      aria-invalid={invalid || undefined}
      onValueChange={(next) => {
        // Pressing the pressed item empties the group. A bool default is one
        // of two values, so that is not a choice: keep what was chosen.
        const chosen = next[0]
        if (chosen === undefined) return
        onChange(chosen === "true")
      }}
    >
      <ToggleGroupItem value="true">true</ToggleGroupItem>
      <ToggleGroupItem value="false">false</ToggleGroupItem>
    </ToggleGroup>
  )
}

function TextInput({
  type,
  value,
  onChange,
  id,
  invalid,
  "aria-labelledby": labelledBy,
}: ValueInputProps) {
  const [text, setText] = useState(() => initialText(type, value))
  const [error, setError] = useState<string | undefined>(undefined)

  function change(next: string) {
    // A character that can never be part of a value is refused outright, so
    // "1.5" cannot be typed into an integer field.
    if (!accepts(type, next)) return
    const parsed = parse(type, next)
    setText(next)
    setError(parsed.error)
    onChange(parsed.value)
  }

  const errorId = `${id}-error`
  const common = {
    id,
    "aria-labelledby": labelledBy,
    "aria-invalid": invalid || error !== undefined || undefined,
    "aria-describedby": error === undefined ? undefined : errorId,
    spellCheck: false,
    autoComplete: "off",
  } as const

  return (
    <div className="flex flex-col gap-1.5">
      {type === "json" ? (
        <Textarea
          {...common}
          className="min-h-24 font-mono text-xs"
          value={text}
          onChange={(e) => change(e.target.value)}
        />
      ) : (
        <Input
          {...common}
          className="font-mono"
          inputMode={
            type === "int" ? "numeric" : type === "float" ? "decimal" : undefined
          }
          value={text}
          onChange={(e) => change(e.target.value)}
        />
      )}
      {error !== undefined ? (
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/**
 * The one input for a flag value of any type.
 *
 * bool is a two-button toggle, string a text field, int and float text fields
 * that accept only what can start a number, and json a mono textarea that
 * parses as you type. Whatever the type, it reports the typed value through
 * `onChange`, or `undefined` while the field does not hold one.
 *
 * It is keyed by type, so switching type starts the new control empty instead
 * of carrying "12" across from an int field into a json one.
 */
export function ValueInput(props: ValueInputProps) {
  return props.type === "bool" ? (
    <BoolInput key="bool" {...props} />
  ) : (
    <TextInput key={props.type} {...props} />
  )
}
