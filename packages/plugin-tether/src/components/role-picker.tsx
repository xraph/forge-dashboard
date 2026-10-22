import { useId } from "react"
import { Checkbox } from "@forge-go/dashboard-kit/components/checkbox"
import { Label } from "@forge-go/dashboard-kit/components/label"
import type { QueryState } from "@forge-go/dashboard-plugin"
import { TetherCommandAlert } from "./boundary"
import type { Role, RolesList } from "../types"

/**
 * The slugs to offer: every role the tenant has, then any the device holds that
 * the tenant no longer lists, so a stale one can still be taken off.
 */
export function roleOptions(known: Role[], selected: string[]): string[] {
  const slugs = known.map((r) => r.slug)
  const extra = selected.filter((s) => !slugs.includes(s)).sort()
  return [...slugs, ...extra]
}

export interface RolePickerProps {
  /** `roles.list`, read by the dialog that hosts this. */
  roles: QueryState<RolesList>
  selected: string[]
  onChange: (slugs: string[]) => void
  disabled?: boolean
}

/**
 * A checkbox per role of the tenant. The output keeps the order of the options
 * (the tenant's roles sorted by slug), so the same selection sends the same
 * array every time.
 */
export function RolePicker({
  roles,
  selected,
  onChange,
  disabled,
}: RolePickerProps) {
  const base = useId()

  if (roles.error) {
    return (
      <TetherCommandAlert error={roles.error} title="Could not load roles" />
    )
  }
  if (roles.data === undefined) {
    return <p className="text-xs text-muted-foreground">Loading roles…</p>
  }

  const known = roles.data.items ?? []
  const options = roleOptions(known, selected)
  if (options.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        This tenant has no roles yet. Create them in the Roles &amp; topics tab.
      </p>
    )
  }

  function toggle(slug: string, on: boolean) {
    const next = new Set(selected)
    if (on) next.add(slug)
    else next.delete(slug)
    onChange(options.filter((o) => next.has(o)))
  }

  return (
    <ul className="flex flex-col gap-2">
      {options.map((slug) => {
        const role = known.find((r) => r.slug === slug)
        const id = `${base}-${slug}`
        return (
          <li key={slug} className="flex items-center gap-2">
            <Checkbox
              id={id}
              disabled={disabled}
              checked={selected.includes(slug)}
              onCheckedChange={(checked) => toggle(slug, checked === true)}
            />
            <Label htmlFor={id} className="font-mono text-xs">
              {slug}
            </Label>
            <span className="text-xs text-muted-foreground">
              {role ? role.name : "no longer defined"}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
