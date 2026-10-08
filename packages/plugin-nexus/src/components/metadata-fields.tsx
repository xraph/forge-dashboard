import { Input } from "@forge-go/dashboard-kit/components/input"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { IconButton } from "@forge-go/dashboard-kit/components/icon-button"
import { Trash2Icon } from "@forge-go/dashboard-kit/icons"
import type { MetadataDraft } from "../tenant-form"
export function MetadataFields({
  label,
  value,
  onChange,
}: {
  label: string
  value: MetadataDraft
  onChange: (value: MetadataDraft) => void
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{label}</legend>
      {value.map((row, index) => (
        <div className="flex flex-wrap items-center gap-2" key={index}>
          <Input
            className="min-w-32 flex-1"
            aria-label={`${label} key ${index + 1}`}
            placeholder="Key"
            value={row.key}
            onChange={(e) =>
              onChange(
                value.map((r, i) =>
                  i === index ? { ...r, key: e.target.value } : r
                )
              )
            }
          />
          <Input
            className="min-w-32 flex-1"
            aria-label={`${label} value ${index + 1}`}
            placeholder="Value"
            value={row.value}
            onChange={(e) =>
              onChange(
                value.map((r, i) =>
                  i === index ? { ...r, value: e.target.value } : r
                )
              )
            }
          />
          <IconButton
            icon={Trash2Icon}
            label={`Remove ${label.toLowerCase()} entry ${index + 1}`}
            onClick={() => onChange(value.filter((_, i) => i !== index))}
          />
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange([...value, { key: "", value: "" }])}
      >
        Add {label.toLowerCase()} entry
      </Button>
    </fieldset>
  )
}
