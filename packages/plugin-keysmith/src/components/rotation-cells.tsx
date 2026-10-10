import { PluginLink } from "@forge-go/dashboard-plugin"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { keyPath, rotationMasked } from "../format"
import type { RotationItem } from "../types"

/*
 * The cells of a rotation row. The Rotations page and the overview's recent
 * rotations use both, and a key's rotation history uses the window cell. One
 * copy, so every page names a key and words a window alike.
 */

/**
 * The rotated key by name, linked to its page, with the key it was rotated
 * into masked beneath. A key that no longer exists has no page and no name,
 * so its id stands in as a raw value and the row says why.
 */
export function KeyCell({ item }: { item: RotationItem }) {
  if (item.keyName === null) {
    return (
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="font-mono text-xs font-normal">{item.keyId}</span>
        <span className="text-xs font-normal text-muted-foreground">
          Key no longer exists
        </span>
      </div>
    )
  }
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <PluginLink to={keyPath(item.keyId)}>{item.keyName}</PluginLink>
      <span className="font-mono text-xs font-normal text-muted-foreground">
        {rotationMasked(item, "new")}
      </span>
    </div>
  )
}

/**
 * Whether the window is still running, worded neutrally. A suspended key's
 * window is open, yet its old key is refused until the key is reactivated,
 * so this never says the old key keeps working. The contract never reports
 * a gone key's window open; the cell holds the same line regardless.
 */
export function WindowCell({ item }: { item: RotationItem }) {
  if (!item.windowOpen || item.keyName === null) {
    return <span className="text-muted-foreground">Closed</span>
  }
  return (
    <span>
      Window ends <Timestamp value={item.graceEnds} label="window end" />
    </span>
  )
}
