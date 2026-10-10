import { IconButton } from "@forge-go/dashboard-kit/components/icon-button"
import { useEffect, useId, useRef, useState } from "react"
import type { ReactNode } from "react"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Checkbox } from "@forge-go/dashboard-kit/components/checkbox"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { maskedKey } from "../format"
import type { KeySummary } from "../types"

export interface OneTimeKeyProps {
  /** The key as the server returned it. Rendered here and copied to the clipboard, nowhere else. */
  rawKey: string
  /** prefix, environment and hint: what the key reads as in every list afterwards. */
  summary: KeySummary
  /** Extra content under the key, such as the rotate dialog's window list. */
  children?: ReactNode
  onDone: () => void
  /**
   * Show the "Save your new key" heading. A host that already names the thing
   * (a dialog titled the same) turns it off so there is one accessible name,
   * not two.
   */
  showHeading?: boolean
}

const COPIED_MS = 2000
const UNDERLINED = 4
// Read out by the live region. Neither may ever contain the key.
const COPY_OK = "Copied to clipboard"
const COPY_FAILED = "Couldn't copy. The key is selected: press Ctrl+C or Cmd+C."

/**
 * The single place a raw API key is ever shown. The server will not show it
 * again, so the person has to say they have stored it before Done unlocks, and
 * the browser warns before the page is closed or reloaded while this is up.
 *
 * The key is cut by known lengths, never by "_": a custom generator may put
 * underscores anywhere, or nowhere.
 */
export function OneTimeKey({
  rawKey,
  summary,
  children,
  onDone,
  showHeading = true,
}: OneTimeKeyProps) {
  const [hidden, setHidden] = useState(false)
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const [stored, setStored] = useState(false)
  const [message, setMessage] = useState("")
  const [selectRequest, setSelectRequest] = useState(0)
  const timer = useRef<number | undefined>(undefined)
  const mounted = useRef(false)
  const keyBox = useRef<HTMLDivElement>(null)
  const checkboxId = useId()

  useEffect(() => {
    function warn(event: BeforeUnloadEvent) {
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      window.clearTimeout(timer.current)
    }
  }, [])

  // Selecting has to wait for the render that shows the key, or a key that was
  // hidden would be selected as bullets and the selection would collapse.
  useEffect(() => {
    if (selectRequest > 0 && keyBox.current) {
      window.getSelection()?.selectAllChildren(keyBox.current)
    }
  }, [selectRequest])

  function selectKey() {
    setHidden(false)
    setSelectRequest((n) => n + 1)
  }

  async function copy() {
    // Emptied first: a live region does not read out the same text twice, so
    // a second "Copied to clipboard" would otherwise be silent.
    setMessage("")
    if (copyFailed) selectKey()
    try {
      await navigator.clipboard.writeText(rawKey)
    } catch {
      // Clipboard access can be denied or missing. Show the key, select it so
      // Ctrl+C or Cmd+C works at once, and say so for screen readers.
      if (!mounted.current) return
      window.clearTimeout(timer.current)
      setCopied(false)
      setCopyFailed(true)
      setMessage(COPY_FAILED)
      selectKey()
      return
    }
    if (!mounted.current) return
    setCopyFailed(false)
    setCopied(true)
    setMessage(COPY_OK)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopied(false), COPIED_MS)
  }

  const known = `${summary.prefix}_${summary.environment}_`
  const head = rawKey.startsWith(known) ? known : ""
  const rest = rawKey.slice(head.length)
  const tail = rest.slice(-UNDERLINED)
  const body = rest.slice(0, rest.length - tail.length)

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        {showHeading && (
          <h2 className="text-lg font-semibold">Save your new key</h2>
        )}
        <p className="text-sm text-muted-foreground">
          This is the only time Keysmith will show it.
        </p>
      </div>

      <div
        ref={keyBox}
        data-part="key"
        translate="no"
        className="rounded-md border bg-muted/40 p-3 font-mono text-lg break-all select-all"
      >
        {hidden ? (
          <span aria-hidden="true">••••</span>
        ) : (
          <>
            {head && (
              <span data-part="prefix" className="text-muted-foreground">
                {head}
              </span>
            )}
            <span data-part="body">{body}</span>
            <span data-part="tail" className="underline">
              {tail}
            </span>
          </>
        )}
      </div>
      {hidden && <span className="sr-only">Key hidden</span>}

      <p className="text-sm text-muted-foreground">
        You&apos;ll recognise it later as{" "}
        <span className="font-mono text-foreground">{maskedKey(summary)}</span>
      </p>

      <div className="flex gap-2">
        <IconButton
          variant="outline"
          onClick={() => void copy()}
          label={copied ? "Copied" : copyFailed ? "Select and copy" : "Copy"}
        />
        {/* A toggle keeps one label and says its state with aria-pressed. A
            label that flipped to "Show" would read as "Show, pressed". The
            kit Button has no pressed style, so the class shows it too. The
            dark one is named as well: outline's dark:bg-input/30 is as
            specific as aria-pressed:bg-muted and comes later in the CSS. */}
        <IconButton
          variant="outline"
          className="aria-pressed:bg-muted aria-pressed:text-foreground dark:aria-pressed:bg-muted"
          aria-pressed={hidden}
          onClick={() => setHidden((h) => !h)}
          label="Hide key"
        />
      </div>

      <span role="status" aria-live="polite" className="sr-only">
        {message}
      </span>

      {children}

      <div className="flex items-center gap-2">
        <Checkbox
          id={checkboxId}
          checked={stored}
          onCheckedChange={(checked) => setStored(checked === true)}
        />
        <Label htmlFor={checkboxId}>
          I&apos;ve stored this key somewhere safe
        </Label>
      </div>

      <div className="flex justify-end">
        <Button disabled={!stored} onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  )
}
