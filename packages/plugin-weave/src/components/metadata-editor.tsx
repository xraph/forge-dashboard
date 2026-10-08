import { IconButton } from "@forge-go/dashboard-kit/components/icon-button"
import { Input } from "@forge-go/dashboard-kit/components/input"

export interface MetadataRow {
  key: string
  value: string
}

export function rowsOf(
  metadata: Record<string, string> | undefined
): MetadataRow[] {
  return Object.keys(metadata ?? {})
    .sort()
    .map((key) => ({ key, value: metadata![key] }))
}

/**
 * The map the rows describe, or the reason they don't describe one. Entries
 * are collected in a Map and turned into an object at the end, so a key such
 * as "constructor" is not mistaken for a duplicate and "__proto__" becomes an
 * own property instead of being dropped.
 */
export function metadataOf(
  rows: MetadataRow[]
): { metadata: Record<string, string> } | { error: string } {
  const entries = new Map<string, string>()
  for (const row of rows) {
    const key = row.key.trim()
    if (key === "" && row.value === "") continue
    if (key === "") return { error: "Every value needs a key." }
    if (entries.has(key)) return { error: `The key "${key}" appears twice.` }
    entries.set(key, row.value)
  }
  return { metadata: Object.fromEntries(entries) }
}

/** Key and value pairs. Weave stores metadata as strings. */
export function MetadataEditor({
  rows,
  onChange,
}: {
  rows: MetadataRow[]
  onChange: (rows: MetadataRow[]) => void
}) {
  const set = (i: number, patch: Partial<MetadataRow>) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  return (
    <div className="flex flex-col gap-2">
      {rows.map((row, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            aria-label={`Metadata key ${i + 1}`}
            className="w-48 font-mono text-xs"
            spellCheck={false}
            value={row.key}
            onChange={(e) => set(i, { key: e.target.value })}
          />
          <Input
            aria-label={`Metadata value ${i + 1}`}
            className="flex-1"
            value={row.value}
            onChange={(e) => set(i, { value: e.target.value })}
          />
          <IconButton
            type="button"
            variant="ghost"
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
            label={`Remove metadata field ${i + 1}`}
          />
        </div>
      ))}
      <div>
        <IconButton
          type="button"
          variant="outline"
          onClick={() => onChange([...rows, { key: "", value: "" }])}
          label="Add a field"
        />
      </div>
    </div>
  )
}
