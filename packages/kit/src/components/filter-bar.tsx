import { useId, type ReactNode } from "react"
import { cn } from "@forge-go/dashboard-kit/lib/utils"
import { Input } from "@forge-go/dashboard-kit/components/input"
import {
  NativeSelect,
  NativeSelectOption,
} from "@forge-go/dashboard-kit/components/native-select"

export interface SearchConfig {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  /** The accessible name. Defaults to "Search". */
  label?: string
}

export interface FilterOption {
  label: string
  value: string
}

export interface FilterConfig {
  id: string
  label: string
  value: string
  options: FilterOption[]
  onChange: (value: string) => void
}

export interface FilterBarProps {
  search?: SearchConfig
  filters?: FilterConfig[]
  actions?: ReactNode
  className?: string
}

function Filter({ filter }: { filter: FilterConfig }) {
  const id = useId()
  return (
    <div className="flex items-center gap-1.5">
      <label htmlFor={id} className="text-xs text-muted-foreground">
        {filter.label}
      </label>
      <NativeSelect
        id={id}
        value={filter.value}
        onChange={(event) => filter.onChange(event.target.value)}
      >
        {filter.options.map((option) => (
          <NativeSelectOption key={option.value} value={option.value}>
            {option.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  )
}

/**
 * Search and filters above a list.
 *
 * Fully controlled and stateless. It does not debounce, does not remember a
 * previous value, and never issues a query. A page that wants debouncing owns
 * it, because the right delay depends on what the query costs, which this
 * block cannot know.
 *
 * Renders `null` when it has nothing to show, so a page can hand it optional
 * config without guarding, and without leaving an empty toolbar row behind.
 */
export function FilterBar({
  search,
  filters = [],
  actions,
  className,
}: FilterBarProps) {
  if (!search && filters.length === 0 && !actions) return null

  return (
    <div className={cn("flex flex-wrap items-center gap-3", className)}>
      {search && (
        <Input
          type="search"
          aria-label={search.label ?? "Search"}
          placeholder={search.placeholder}
          value={search.value}
          onChange={(event) => search.onChange(event.target.value)}
          className="h-8 w-56"
        />
      )}
      {filters.map((filter) => (
        <Filter key={filter.id} filter={filter} />
      ))}
      {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
    </div>
  )
}
