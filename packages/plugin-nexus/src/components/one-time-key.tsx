import { useEffect, useId, useRef, useState } from "react"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { IconButton } from "@forge-go/dashboard-kit/components/icon-button"
import { Checkbox } from "@forge-go/dashboard-kit/components/checkbox"
import { CopyIcon, EyeIcon, EyeOffIcon } from "@forge-go/dashboard-kit/icons"
import type { SecretKeyResult } from "../types"
export function OneTimeKey({
  result,
  onDone,
}: {
  result: SecretKeyResult
  onDone: () => void
}) {
  const [hidden, setHidden] = useState(false),
    [stored, setStored] = useState(false),
    [message, setMessage] = useState("")
  const [selection, setSelection] = useState(0)
  const box = useRef<HTMLDivElement>(null),
    alive = useRef(false)
  const id = useId()
  useEffect(() => {
    alive.current = true
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", warn)
    return () => {
      alive.current = false
      window.removeEventListener("beforeunload", warn)
    }
  }, [])
  useEffect(() => {
    if (selection && box.current)
      window.getSelection()?.selectAllChildren(box.current)
  }, [selection])
  async function copy() {
    setMessage("")
    try {
      await navigator.clipboard.writeText(result.rawKey)
      if (alive.current) setMessage("Copied to clipboard.")
    } catch {
      if (alive.current) {
        setHidden(false)
        setSelection((n) => n + 1)
        setMessage("Couldn't copy. The key is selected: press Ctrl+C or Cmd+C.")
      }
    }
  }
  return (
    <div className="space-y-3">
      <p className="text-sm">
        Copy this key now. You won't be able to read it again.
      </p>
      <div
        ref={box}
        tabIndex={0}
        aria-label="New API key"
        className="rounded-md border bg-muted/30 p-3 font-mono text-sm break-all select-all"
      >
        {hidden ? "••••••••••••••••" : result.rawKey}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <IconButton
          data-key-copy
          label="Copy key"
          icon={CopyIcon}
          onClick={() => void copy()}
        />
        <IconButton
          data-key-hide
          label={hidden ? "Show key" : "Hide key"}
          icon={hidden ? EyeIcon : EyeOffIcon}
          onClick={() => setHidden(!hidden)}
        />
        <span className="text-xs text-muted-foreground">
          You'll recognise it as <code>{result.key.prefix}…</code>
        </span>
      </div>
      <p aria-live="polite" className="text-xs text-muted-foreground">
        {message}
      </p>
      <label htmlFor={id} className="flex items-center gap-2 text-sm">
        <Checkbox
          id={id}
          data-key-stored
          checked={stored}
          onCheckedChange={(value) => setStored(value === true)}
        />
        I've stored this key somewhere safe
      </label>
      <div className="flex justify-end">
        <Button data-key-done disabled={!stored} onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  )
}
