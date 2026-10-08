import { useState } from "react"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { NativeSelect, NativeSelectOption } from "@forge-go/dashboard-kit/components/native-select"

type Mode = "all" | "none" | "named"

function modeOf(value: string | null): Mode {
  if (value === null) return "all"
  return value === "" ? "none" : "named"
}

/**
 * Picks the tenant a list or a retrieval run is narrowed to. The dashboard is
 * operator-wide, so the default is every tenant. A named tenant with a blank
 * name is no filter yet, not the untenanted filter.
 */
export function TenantFilter({ value, onChange }: { value: string | null; onChange: (tenant: string | null) => void }) {
  const [mode, setMode] = useState<Mode>(modeOf(value))
  const [name, setName] = useState(value ?? "")

  return (
    <div className="flex items-center gap-2 text-sm">
      <NativeSelect
        aria-label="Tenant"
        value={mode}
        onChange={(e) => {
          const next = e.target.value as Mode
          setMode(next)
          if (next === "all") onChange(null)
          else if (next === "none") onChange("")
          else onChange(name.trim() === "" ? null : name.trim())
        }}
      >
        <NativeSelectOption value="all">All tenants</NativeSelectOption>
        <NativeSelectOption value="none">No tenant</NativeSelectOption>
        <NativeSelectOption value="named">One tenant</NativeSelectOption>
      </NativeSelect>
      {mode === "named" ? (
        <Input
          aria-label="Tenant ID"
          className="w-40 font-mono text-xs"
          placeholder="tenant ID"
          value={name}
          spellCheck={false}
          onChange={(e) => {
            setName(e.target.value)
            onChange(e.target.value.trim() === "" ? null : e.target.value.trim())
          }}
        />
      ) : null}
    </div>
  )
}
