import { useEffect, useRef } from "react"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Textarea } from "@forge-go/dashboard-kit/components/textarea"
import { bytesBase64, inputBase64 } from "./durable-bytes"

export type DurableInputValue = {
  text: string
  base64?: string
  loading?: boolean
  error?: string
}
export function encodedInput(value: DurableInputValue) {
  if (value.loading || value.error)
    throw new Error(value.error ?? "Wait for the input file to load.")
  return value.base64 ?? inputBase64(value.text)
}
/** Textareas use browser line endings. Files preserve every original byte. */
export function DurableInput({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string
  value: DurableInputValue
  onChange: (value: DurableInputValue) => void
  disabled?: boolean
}) {
  const reader = useRef<FileReader | null>(null)
  const generation = useRef(0)
  useEffect(() => {
    const owner = generation
    const hide = () => {
      if (
        document.visibilityState === "hidden" &&
        reader.current?.readyState === FileReader.LOADING
      ) {
        generation.current++
        reader.current.abort()
        onChange({ text: "" })
      }
    }
    document.addEventListener("visibilitychange", hide)
    return () => {
      owner.current++
      reader.current?.abort()
      document.removeEventListener("visibilitychange", hide)
    }
  }, [onChange])
  return (
    <div className="col-span-full flex min-w-0 flex-col gap-1 text-xs">
      <label>
        {label}
        <Textarea
          aria-label={label}
          value={value.text}
          disabled={disabled || value.loading}
          rows={3}
          onChange={(event) => {
            generation.current++
            reader.current?.abort()
            onChange({ text: event.target.value })
          }}
        />
      </label>
      <label className="flex min-w-0 flex-col gap-1">
        {label} exact-byte file
        <Input
          aria-label={`${label} exact-byte file`}
          type="file"
          className="h-8 max-w-full min-w-0"
          disabled={disabled}
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (!file) return
            reader.current?.abort()
            const version = ++generation.current
            if (file.size > 1 << 20) {
              onChange({ text: "", error: "Input file exceeds 1 MiB." })
              return
            }
            onChange({ text: "", loading: true })
            const next = new FileReader()
            reader.current = next
            next.onload = () => {
              if (generation.current === version)
                onChange({
                  text: "",
                  base64: bytesBase64(
                    new Uint8Array(next.result as ArrayBuffer)
                  ),
                })
            }
            next.onerror = () => {
              if (generation.current === version)
                onChange({ text: "", error: "Input file could not be read." })
            }
            next.readAsArrayBuffer(file)
            event.target.value = ""
          }}
        />
      </label>
      {(value.base64 !== undefined || value.error) && (
        <Button
          type="button"
          size="xs"
          variant="ghost"
          className="self-start"
          disabled={disabled}
          onClick={() => {
            generation.current++
            reader.current?.abort()
            onChange({ text: "" })
          }}
        >
          Use text input
        </Button>
      )}
      {value.loading ? (
        <p role="status">Reading input bytes…</p>
      ) : value.error ? (
        <p role="alert" className="text-destructive">
          {value.error}
        </p>
      ) : value.base64 !== undefined ? (
        <p role="status">
          Exact file bytes loaded. Editing text replaces the file input.
        </p>
      ) : (
        <p className="text-muted-foreground">
          UTF-8 text, or a file up to 1 MiB for original line endings and binary
          bytes.
        </p>
      )}
    </div>
  )
}
