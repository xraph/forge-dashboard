import { Button } from "@forge-go/dashboard-kit/components/button"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"

export interface PreviousKeyRowProps {
  /** The previous key as `maskedKey` gives it. */
  masked: string
  /** When its window closes on its own. */
  graceEnds: string
  /** Opens the End now confirmation. */
  onEnd: () => void
}

/**
 * One previous key that still works: the same row on the key's detail page
 * and in the rotate dialog's reveal, so the two never describe a window in
 * different words.
 */
export function PreviousKeyRow({ masked, graceEnds, onEnd }: PreviousKeyRowProps) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2 text-sm">
      <span className="font-mono text-xs">{masked}</span>
      <span className="text-muted-foreground">keeps working until</span>
      <Timestamp value={graceEnds} label="cutoff" />
      <Button variant="outline" size="sm" className="ml-auto" onClick={onEnd}>
        End now
      </Button>
    </li>
  )
}
