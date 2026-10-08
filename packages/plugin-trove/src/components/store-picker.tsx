import { IconButton } from "@forge-go/dashboard-kit/components/icon-button"
import { useEffect } from "react"
import { useQuery } from "@forge-go/dashboard-plugin"
import {
  NativeSelect,
  NativeSelectOption,
} from "@forge-go/dashboard-kit/components/native-select"
import { setActiveStore, useActiveStore } from "../store"
import type { StoresList } from "../types"

/**
 * Picks the store every page reads. Renders nothing in single-store mode,
 * where there is nothing to pick. A remembered store the server no longer
 * lists falls back to the default rather than failing every page. When the
 * list itself cannot be read, a store other than the default stays in use, so
 * the picker says which one and offers the way back.
 */
export function StorePicker() {
  const active = useActiveStore()
  const stores = useQuery<StoresList>("stores.list", {})
  const list = stores.data
  const known =
    list === undefined ||
    active === "" ||
    list.stores.some((s) => s.name === active)

  useEffect(() => {
    if (!known) setActiveStore("")
  }, [known])

  if (stores.error && active !== "") {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">
          Store list unavailable, showing{" "}
          <span className="font-mono text-xs">{active}</span>
        </span>
        <IconButton
          variant="outline"
          onClick={() => setActiveStore("")}
          label="Use default"
        />
      </div>
    )
  }
  if (!list || list.mode !== "multi") return null
  const fallback =
    list.stores.find((s) => s.isDefault)?.name ?? list.stores[0]?.name ?? ""
  const value = active !== "" && known ? active : fallback

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">Store</span>
      <NativeSelect
        aria-label="Store"
        value={value}
        onChange={(e) =>
          setActiveStore(e.target.value === fallback ? "" : e.target.value)
        }
      >
        {list.stores.map((s) => (
          <NativeSelectOption key={s.name} value={s.name}>
            {s.isDefault ? `${s.name} (default)` : s.name}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </label>
  )
}
