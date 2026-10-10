import { IconButton } from "@forge-go/dashboard-kit/components/icon-button"
import { useState } from "react"
import type { ClipboardEvent, KeyboardEvent } from "react"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { Input } from "@forge-go/dashboard-kit/components/input"

export interface ChipInputProps {
  /** The ids so far, in the order they were added. */
  values: string[]
  onChange: (next: string[]) => void
  /** Goes on the text field, so a `<Label htmlFor>` reaches it. */
  id: string
  /** What the values are, singular: "tenant id". Names the chips' Remove buttons. */
  noun: string
  invalid?: boolean
  "aria-describedby"?: string
}

/**
 * A list of ids typed one at a time.
 *
 * Enter or a comma turns the text into a chip, trimmed. An id already in the
 * list is ignored, since the server refuses a duplicate. Backspace in an empty
 * field takes the last chip back. Leaving the field with text in it adds that
 * text too: an operator who types an id and goes straight for Save would
 * otherwise lose it without a word.
 */
export function ChipInput({
  values,
  onChange,
  id,
  noun,
  invalid,
  "aria-describedby": describedBy,
}: ChipInputProps) {
  const [text, setText] = useState("")

  /** Adds every non-empty, new id in `parts`, and empties the field. */
  function add(parts: string[]) {
    const seen = new Set(values)
    const next = [...values]
    for (const part of parts) {
      const trimmed = part.trim()
      if (trimmed === "" || seen.has(trimmed)) continue
      seen.add(trimmed)
      next.push(trimmed)
    }
    if (next.length !== values.length) onChange(next)
    setText("")
  }

  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      // Not a form submit, and not a stray Save.
      event.preventDefault()
      add([text])
    } else if (event.key === "Backspace" && text === "" && values.length > 0) {
      onChange(values.slice(0, -1))
    }
  }

  function change(next: string) {
    if (!next.includes(",")) {
      setText(next)
      return
    }
    // Typed or pasted, a comma ends an id. The part after the last comma is
    // still being typed.
    const parts = next.split(",")
    const pending = parts.pop() ?? ""
    add(parts)
    setText(pending)
  }

  function paste(event: ClipboardEvent<HTMLInputElement>) {
    const pasted = event.clipboardData.getData("text")
    if (!/[,\n]/.test(pasted)) return
    event.preventDefault()
    add(`${text}${pasted}`.split(/[,\n]/))
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {values.length > 0 ? (
        <ul
          role="list"
          aria-label={`${noun}s`}
          className="flex flex-wrap gap-1"
        >
          {values.map((value) => (
            <li key={value}>
              <Badge
                variant="outline"
                className="gap-1 pr-0.5 font-mono text-xs"
              >
                {value}
                <IconButton
                  type="button"
                  variant="ghost"
                  onClick={() => onChange(values.filter((v) => v !== value))}
                  label={`Remove ${noun} ${value}`}
                />
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}
      <Input
        id={id}
        className="font-mono"
        autoComplete="off"
        spellCheck={false}
        placeholder="Type an id, then Enter or a comma"
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        value={text}
        onChange={(e) => change(e.target.value)}
        onKeyDown={keyDown}
        onPaste={paste}
        onBlur={() => add([text])}
      />
    </div>
  )
}
