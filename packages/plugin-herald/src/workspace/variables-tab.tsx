import { Button } from "@forge-go/dashboard-kit/components/button"
import { Checkbox } from "@forge-go/dashboard-kit/components/checkbox"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { plural } from "../format"
import type { VariableWire } from "../wire"
import { variableProblems } from "./draft"

/** Types the sample data knows a placeholder for. Herald itself accepts any string. */
const TYPES = ["string", "url", "number", "boolean"]

/** How a row is named in its controls' labels: its name, or its position while it has none. */
const nameOf = (v: VariableWire, i: number) => v.name.trim() || `variable ${i + 1}`

export function VariablesTab({ variables, onChange }: { variables: VariableWire[]; onChange: (next: VariableWire[]) => void }) {
  const problems = variableProblems(variables)
  const set = (i: number, patch: Partial<VariableWire>) => onChange(variables.map((v, j) => (j === i ? { ...v, ...patch } : v)))
  const move = (i: number, by: -1 | 1) => {
    const next = [...variables]
    const [row] = next.splice(i, 1)
    next.splice(i + by, 0, row)
    onChange(next)
  }

  return (
    <div className="flex flex-col gap-4">
      <table className="w-full text-sm">
        <caption className="mb-2 text-left text-sm text-muted-foreground">{plural(variables.length, "variable")}</caption>
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="py-1 pr-2 font-medium">Name</th>
            <th className="py-1 pr-2 font-medium">Type</th>
            <th className="py-1 pr-2 font-medium">Required</th>
            <th className="py-1 pr-2 font-medium">Default</th>
            <th className="py-1 pr-2 font-medium">Description</th>
            <th className="py-1">
              <span className="sr-only">Order and removal</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {variables.map((v, i) => (
            <tr key={i} className="border-t align-top">
              <td className="py-2 pr-2">
                <Input aria-label={`Name of variable ${i + 1}`} className="font-mono text-xs" autoComplete="off" spellCheck={false} value={v.name} aria-invalid={problems.has(i) || undefined} onChange={(e) => set(i, { name: e.target.value })} />
                {problems.has(i) && <p className="mt-1 text-xs text-destructive">{problems.get(i)}</p>}
              </td>
              <td className="py-2 pr-2">
                <Input aria-label={`Type of ${nameOf(v, i)}`} list="herald-variable-types" className="font-mono text-xs" autoComplete="off" spellCheck={false} value={v.type} onChange={(e) => set(i, { type: e.target.value })} />
              </td>
              <td className="py-2 pr-2">
                <Checkbox aria-label={`${nameOf(v, i)} is required`} checked={v.required} onCheckedChange={(checked) => set(i, { required: checked === true })} />
              </td>
              <td className="py-2 pr-2">
                <Input aria-label={`Default for ${nameOf(v, i)}`} value={v.default ?? ""} onChange={(e) => set(i, { default: e.target.value })} />
              </td>
              <td className="py-2 pr-2">
                <Input aria-label={`Description of ${nameOf(v, i)}`} value={v.description ?? ""} onChange={(e) => set(i, { description: e.target.value })} />
              </td>
              <td className="py-2 whitespace-nowrap">
                <Button type="button" size="xs" variant="ghost" aria-label={`Move ${nameOf(v, i)} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                  Up
                </Button>
                <Button type="button" size="xs" variant="ghost" aria-label={`Move ${nameOf(v, i)} down`} disabled={i === variables.length - 1} onClick={() => move(i, 1)}>
                  Down
                </Button>
                <Button type="button" size="xs" variant="ghost" aria-label={`Remove ${nameOf(v, i)}`} onClick={() => onChange(variables.filter((_, j) => j !== i))}>
                  Remove
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {variables.length === 0 && <p className="text-sm text-muted-foreground">No variables. Every send of this template renders the same text.</p>}
      <datalist id="herald-variable-types">
        {TYPES.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" size="sm" variant="outline" onClick={() => onChange([...variables, { name: "", type: "string", required: false }])}>
          Add variable
        </Button>
        <p className="text-xs text-muted-foreground">Edits here reach the preview straight away. Save writes them.</p>
      </div>
    </div>
  )
}
