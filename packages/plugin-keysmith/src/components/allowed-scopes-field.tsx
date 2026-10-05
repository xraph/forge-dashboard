import { useQuery } from "@forge-go/dashboard-plugin"
import { Checkbox } from "@forge-go/dashboard-kit/components/checkbox"
import {
  FieldDescription,
  FieldLegend,
  FieldSet,
} from "@forge-go/dashboard-kit/components/field"
import { Label } from "@forge-go/dashboard-kit/components/label"
import type { ScopesList } from "../types"

// The most the scope picker asks for, the same as the key forms' pickers, so
// they share one store entry.
const PICKER_LIMIT = 200
const PICKER_PARAMS = { limit: PICKER_LIMIT }

export interface AllowedScopesFieldProps {
  /** The policy's allow list as it was when the form opened. */
  stored: string[]
  /** The ticked names. This is exactly what the form sends. */
  picked: string[]
  onChange: (picked: string[]) => void
  /** Set by the form when its error message is about this field. */
  "aria-invalid"?: true
  "aria-describedby"?: string
}

/**
 * The allowed scopes, as checkboxes over `scopes.list`.
 *
 * The rows are every listed scope, then every stored or ticked name the list
 * does not have. So a ticked name never leaves the screen, whatever the list
 * does: the store drops a query's data when a refetch fails, and a refetch
 * can stop listing a scope someone deleted. Unticking is always a choice, and
 * the form sends `picked` as it is, never filtered through the list.
 */
export function AllowedScopesField({
  stored,
  picked,
  onChange,
  ...invalid
}: AllowedScopesFieldProps) {
  const scopes = useQuery<ScopesList>("scopes.list", PICKER_PARAMS)
  const rows = allowedRows(scopes.data, stored, picked)

  return (
    <FieldSet {...invalid}>
      <FieldLegend variant="label">Allowed scopes</FieldLegend>
      {scopes.error && (
        <FieldDescription>
          Scopes could not be loaded. The scopes already ticked stay ticked.
        </FieldDescription>
      )}
      {scopes.loading && !scopes.data && (
        <FieldDescription>Loading scopes…</FieldDescription>
      )}
      {scopes.data && rows.length === 0 && (
        <FieldDescription>No scopes exist in this tenant yet.</FieldDescription>
      )}
      {rows.length > 0 && (
        <div className="flex max-h-40 flex-col gap-2 overflow-y-auto">
          {rows.map((row) => (
            <Label key={row.name} className="font-normal">
              <Checkbox
                checked={picked.includes(row.name)}
                onCheckedChange={(on) =>
                  onChange(
                    on === true
                      ? [...picked.filter((n) => n !== row.name), row.name]
                      : picked.filter((n) => n !== row.name),
                  )
                }
              />
              <span className="font-mono text-xs">{row.name}</span>
              {row.note && (
                <span className="text-muted-foreground">{` ${row.note}`}</span>
              )}
            </Label>
          ))}
        </div>
      )}
      {picked.length === 0 && (
        <FieldDescription>None ticked: any scope.</FieldDescription>
      )}
      {scopes.data?.hasMore && (
        <FieldDescription>
          {`Only the first ${PICKER_LIMIT} scopes are listed.`}
        </FieldDescription>
      )}
    </FieldSet>
  )
}

/** The picker's rows: listed scopes, then stored and ticked names it lacks. */
function allowedRows(
  data: ScopesList | undefined,
  stored: string[],
  picked: string[],
): { name: string; note?: string }[] {
  const listed = data?.scopes ?? []
  const seen = new Set(listed.map((s) => s.name))
  const unlisted: string[] = []
  for (const name of [...stored, ...picked]) {
    if (seen.has(name)) continue
    seen.add(name)
    unlisted.push(name)
  }
  // Only a complete list can say a scope is gone.
  const note = !data
    ? undefined
    : data.hasMore
      ? `(not among the first ${PICKER_LIMIT})`
      : "(no longer exists)"
  return [
    ...listed.map((s) => ({ name: s.name })),
    ...unlisted.map((name) => ({ name, note })),
  ]
}
