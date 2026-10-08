import { IconButton } from "@forge-go/dashboard-kit/components/icon-button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { createMetadataRow } from "./setup-model"
import type { MetadataRow } from "./setup-model"

export interface MetadataEditorProps {
  rows: MetadataRow[]
  onChange: (rows: MetadataRow[]) => void
  path: string
  idPrefix: string
  errors?: Record<string, string>
  disabled?: boolean
  createRow?: () => MetadataRow
}

export function MetadataEditor({
  rows,
  onChange,
  path,
  idPrefix,
  errors = {},
  disabled = false,
  createRow = createMetadataRow,
}: MetadataEditorProps) {
  function update(index: number, field: "key" | "value", value: string) {
    onChange(
      rows.map((row, rowIndex) =>
        rowIndex === index ? { ...row, [field]: value } : row
      )
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {rows.map((row, index) => {
        const keyId = `${idPrefix}-${row.id}-key`
        const valueId = `${idPrefix}-${row.id}-value`
        const keyError = errors[`${path}.${index}.key`]
        const valueError = errors[`${path}.${index}.value`]
        const keyErrorId = `${keyId}-error`
        const valueErrorId = `${valueId}-error`

        return (
          <div
            className="grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_1fr_auto]"
            key={row.id}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={keyId}>Metadata key {index + 1}</Label>
              <Input
                aria-describedby={keyError ? keyErrorId : undefined}
                aria-invalid={Boolean(keyError)}
                disabled={disabled}
                id={keyId}
                name={`${path}.${index}.key`}
                onChange={(event) => update(index, "key", event.target.value)}
                value={row.key}
              />
              {keyError ? (
                <p className="text-xs text-destructive" id={keyErrorId}>
                  {keyError}
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={valueId}>Metadata value {index + 1}</Label>
              <Input
                aria-describedby={valueError ? valueErrorId : undefined}
                aria-invalid={Boolean(valueError)}
                disabled={disabled}
                id={valueId}
                name={`${path}.${index}.value`}
                onChange={(event) => update(index, "value", event.target.value)}
                value={row.value}
              />
              {valueError ? (
                <p className="text-xs text-destructive" id={valueErrorId}>
                  {valueError}
                </p>
              ) : null}
            </div>
            <IconButton
              label={`Remove metadata row ${index + 1}`}
              className="self-end"
              disabled={disabled}
              onClick={() =>
                onChange(rows.filter((_, rowIndex) => rowIndex !== index))
              }
              type="button"
              variant="ghost"
            />
          </div>
        )
      })}

      {errors[path] ? (
        <p className="text-xs text-destructive">{errors[path]}</p>
      ) : null}
      <IconButton
        label="Add metadata"
        className="self-start"
        disabled={disabled || rows.length >= 20}
        onClick={() => onChange([...rows, createRow()])}
        type="button"
        variant="outline"
      />
    </div>
  )
}
