import { Button } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"

export interface MetadataRow {
  key: string
  value: string
}

export function rowsOf(metadata: Record<string, string> | undefined): MetadataRow[] {
  return Object.keys(metadata ?? {})
    .sort()
    .map((key) => ({ key, value: metadata![key] }))
}

/** The map the rows describe, or the reason they don't describe one. */
export function metadataOf(rows: MetadataRow[]): { metadata: Record<string, string> } | { error: string } {
  const metadata: Record<string, string> = {}
  for (const row of rows) {
    const key = row.key.trim()
    if (key === "" && row.value === "") continue
    if (key === "") return { error: "Every value needs a key." }
    if (key in metadata) return { error: `The key "${key}" appears twice.` }
    metadata[key] = row.value
  }
  return { metadata }
}

/** Key and value pairs. Weave stores metadata as strings. */
export function MetadataEditor({ rows, onChange }: { rows: MetadataRow[]; onChange: (rows: MetadataRow[]) => void }) {
  const set = (i: number, patch: Partial<MetadataRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  return (
    <div className="flex flex-col gap-2">
      {rows.map((row, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input aria-label={`Metadata key ${i + 1}`} className="w-48 font-mono text-xs" spellCheck={false} value={row.key} onChange={(e) => set(i, { key: e.target.value })} />
          <Input aria-label={`Metadata value ${i + 1}`} className="flex-1" value={row.value} onChange={(e) => set(i, { value: e.target.value })} />
          <Button type="button" variant="ghost" size="sm" aria-label={`Remove metadata field ${i + 1}`} onClick={() => onChange(rows.filter((_, j) => j !== i))}>
            Remove
          </Button>
        </div>
      ))}
      <div>
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...rows, { key: "", value: "" }])}>
          Add a field
        </Button>
      </div>
    </div>
  )
}
