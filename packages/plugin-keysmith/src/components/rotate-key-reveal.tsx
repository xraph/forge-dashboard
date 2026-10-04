import { useState } from "react"
import {
  DialogHeader,
  DialogTitle,
} from "@forge-go/dashboard-kit/components/dialog"
import { maskedKey } from "../format"
import type { KeyRotated, PreviousKey } from "../types"
import { EndGraceDialog } from "./end-grace-dialog"
import { OneTimeKey } from "./one-time-key"
import { PreviousKeyRow } from "./previous-key-row"

/** What the rotate form keeps once the server has answered. */
export interface Rotation {
  result: KeyRotated
  /**
   * The hint the key had when Rotate was pressed. The window this rotation
   * opened carries it; the page's own copy of the key moves on to the new
   * hint as soon as it refetches, so it cannot be asked afterwards.
   */
  previousHint: string
  /** The operator said compromise, or asked for no grace at all. */
  urgent: boolean
}

export interface RotateKeyRevealProps {
  rotation: Rotation
  onDone: () => void
}

/**
 * The new key, once, with the windows still open on the key it replaced.
 *
 * Everything here comes from the rotate command's own answer and from what
 * was true when it was sent, never from the page's live copy of the key.
 */
export function RotateKeyReveal({ rotation, onDone }: RotateKeyRevealProps) {
  const { result, previousHint, urgent } = rotation
  const [windowsEnded, setWindowsEnded] = useState(false)
  const [ending, setEnding] = useState(false)

  const windows = windowsEnded ? [] : result.previousKeys
  // This rotation opened at most one window, and it carries the hint the key
  // had when Rotate was pressed. Any window beyond that one was already open.
  // Which of two same-hint windows is "this one" does not matter (the hint is
  // only four characters): either way one of them is earlier, so nothing
  // here compares times.
  const openedOne = windows.some((p) => p.hint === previousHint)
  const earlierOpen = windows.length > (openedOne ? 1 : 0)
  const maskedOf = (p: PreviousKey) =>
    maskedKey({
      prefix: result.key.prefix,
      environment: result.key.environment,
      hint: p.hint,
    })

  return (
    <>
      <DialogHeader>
        <DialogTitle>Save your new key</DialogTitle>
      </DialogHeader>
      <OneTimeKey
        rawKey={result.rawKey}
        summary={result.key}
        onDone={onDone}
        showHeading={false}
      >
        <div className="flex flex-col gap-2">
          {windows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {windowsEnded
                ? "Every previous key has been stopped."
                : "Your previous key stopped working when you rotated."}
            </p>
          ) : (
            <>
              <ul className="flex flex-col gap-2">
                {windows.map((p) => (
                  <PreviousKeyRow
                    key={p.rotationId}
                    masked={maskedOf(p)}
                    graceEnds={p.graceEnds}
                    onEnd={() => setEnding(true)}
                  />
                ))}
              </ul>
              {earlierOpen && (
                <p className="text-sm text-muted-foreground">
                  {urgent
                    ? "An earlier previous key is still accepted. End it now if it may also be compromised."
                    : "An earlier previous key is still accepted."}
                </p>
              )}
            </>
          )}
        </div>
      </OneTimeKey>
      <EndGraceDialog
        open={ending}
        onOpenChange={setEnding}
        keyId={result.key.id}
        masked={windows.map(maskedOf)}
        onEnded={() => setWindowsEnded(true)}
      />
    </>
  )
}
