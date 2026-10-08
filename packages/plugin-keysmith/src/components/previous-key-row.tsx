import { IconButton } from "@forge-go/dashboard-kit/components/icon-button"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import type { KeyState } from "../types"

export interface PreviousKeyRowProps {
  /** The previous key as `maskedKey` gives it. */
  masked: string
  /** When its window closes on its own. */
  graceEnds: string
  /** The effective state of the key it was rotated into. */
  state: KeyState
  /** Opens the End now confirmation. */
  onEnd: () => void
}

/**
 * One previous key with an open window: the same row on the key's detail page
 * and in the rotate dialog's reveal, so the two never describe a window in
 * different words.
 *
 * Only an active key's previous keys work. ValidateKey checks the key's own
 * state whichever hash is presented, so while the key is suspended (or worse)
 * the window still runs but nothing is accepted, and the row says only when
 * it ends.
 */
export function PreviousKeyRow({
  masked,
  graceEnds,
  state,
  onEnd,
}: PreviousKeyRowProps) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2 text-sm">
      <span className="font-mono text-xs">{masked}</span>
      <span className="text-muted-foreground">
        {state === "active" ? "keeps working until" : "window ends"}
      </span>
      <Timestamp value={graceEnds} label="cutoff" />
      <IconButton
        variant="outline"
        className="ml-auto"
        onClick={onEnd}
        label="End now"
      />
    </li>
  )
}
