import { IconButton } from "@forge-go/dashboard-kit/components/icon-button"
import { useEffect, useRef, useState } from "react"
import { Checkbox } from "@forge-go/dashboard-kit/components/checkbox"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { plural } from "../format"
import type { VariableWire } from "../wire"
import { variableProblems } from "./draft"

/** Types the sample data knows a placeholder for. Herald itself accepts any string. */
const TYPES = ["string", "url", "number", "boolean"]

/** How a row is named in its controls' labels: its name, or its position while it has none. */
const nameOf = (v: VariableWire, i: number) =>
  v.name.trim() || `variable ${i + 1}`

let rowCounter = 0
const newRowId = () => `row-${++rowCounter}`

export function VariablesTab({
  variables,
  onChange,
}: {
  variables: VariableWire[]
  onChange: (next: VariableWire[]) => void
}) {
  const problems = variableProblems(variables)
  // A stable id per row, so a row keeps its DOM (and focus) when it moves. The parent can replace the whole list, which resets the ids.
  const [stored, setIds] = useState<string[]>(() => variables.map(newRowId))
  let ids = stored
  if (stored.length !== variables.length) {
    ids = variables.map(newRowId)
    setIds(ids)
  }
  const root = useRef<HTMLDivElement>(null)
  const refocus = useRef<number | null>(null)
  useEffect(() => {
    if (refocus.current === null) return
    const at = refocus.current
    refocus.current = null
    const removes =
      root.current?.querySelectorAll<HTMLButtonElement>("[data-remove-row]")
    const target =
      removes && removes.length > 0
        ? removes[Math.min(at, removes.length - 1)]
        : root.current?.querySelector<HTMLButtonElement>("[data-add-variable]")
    target?.focus()
  })
  const set = (i: number, patch: Partial<VariableWire>) =>
    onChange(variables.map((v, j) => (j === i ? { ...v, ...patch } : v)))
  const move = (i: number, by: -1 | 1) => {
    const next = [...variables]
    const [row] = next.splice(i, 1)
    next.splice(i + by, 0, row)
    const order = [...ids]
    const [id] = order.splice(i, 1)
    order.splice(i + by, 0, id)
    setIds(order)
    onChange(next)
  }
  const add = () => {
    setIds([...ids, newRowId()])
    onChange([...variables, { name: "", type: "string", required: false }])
  }
  const remove = (i: number) => {
    setIds(ids.filter((_, j) => j !== i))
    refocus.current = i
    onChange(variables.filter((_, j) => j !== i))
  }

  return (
    <div ref={root} className="flex min-w-0 flex-col gap-4">
      <table className="w-full table-fixed text-sm">
        <caption className="mb-2 text-left text-sm text-muted-foreground">
          {plural(variables.length, "variable")}
        </caption>
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="w-[28%] py-1 pr-2 font-medium">Name</th>
            <th className="w-[16%] py-1 pr-2 font-medium">Type</th>
            <th className="w-[9%] py-1 pr-2 font-medium">Required</th>
            <th className="w-[18%] py-1 pr-2 font-medium">Default</th>
            <th className="py-1 pr-2 font-medium">Description</th>
            <th className="w-44 py-1">
              <span className="sr-only">Order and removal</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {variables.map((v, i) => (
            <tr key={ids[i]} className="border-t align-top">
              <td className="py-2 pr-2">
                <Input
                  aria-label={`Name of variable ${i + 1}`}
                  className="font-mono text-xs"
                  autoComplete="off"
                  spellCheck={false}
                  value={v.name}
                  aria-invalid={problems.has(i) || undefined}
                  aria-describedby={
                    problems.has(i) ? `var-problem-${ids[i]}` : undefined
                  }
                  onChange={(e) => set(i, { name: e.target.value })}
                />
                {problems.has(i) && (
                  <p
                    id={`var-problem-${ids[i]}`}
                    className="mt-1 text-xs text-destructive"
                  >
                    {problems.get(i)}
                  </p>
                )}
              </td>
              <td className="py-2 pr-2">
                <Input
                  aria-label={`Type of ${nameOf(v, i)}`}
                  list="herald-variable-types"
                  className="font-mono text-xs"
                  autoComplete="off"
                  spellCheck={false}
                  value={v.type}
                  onChange={(e) => set(i, { type: e.target.value })}
                />
              </td>
              <td className="py-2 pr-2">
                <Checkbox
                  aria-label={`${nameOf(v, i)} is required`}
                  checked={v.required}
                  onCheckedChange={(checked) =>
                    set(i, { required: checked === true })
                  }
                />
              </td>
              <td className="py-2 pr-2">
                <Input
                  aria-label={`Default for ${nameOf(v, i)}`}
                  value={v.default ?? ""}
                  onChange={(e) => set(i, { default: e.target.value })}
                />
              </td>
              <td className="py-2 pr-2">
                <Input
                  aria-label={`Description of ${nameOf(v, i)}`}
                  value={v.description ?? ""}
                  onChange={(e) => set(i, { description: e.target.value })}
                />
              </td>
              <td className="py-2 whitespace-nowrap">
                <IconButton
                  type="button"
                  variant="ghost"
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                  label={`Move ${nameOf(v, i)} up`}
                />
                <IconButton
                  type="button"
                  variant="ghost"
                  disabled={i === variables.length - 1}
                  onClick={() => move(i, 1)}
                  label={`Move ${nameOf(v, i)} down`}
                />
                <IconButton
                  type="button"
                  variant="ghost"
                  data-remove-row
                  onClick={() => remove(i)}
                  label={`Remove ${nameOf(v, i)}`}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {variables.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No variables. Every send of this template renders the same text.
        </p>
      )}
      <datalist id="herald-variable-types">
        {TYPES.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      <div className="flex flex-wrap items-center gap-3">
        <IconButton
          type="button"
          variant="outline"
          data-add-variable
          onClick={add}
          label="Add variable"
        />
        <p className="text-xs text-muted-foreground">
          Edits here reach the preview straight away. Save writes them.
        </p>
      </div>
    </div>
  )
}
