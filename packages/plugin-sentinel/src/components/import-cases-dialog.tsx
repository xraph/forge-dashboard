import { useEffect, useId, useRef, useState } from "react"
import type { ChangeEvent, FormEvent } from "react"
import { useCommand } from "@forge-go/dashboard-plugin"
import type { CommandState } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@forge-go/dashboard-kit/components/dialog"
import {
  Field,
  FieldDescription,
  FieldGroup,
} from "@forge-go/dashboard-kit/components/field"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import {
  NativeSelect,
  NativeSelectOption,
} from "@forge-go/dashboard-kit/components/native-select"
import { Textarea } from "@forge-go/dashboard-kit/components/textarea"
import type { ImportResult } from "../types"

/** cases.import refuses anything larger, counted in UTF-8 bytes. */
const MAX_IMPORT_BYTES = 1 << 20
const TOO_LARGE = `import data is larger than ${MAX_IMPORT_BYTES} bytes`
const NOTHING = "Paste the cases, or choose a file."
const UNREADABLE = "The file could not be read."

type Format = "json" | "jsonl" | "csv"

const HELP: Record<Format, string> = {
  json: "A list of objects with name and input, and optionally expected, tags and context.",
  jsonl: "One JSON object per line, with the same fields as JSON.",
  csv: "A header row naming name and input, and optionally expected and tags. Separate tags with a semicolon.",
}

export interface ImportCasesDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  suiteId: string
  /** Called with the number of cases the server imported. */
  onImported: (count: number) => void
}

/**
 * Imports cases into a suite from JSON, JSONL or CSV, pasted or read from a
 * file. The server takes all of it or none: a row with no name or no input
 * refuses the whole import, by row number, and nothing is written.
 */
export function ImportCasesDialog({
  open,
  onOpenChange,
  suiteId,
  onImported,
}: ImportCasesDialogProps) {
  const command = useCommand<ImportResult>("cases.import")
  const { reset } = command
  useEffect(() => {
    if (open) reset()
  }, [open, reset])
  const locked = command.loading
  return (
    <Dialog
      open={open}
      onOpenChange={(next, details) => {
        if (!next && locked) {
          details.cancel()
          return
        }
        onOpenChange(next)
      }}
      disablePointerDismissal={locked}
    >
      <DialogContent
        showCloseButton={!locked}
        className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-2xl"
      >
        <ImportForm
          command={command}
          suiteId={suiteId}
          onImported={(count) => {
            onOpenChange(false)
            onImported(count)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}

function ImportForm({
  command,
  suiteId,
  onImported,
}: {
  command: CommandState<ImportResult>
  suiteId: string
  onImported: (count: number) => void
}) {
  const base = useId()
  const id = (name: string) => `${base}-${name}`
  const [format, setFormat] = useState<Format>("json")
  const [data, setData] = useState("")
  const [problem, setProblem] = useState<string | null>(null)
  const sending = useRef(false)
  const message = problem ?? command.error?.message

  async function readFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    const lower = file.name.toLowerCase()
    if (lower.endsWith(".csv")) setFormat("csv")
    else if (lower.endsWith(".jsonl")) setFormat("jsonl")
    else if (lower.endsWith(".json")) setFormat("json")
    setProblem(null)
    // The file's own size is known before reading it, so a huge one is
    // refused without loading it into the page.
    if (file.size > MAX_IMPORT_BYTES) return setProblem(TOO_LARGE)
    try {
      setData(await file.text())
    } catch {
      setProblem(UNREADABLE)
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (sending.current || command.loading) return
    if (data.trim() === "") return setProblem(NOTHING)
    if (new Blob([data]).size > MAX_IMPORT_BYTES) return setProblem(TOO_LARGE)
    setProblem(null)
    sending.current = true
    let result: ImportResult | undefined
    try {
      result = await command.execute({ suiteId, format, data })
    } finally {
      sending.current = false
    }
    if (result) onImported(result.imported)
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="contents" noValidate>
      <DialogHeader>
        <DialogTitle>Import cases</DialogTitle>
      </DialogHeader>
      <FieldGroup>
        <Field>
          <Label htmlFor={id("format")}>Format</Label>
          <NativeSelect
            id={id("format")}
            className="w-full"
            value={format}
            onChange={(e) => setFormat(e.target.value as Format)}
          >
            <NativeSelectOption value="json">JSON</NativeSelectOption>
            <NativeSelectOption value="jsonl">JSON lines</NativeSelectOption>
            <NativeSelectOption value="csv">CSV</NativeSelectOption>
          </NativeSelect>
          <FieldDescription>{HELP[format]}</FieldDescription>
        </Field>
        <Field>
          <Label htmlFor={id("file")}>File</Label>
          <Input
            id={id("file")}
            type="file"
            accept=".json,.jsonl,.csv,application/json,text/csv"
            onChange={(e) => void readFile(e)}
          />
        </Field>
        <Field>
          <Label htmlFor={id("data")}>Cases</Label>
          <Textarea
            id={id("data")}
            rows={10}
            spellCheck={false}
            className="font-mono text-xs"
            value={data}
            aria-invalid={message ? true : undefined}
            aria-describedby={message ? id("error") : undefined}
            onChange={(e) => setData(e.target.value)}
          />
          <FieldDescription>
            Up to 1 MiB. Every row is checked before any is written.
          </FieldDescription>
        </Field>
      </FieldGroup>
      {message && (
        <p id={id("error")} role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}
      <DialogFooter>
        <DialogClose
          render={<Button type="button" variant="outline" />}
          disabled={command.loading}
        >
          Cancel
        </DialogClose>
        <Button type="submit" disabled={command.loading}>
          Import
        </Button>
      </DialogFooter>
    </form>
  )
}
