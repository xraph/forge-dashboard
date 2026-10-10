import { IconButton } from "@forge-go/dashboard-kit/components/icon-button"
import { useRef, useState } from "react"
import type { ComponentType, FormEvent } from "react"
import {
  PluginLink,
  useCommand,
  useNavigateTo,
  useQuery,
} from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import {
  DescriptionList,
  DetailLayout,
} from "@forge-go/dashboard-kit/components/detail-layout"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@forge-go/dashboard-kit/components/dialog"
import { EmptyState } from "@forge-go/dashboard-kit/components/empty-state"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import {
  CommandAlert,
  QueryBoundary,
} from "@forge-go/dashboard-kit/components/query-boundary"
import {
  RadioGroup,
  RadioGroupItem,
} from "@forge-go/dashboard-kit/components/radio-group"
import { TagList } from "@forge-go/dashboard-kit/components/tag-list"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import {
  EncryptionBadge,
  PolicyStatusBadge,
  RotatorBadge,
  VersionEncryptionBadge,
} from "../badges"
import { RecentActivity } from "../components/recent-activity"
import { toRFC3339 } from "../datetime"
import { formatInterval } from "../interval"
import type { AuditEntry } from "../flag-types"
import { rotationPath } from "../keys"
import type { RotationPolicy } from "./rotation"
import type { SecretSummary } from "./secrets"

/** Mirrors the Go `secretsDetailResponse`. `rotation` is an explicit null. */
interface SecretDetail {
  secret: SecretSummary
  rotation: RotationPolicy | null
  recentAudit: AuditEntry[] | null
}

/** Mirrors the Go `SecretVersionSummary`. It never carries a value. */
interface SecretVersion {
  id: string
  version: number
  createdBy?: string
  createdAt: string
  /** "encrypted", "plaintext", or "unknown" for a row vault never recorded. */
  encryption: "encrypted" | "plaintext" | "unknown"
}

interface VersionsResponse {
  versions: SecretVersion[] | null
}

/** Mirrors the Go `secretsUpdateResponse`. It never carries a value. */
interface UpdateResponse {
  secret: SecretSummary
}

/** Mirrors the Go `secretsDeleteResponse`. */
interface DeleteResponse {
  ok: boolean
  key: string
}

function isPast(iso: string): boolean {
  return Date.parse(iso) <= Date.now()
}

/**
 * The detail page for one secret.
 *
 * `params.key` arrives already decoded by the router. It is split from the
 * body so a missing key renders a status line without the body's hooks ever
 * running: a hook cannot be skipped, and a query with no key would ask the
 * server about a secret called "".
 */
export const SecretDetailPage: ComponentType<PluginPageProps> = ({
  params,
}) => {
  const key = params.key
  if (!key) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        No secret key in the address, so there is nothing to show.
      </p>
    )
  }
  return <SecretDetailBody secretKey={key} />
}

function SecretDetailBody({ secretKey }: { secretKey: string }) {
  const detail = useQuery<SecretDetail>("secrets.detail", { key: secretKey })
  const versions = useQuery<VersionsResponse>("secrets.versions", {
    key: secretKey,
  })
  const update = useCommand<UpdateResponse>("secrets.update")
  const remove = useCommand<DeleteResponse>("secrets.delete")
  const navigateTo = useNavigateTo()

  const [replacing, setReplacing] = useState(false)
  const [deleting, setDeleting] = useState(false)

  function openReplace() {
    // Reset at open, not at close: the operator is about to read whatever the
    // dialog shows now, so an error from an earlier attempt must not greet
    // them. The dialog body mounts fresh on each open, which empties the
    // value input and the expiry choice.
    update.reset()
    setReplacing(true)
  }

  function openDelete() {
    remove.reset()
    setDeleting(true)
  }

  async function confirmDelete() {
    const result = await remove.execute({ key: secretKey })
    // execute() resolves undefined only when the client throws.
    if (result === undefined) return
    setDeleting(false)
    navigateTo("/secrets")
  }

  return (
    <QueryBoundary title="Secret" query={detail} skeletonRows={4}>
      {(data) => (
        <section className="flex min-w-0 flex-col gap-4">
          <PageHeader
            title={data.secret.key}
            actions={
              <div className="flex gap-2">
                <Button onClick={openReplace}>Replace value</Button>
                <IconButton
                  variant="destructive"
                  onClick={openDelete}
                  label="Delete"
                />
              </div>
            }
          />
          <DetailLayout
            main={
              <>
                <SecretFields secret={data.secret} />
                <VersionTimeline query={versions} />
              </>
            }
            aside={
              <>
                <RotationPane secretKey={secretKey} policy={data.rotation} />
                <RecentActivity entries={data.recentAudit ?? []} />
              </>
            }
          />
          {replacing && (
            <ReplaceDialog
              secretKey={secretKey}
              update={update}
              onClose={() => setReplacing(false)}
            />
          )}
          <ConfirmDialog
            open={deleting}
            // Escape must not close it while the delete is in flight: a
            // failure would then be shown nowhere.
            onOpenChange={(open) =>
              !open && !remove.loading && setDeleting(false)
            }
            title={`Delete ${secretKey}?`}
            description={`This deletes ${secretKey} and every version of it.${
              data.rotation !== null
                ? " Its rotation policy is deleted too."
                : ""
            } This cannot be undone.`}
            confirmLabel="Delete"
            pending={remove.loading}
            onConfirm={() => void confirmDelete()}
          >
            <CommandAlert error={remove.error} title="Could not delete" />
          </ConfirmDialog>
        </section>
      )}
    </QueryBoundary>
  )
}

function SecretFields({ secret }: { secret: SecretSummary }) {
  const tags = Object.entries(secret.metadata ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
  return (
    <DescriptionList
      items={[
        {
          term: "ID",
          value: <span className="font-mono text-xs">{secret.id}</span>,
        },
        {
          term: "Encryption",
          value: (
            <span className="flex min-w-0 flex-col items-start gap-1">
              <EncryptionBadge alg={secret.encryptionAlg} />
              {secret.encryptionAlg === "" && (
                <span className="text-muted-foreground">
                  Stored unencrypted. Replacing the value while a key is
                  configured stores it encrypted.
                </span>
              )}
            </span>
          ),
        },
        { term: "Version", value: `v${secret.version}` },
        {
          term: "Expires",
          value: <Timestamp value={secret.expiresAt} label="expiry" />,
        },
        {
          term: "Created",
          value: <Timestamp value={secret.createdAt} label="creation time" />,
        },
        {
          term: "Updated",
          value: <Timestamp value={secret.updatedAt} label="update time" />,
        },
        { term: "Metadata", value: <TagList values={tags} label="metadata" /> },
      ]}
    />
  )
}

/**
 * Newest first, as the server returns them. There is no "view value" and no
 * diff: secrets are write-only, so there is nothing to compare.
 */
function VersionTimeline({
  query,
}: {
  query: ReturnType<typeof useQuery<VersionsResponse>>
}) {
  return (
    <QueryBoundary title="Versions" query={query} skeletonRows={3}>
      {(data) => {
        const list = data.versions ?? []
        return (
          <section className="flex min-w-0 flex-col gap-2">
            <h2 className="text-sm font-medium">Versions ({list.length})</h2>
            {list.length === 0 ? (
              <EmptyState title="No versions recorded." />
            ) : (
              <ol className="flex min-w-0 flex-col gap-2">
                {list.map((v, i) => (
                  <li
                    key={v.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2 text-sm"
                  >
                    <span className="font-mono font-medium">v{v.version}</span>
                    {i === 0 && (
                      <span className="rounded-sm bg-muted px-1.5 py-0.5 text-xs font-medium">
                        Current
                      </span>
                    )}
                    <span className="text-muted-foreground">
                      {v.createdBy ? (
                        <span className="font-mono text-xs">{v.createdBy}</span>
                      ) : (
                        <NoneCell label="author" />
                      )}
                    </span>
                    {/* Without it, a missing author's dash sits against the
                        date and reads as a minus sign: "-9/29/2026". */}
                    <span aria-hidden="true" className="text-muted-foreground">
                      ·
                    </span>
                    <Timestamp
                      value={v.createdAt}
                      label="creation time"
                      className="text-muted-foreground"
                    />
                    <VersionEncryptionBadge encryption={v.encryption} />
                  </li>
                ))}
              </ol>
            )}
          </section>
        )
      }}
    </QueryBoundary>
  )
}

function RotationPane({
  secretKey,
  policy,
}: {
  secretKey: string
  policy: RotationPolicy | null
}) {
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <h2 className="text-sm font-medium">Rotation</h2>
      {policy === null ? (
        <>
          <p className="text-sm text-muted-foreground">No rotation policy.</p>
          <PluginLink
            to={rotationPath(secretKey)}
            className="text-sm underline underline-offset-4"
          >
            Set up rotation
          </PluginLink>
        </>
      ) : (
        <>
          <DescriptionList
            items={[
              {
                term: "Interval",
                value: `Every ${formatInterval(policy.intervalSeconds)}`,
              },
              {
                term: "Status",
                value: <PolicyStatusBadge enabled={policy.enabled} />,
              },
              {
                term: "Rotator",
                value: <RotatorBadge rotatable={policy.rotatable} />,
              },
              {
                term: "Next rotation",
                // A time is shown only for a policy that will really rotate:
                // enabled, with a rotator registered. Do not depend on the
                // server omitting it; show "none" rather than a time that
                // will not happen.
                value: (
                  <Timestamp
                    value={
                      policy.enabled && policy.rotatable
                        ? policy.nextRotationAt
                        : undefined
                    }
                    label="next rotation"
                  />
                ),
              },
            ]}
          />
          {!policy.rotatable && (
            <p className="text-sm text-muted-foreground">
              No rotator is registered for this secret, so this policy will not
              rotate it.
            </p>
          )}
          <PluginLink
            to={rotationPath(secretKey)}
            className="text-sm underline underline-offset-4"
          >
            Open the rotation page
          </PluginLink>
        </>
      )}
    </section>
  )
}

type ExpiryChoice = "keep" | "set" | "remove"

/**
 * Only mounted while open, so every open starts with an empty value input, the
 * default expiry choice and no stale error (the caller resets the command).
 *
 * The value input is uncontrolled on purpose: react-dom copies a controlled
 * input's value into its HTML `value` attribute, password or not, and that
 * puts the secret in serialised markup. Only whether the field is empty is
 * tracked; the value is read from the input at submit and never held in state.
 */
function ReplaceDialog({
  secretKey,
  update,
  onClose,
}: {
  secretKey: string
  update: ReturnType<typeof useCommand<UpdateResponse>>
  onClose: () => void
}) {
  const valueRef = useRef<HTMLInputElement>(null)
  const [hasValue, setHasValue] = useState(false)
  const [choice, setChoice] = useState<ExpiryChoice>("keep")
  const [expires, setExpires] = useState("")

  const newExpiry = choice === "set" ? toRFC3339(expires) : undefined
  const expiryMissing = choice === "set" && newExpiry === undefined
  const expiryInPast = newExpiry !== undefined && isPast(newExpiry)
  const canSubmit =
    !update.loading && hasValue && !expiryMissing && !expiryInPast

  async function submit(event: FormEvent) {
    event.preventDefault()
    // Enter in a field submits even when the button is disabled, and the
    // clock moves between renders, so check again here.
    if (!canSubmit) return
    if (newExpiry !== undefined && isPast(newExpiry)) return
    const input = valueRef.current
    if (!input || input.value === "") return

    // No metadata: absent means keep. No expiresAt on "keep" for the same
    // reason, "" on "remove" to clear it, a timestamp on "set".
    const payload: { key: string; value: string; expiresAt?: string } = {
      key: secretKey,
      value: input.value,
    }
    if (choice === "remove") payload.expiresAt = ""
    else if (newExpiry !== undefined) payload.expiresAt = newExpiry

    const result = await update.execute(payload)
    // undefined means the client threw. The value stays in the field for a retry.
    if (result === undefined) return

    input.value = ""
    setHasValue(false)
    onClose()
  }

  return (
    // Escape and the X go through here too, so guard them, not just Cancel:
    // closing mid-update would unmount the dialog and hide a failure.
    <Dialog open onOpenChange={(open) => !open && !update.loading && onClose()}>
      <DialogContent>
        <form
          onSubmit={(e) => void submit(e)}
          className="flex min-w-0 flex-col gap-4"
        >
          <DialogHeader>
            <DialogTitle>Replace the value of {secretKey}</DialogTitle>
            <DialogDescription>
              This adds a new version. The value is write-only: once you save
              it, it cannot be shown again.
            </DialogDescription>
          </DialogHeader>
          <CommandAlert
            error={update.error}
            title="Could not replace the value"
          />
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor="replace-value">Value</Label>
            {/* "new-password": browsers ignore "off" on password fields. */}
            <Input
              id="replace-value"
              ref={valueRef}
              type="password"
              autoComplete="new-password"
              spellCheck={false}
              onChange={(e) => setHasValue(e.target.value !== "")}
            />
          </div>
          <fieldset className="flex min-w-0 flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">Expiry</legend>
            <RadioGroup
              value={choice}
              onValueChange={(v) => setChoice(v as ExpiryChoice)}
              aria-label="Expiry"
            >
              <Label>
                <RadioGroupItem value="keep" />
                Keep the current expiry
              </Label>
              <Label>
                <RadioGroupItem value="set" />
                Set a new expiry
              </Label>
              <Label>
                <RadioGroupItem value="remove" />
                Remove the expiry
              </Label>
            </RadioGroup>
            {choice === "set" && (
              <div className="flex min-w-0 flex-col gap-1.5">
                <Label htmlFor="replace-expires">New expiry</Label>
                <Input
                  id="replace-expires"
                  type="datetime-local"
                  value={expires}
                  onChange={(e) => setExpires(e.target.value)}
                  aria-invalid={expiryInPast || undefined}
                />
                {expiryInPast && (
                  <p role="alert" className="text-sm text-destructive">
                    The expiry is in the past. Pick a time that has not happened
                    yet.
                  </p>
                )}
              </div>
            )}
          </fieldset>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={update.loading}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {update.loading ? "Replacing…" : "Replace value"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
