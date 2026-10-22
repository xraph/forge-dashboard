import { useEffect, useId, useRef, useState } from "react"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Checkbox } from "@forge-go/dashboard-kit/components/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@forge-go/dashboard-kit/components/dialog"
import { IconButton } from "@forge-go/dashboard-kit/components/icon-button"
import { Label } from "@forge-go/dashboard-kit/components/label"
import type { Credentials } from "../types"

const COPIED_MS = 2000
// Read out by the live region. Neither may ever contain the secret.
const COPY_OK = "Copied to clipboard"
const COPY_FAILED = "Couldn't copy. Select the text and press Ctrl+C or Cmd+C."

type Field = "username" | "password"

export interface CredentialsDialogProps {
  /** What devices.provision or devices.rotate answered, or null for closed. */
  credentials: Credentials | null
  /** Called once, from Done. The caller forgets the credentials here. */
  onClose: () => void
}

/**
 * The only place a device's password is ever shown. The server answers it once
 * and keeps a hash, so the operator has to say they have stored it before Done
 * unlocks, and nothing else closes the dialog: not Escape, not a click outside,
 * not a corner button. Done calls `onClose`, which is where the caller drops
 * the credentials, and the body is mounted only while there are some, so the
 * password leaves the page with the dialog.
 */
export function CredentialsDialog({
  credentials,
  onClose,
}: CredentialsDialogProps) {
  if (credentials === null) return null
  return <CredentialsBody credentials={credentials} onClose={onClose} />
}

function CredentialsBody({
  credentials,
  onClose,
}: {
  credentials: Credentials
  onClose: () => void
}) {
  const [copied, setCopied] = useState<Field | null>(null)
  const [message, setMessage] = useState("")
  const [stored, setStored] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const mounted = useRef(false)
  const storedId = useId()

  // Closing the tab or reloading would lose a password that cannot be shown
  // again, so the browser asks first while this is up.
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

  async function copy(field: Field) {
    // Emptied first: a live region does not read the same text out twice.
    setMessage("")
    try {
      await navigator.clipboard.writeText(credentials[field])
    } catch {
      if (!mounted.current) return
      window.clearTimeout(timer.current)
      setCopied(null)
      setMessage(COPY_FAILED)
      return
    }
    if (!mounted.current) return
    setCopied(field)
    setMessage(COPY_OK)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopied(null), COPIED_MS)
  }

  return (
    <Dialog
      open
      // Only Done closes this. A dismissal the operator did not mean would
      // throw away a password that cannot be fetched again.
      onOpenChange={(_open, details) => details.cancel()}
      disablePointerDismissal
    >
      <DialogContent showCloseButton={false} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Device credentials</DialogTitle>
          <DialogDescription>
            {`Connect ${credentials.device.name} with these. This is the only time Tether will show the password.`}
          </DialogDescription>
        </DialogHeader>

        <dl className="flex min-w-0 flex-col gap-3 text-sm">
          <Secret
            term="Username"
            value={credentials.username}
            copyLabel={
              copied === "username" ? "Copied username" : "Copy username"
            }
            onCopy={() => void copy("username")}
          />
          <Secret
            term="Password"
            value={credentials.password}
            copyLabel={
              copied === "password" ? "Copied password" : "Copy password"
            }
            onCopy={() => void copy("password")}
          />
        </dl>

        <span role="status" aria-live="polite" className="sr-only">
          {message}
        </span>

        <div className="flex items-center gap-2">
          <Checkbox
            id={storedId}
            checked={stored}
            onCheckedChange={(checked) => setStored(checked === true)}
          />
          <Label htmlFor={storedId}>
            I&apos;ve stored these credentials somewhere safe
          </Label>
        </div>

        <DialogFooter>
          <Button disabled={!stored} onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Secret({
  term,
  value,
  copyLabel,
  onCopy,
}: {
  term: string
  value: string
  copyLabel: string
  onCopy: () => void
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="flex min-w-0 items-start gap-2">
        <span
          translate="no"
          className="min-w-0 flex-1 rounded-md border bg-muted/40 p-2 font-mono text-xs break-all select-all"
        >
          {value}
        </span>
        <IconButton variant="outline" label={copyLabel} onClick={onCopy} />
      </dd>
    </div>
  )
}
