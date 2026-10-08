import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import {
  PluginLink,
  queryStore,
  useCommand,
  usePluginClient,
} from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Checkbox } from "@forge-go/dashboard-kit/components/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@forge-go/dashboard-kit/components/dialog"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { NativeSelect } from "@forge-go/dashboard-kit/components/native-select"
import { CommandAlert } from "@forge-go/dashboard-kit/components/query-boundary"
import { commandOutcome, useAttemptKey } from "../attempt"
import { validID } from "../format"
import type { APIKey, SecretKeyResult } from "../types"
import { OneTimeKey } from "./one-time-key"
import { TenantFilter } from "./tenant-filter"
import { Notice } from "./read"
import { useKeyNavigationGuard } from "../use-key-navigation-guard"

export function KeyDialog({
  open,
  onOpenChange,
  tenantId,
  rotating,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  tenantId?: string
  rotating?: APIKey
}) {
  const [locked, setLocked] = useState(false)
  const lock = useRef(false)
  const changeLock = useCallback((value: boolean) => {
    lock.current = value
    setLocked(value)
  }, [])
  return (
    <Dialog
      open={open}
      disablePointerDismissal={locked}
      onOpenChange={(next, details) => {
        if (!next && lock.current) {
          details.cancel()
          return
        }
        onOpenChange(next)
      }}
    >
      <DialogContent
        showCloseButton={!locked}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
      >
        {open && (
          <KeyForm
            tenantId={tenantId}
            rotating={rotating}
            onLock={changeLock}
            onDone={() => {
              changeLock(false)
              onOpenChange(false)
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
function KeyForm({
  tenantId,
  rotating,
  onLock,
  onDone,
}: {
  tenantId?: string
  rotating?: APIKey
  onLock: (value: boolean) => void
  onDone: () => void
}) {
  const [selectedTenant, setTenant] = useState(tenantId)
  const [name, setName] = useState("")
  const [scopes, setScopes] = useState(["completions", "embeddings", "models"])
  const [expiry, setExpiry] = useState("never"),
    [customDate, setCustomDate] = useState("")
  const [openedAt] = useState(Date.now)
  const [problem, setProblem] = useState("")
  const [revealed, setRevealed] = useState<SecretKeyResult>()
  const command = useCommand<SecretKeyResult>(
    rotating ? "keys.rotate" : "keys.create"
  )
  const attempt = useAttemptKey(),
    sending = useRef(false)
  const payload = useRef<Record<string, unknown> | null>(null)
  const client = usePluginClient()
  const outcome = commandOutcome(command.error)
  const uncertain = outcome === "unknown" || outcome === "running"
  const spent = outcome === "spent"
  const locked = command.loading || !!revealed || uncertain || spent
  const releaseNavigation = useKeyNavigationGuard(locked)
  const done = () => {
    releaseNavigation()
    onDone()
  }
  useLayoutEffect(() => {
    onLock(locked)
  }, [locked, onLock])
  useEffect(() => {
    if (uncertain || spent)
      queryStore.invalidate(client.extension, [
        "keys.list",
        "keys.get",
        "tenants.get",
        "overview.get",
      ])
  }, [uncertain, spent, client.extension])
  async function submit() {
    if (sending.current || spent || revealed) return
    if (!uncertain) {
      if (rotating) payload.current = { id: rotating.id }
      else {
        if (!selectedTenant || !validID(selectedTenant, "tenant")) {
          setProblem("Choose a tenant.")
          return
        }
        if (!name.trim()) {
          setProblem("Key name is required.")
          return
        }
        if (!scopes.length) {
          setProblem("Choose at least one scope.")
          return
        }
        let expiresAt: string | undefined
        if (expiry !== "never") {
          const date =
            expiry === "custom"
              ? new Date(customDate)
              : new Date(openedAt + parseInt(expiry, 10) * 86400000)
          if (
            !Number.isFinite(date.getTime()) ||
            date.getTime() <= Date.now()
          ) {
            setProblem("Choose an expiry in the future.")
            return
          }
          expiresAt = date.toISOString()
        }
        payload.current = {
          tenantId: selectedTenant,
          name: name.trim(),
          scopes,
          ...(expiresAt ? { expiresAt } : {}),
        }
      }
    }
    if (!payload.current) return
    setProblem("")
    sending.current = true
    onLock(true)
    try {
      const result = await command.execute(payload.current, {
        idempotencyKey: attempt.keyFor(payload.current),
      })
      if (result) {
        setRevealed(result)
        command.reset()
        attempt.end()
        payload.current = null
      }
    } finally {
      sending.current = false
    }
  }
  if (revealed)
    return (
      <>
        <DialogHeader>
          <DialogTitle>Save your key</DialogTitle>
          <DialogDescription>
            {rotating
              ? "The previous key is revoked. Store the replacement before continuing."
              : "This key is shown once."}
          </DialogDescription>
        </DialogHeader>
        <OneTimeKey
          result={revealed}
          onDone={() => {
            setRevealed(undefined)
            done()
          }}
        />
      </>
    )
  return (
    <form
      className="space-y-3"
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <DialogHeader>
        <DialogTitle>{rotating ? "Rotate key" : "Create API key"}</DialogTitle>
        <DialogDescription>
          {rotating
            ? `${rotating.name}: the old key stops working immediately. There is no grace period.`
            : "Choose a customer and the access this key grants."}
        </DialogDescription>
      </DialogHeader>
      {spent ? (
        <>
          <p role="alert" className="text-sm">
            This command already completed. Its secret cannot be shown again.
            Review the key list, revoke any key whose secret was lost, then
            issue a new key.
          </p>
          <Button
            type="button"
            nativeButton={false}
            render={<PluginLink to="/keys" />}
            data-key-exit
            onClick={done}
          >
            Close and review keys
          </Button>
        </>
      ) : (
        <>
          {!rotating && (
            <fieldset
              disabled={command.loading || uncertain}
              className="space-y-3"
            >
              <div>
                <span className="mb-1 block text-sm">Tenant</span>
                <TenantFilter
                  value={selectedTenant}
                  onChange={setTenant}
                  required
                />
              </div>
              <label className="block space-y-1 text-sm">
                Key name
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Scopes</legend>
                <div className="flex flex-wrap gap-3">
                  {["completions", "embeddings", "models", "admin"].map(
                    (scope) => (
                      <label
                        key={scope}
                        htmlFor={`nexus-key-scope-${scope}`}
                        className={`flex items-center gap-2 text-sm ${scope === "admin" ? "w-full border-t pt-2" : ""}`}
                      >
                        <Checkbox
                          id={`nexus-key-scope-${scope}`}
                          checked={scopes.includes(scope)}
                          onCheckedChange={(checked) =>
                            setScopes((current) =>
                              checked
                                ? [...current, scope]
                                : current.filter((s) => s !== scope)
                            )
                          }
                        />
                        {scope}
                      </label>
                    )
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Admin can manage every tenant through /admin.
                </p>
              </fieldset>
              <label className="block space-y-1 text-sm">
                Expiry
                <NativeSelect
                  className="w-full"
                  value={expiry}
                  onChange={(e) => setExpiry(e.target.value)}
                >
                  <option value="never">Never</option>
                  <option value="30">30 days</option>
                  <option value="90">90 days</option>
                  <option value="365">365 days</option>
                  <option value="custom">Custom date and time</option>
                </NativeSelect>
              </label>
              {expiry === "custom" && (
                <label className="block space-y-1 text-sm">
                  Expires at (local time)
                  <Input
                    type="datetime-local"
                    value={customDate}
                    onChange={(e) => setCustomDate(e.target.value)}
                  />
                </label>
              )}
            </fieldset>
          )}
          {problem && (
            <p role="alert" className="text-sm text-destructive">
              {problem}
            </p>
          )}
          <CommandAlert
            title={rotating ? "Key rotation failed" : "Key creation failed"}
            error={command.error}
          />
          {uncertain && (
            <Notice>
              {outcome === "running"
                ? "The same command is still running."
                : "The response was lost. The command may have completed."}{" "}
              Retry the same request to learn its outcome. The tenant, scopes
              and expiry are held unchanged.
            </Notice>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            {!uncertain && (
              <Button
                type="button"
                variant="outline"
                disabled={command.loading}
                onClick={onDone}
              >
                Cancel
              </Button>
            )}
            <Button type="submit" disabled={command.loading}>
              {command.loading
                ? "Working…"
                : uncertain
                  ? "Retry same request"
                  : rotating
                    ? "Rotate key"
                    : "Create key"}
            </Button>
          </div>
        </>
      )}
    </form>
  )
}
