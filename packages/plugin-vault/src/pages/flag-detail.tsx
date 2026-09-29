import { useState } from "react"
import type { ComponentType, FormEvent, ReactNode } from "react"
import {
  PluginLink,
  useCommand,
  useNavigateTo,
  useQuery,
} from "@forge-go/dashboard-plugin"
import type { CommandState, PluginPageProps } from "@forge-go/dashboard-plugin"
import { Button, buttonVariants } from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { DescriptionList } from "@forge-go/dashboard-kit/components/detail-layout"
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
import { Switch } from "@forge-go/dashboard-kit/components/switch"
import { TagList } from "@forge-go/dashboard-kit/components/tag-list"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { FlagEnabledBadge, FlagTypeBadge, WrongTypeBadge } from "../badges"
import { FlagValue } from "../components/flag-value"
import { Ladder, LadderRow, LadderRows, Rung } from "../components/ladder"
import { RuleSummary } from "../components/rule-summary"
import { ValueInput } from "../components/value-input"
import type { FlagRuleSummary, FlagType } from "../flag-types"
import { parseTags } from "../tags"
import type { FlagSummary } from "./flags"
import type { AuditEntry } from "./secret-detail"

/** Mirrors the Go `FlagOverrideSummary`. */
export interface FlagOverrideSummary {
  tenantId: string
  value: unknown
  /** False when `value` is not a value of the flag's type. */
  valueMatchesType: boolean
  updatedAt: string
}

/** Mirrors the Go `FlagVariantSummary`. */
export interface FlagVariantSummary {
  value: unknown
  description: string
}

/**
 * Mirrors the Go `flagsDetailResponse`. `rules` is in the order the engine
 * walks them, `overrides` in tenant order. Lists are never null.
 */
export interface FlagDetail {
  flag: FlagSummary
  variants: FlagVariantSummary[]
  metadata: Record<string, string>
  rules: FlagRuleSummary[]
  overrides: FlagOverrideSummary[]
  recentAudit: AuditEntry[]
  /** How long the engine caches an evaluation, in seconds. */
  cacheTtlSeconds: number
}

/** Mirrors the Go `flagResponse`. */
interface FlagResponse {
  flag: FlagSummary
}

/** Mirrors the Go `flagsSetTenantOverrideResponse`. */
interface OverrideResponse {
  override: FlagOverrideSummary
}

/** Mirrors the Go `flagsDeleteTenantOverrideResponse`. */
interface DeleteOverrideResponse {
  ok: boolean
  key: string
  tenantId: string
}

/** Mirrors the Go `flagsDeleteResponse`. */
interface DeleteResponse {
  ok: boolean
  key: string
}

type Dialogs = "default" | "description" | "tags" | "override"

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`
}

/**
 * The detail page for one flag, drawn as the ladder the engine walks.
 *
 * `params.key` arrives already decoded by the router. It is split from the
 * body for the reason secret-detail's is: a hook cannot be skipped, and a
 * query with no key would ask about a flag called "".
 */
export const FlagDetailPage: ComponentType<PluginPageProps> = ({ params }) => {
  const key = params.key
  if (!key) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        No flag key in the address, so there is nothing to show.
      </p>
    )
  }
  return <FlagDetailBody flagKey={key} />
}

function FlagDetailBody({ flagKey }: { flagKey: string }) {
  const detail = useQuery<FlagDetail>("flags.detail", { key: flagKey })

  // Once there is data the page stays up through a refresh. A write
  // invalidates flags.detail, and QueryBoundary would swap the whole page for
  // a skeleton while that refetch runs, taking every dialog and its state
  // with it.
  if (detail.data !== undefined) {
    return <FlagDetailView flagKey={flagKey} data={detail.data} />
  }

  // Matched on the message as well as the code: a wrong intent name is also
  // NOT_FOUND, and telling an operator "no flag named x" about a typo in the
  // page would send them looking for a flag that is there.
  if (
    detail.error?.code === "NOT_FOUND" &&
    /flag not found/i.test(detail.error.message)
  ) {
    return (
      <EmptyState
        title={`No flag named ${flagKey}.`}
        description="It may have been deleted, or the key may be mistyped."
        action={
          <PluginLink to="/flags" className={buttonVariants({ variant: "outline" })}>
            Back to flags
          </PluginLink>
        }
      />
    )
  }

  return (
    <QueryBoundary title="Flag" query={detail} skeletonRows={4}>
      {(data) => <FlagDetailView flagKey={flagKey} data={data} />}
    </QueryBoundary>
  )
}

function FlagDetailView({ flagKey, data }: { flagKey: string; data: FlagDetail }) {
  const { flag, rules, overrides } = data
  const setEnabled = useCommand<FlagResponse>("flags.setEnabled")
  const update = useCommand<FlagResponse>("flags.update")
  const setOverride = useCommand<OverrideResponse>("flags.setTenantOverride")
  const removeOverride = useCommand<DeleteOverrideResponse>("flags.deleteTenantOverride")
  const remove = useCommand<DeleteResponse>("flags.delete")
  const navigateTo = useNavigateTo()

  const [dialog, setDialog] = useState<Dialogs | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  function open(which: Dialogs) {
    // Reset at open, not at close, so an error from an earlier attempt, on
    // this dialog or another that shares the hook, never greets the operator.
    // The dialog body mounts fresh on each open, which resets its inputs.
    update.reset()
    setOverride.reset()
    setDialog(which)
  }

  function openRemove(tenantId: string) {
    removeOverride.reset()
    setRemoving(tenantId)
  }

  function openDelete() {
    remove.reset()
    setDeleting(true)
  }

  async function confirmRemove() {
    if (removing === null) return
    const result = await removeOverride.execute({ key: flagKey, tenantId: removing })
    // execute() resolves undefined only when the client throws.
    if (result === undefined) return
    setRemoving(null)
  }

  async function confirmDelete() {
    const result = await remove.execute({ key: flagKey })
    if (result === undefined) return
    setDeleting(false)
    navigateTo("/flags")
  }

  const off = !flag.enabled
  const ruleWord = plural(rules.length, "rule")
  const overrideWord = plural(overrides.length, "tenant override")

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <PageHeader
          title={flag.key}
          description={flag.description === "" ? "No description" : flag.description}
          className="[&_h1]:font-mono [&_h1]:text-base"
          actions={
            <>
              <FlagTypeBadge type={flag.type} />
              <Button variant="destructive" onClick={openDelete}>
                Delete
              </Button>
            </>
          }
        />
        <TagList values={flag.tags} label="tags" />
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Definition</h2>
        <DescriptionList
          items={[
            {
              term: "Default",
              value: (
                <span className="flex flex-wrap items-center gap-2">
                  <FlagValue value={flag.defaultValue} type={flag.type} />
                  {flag.defaultMatchesType ? null : <WrongTypeBadge />}
                  <EditButton label="Edit default" onClick={() => open("default")} />
                </span>
              ),
            },
            {
              term: "Description",
              value: (
                <span className="flex flex-wrap items-center gap-2">
                  {flag.description === "" ? (
                    <NoneCell label="description" />
                  ) : (
                    <span>{flag.description}</span>
                  )}
                  <EditButton label="Edit description" onClick={() => open("description")} />
                </span>
              ),
            },
            {
              term: "Tags",
              value: (
                <span className="flex flex-wrap items-center gap-2">
                  <TagList values={flag.tags} label="tags" />
                  <EditButton label="Edit tags" onClick={() => open("tags")} />
                </span>
              ),
            },
            {
              term: "Variants",
              value: <Variants variants={data.variants} type={flag.type} />,
            },
            { term: "Metadata", value: <Metadata metadata={data.metadata} /> },
          ]}
        />
      </section>

      <Ladder>
        <Rung
          id="enabled"
          number={1}
          title="Enabled"
          note="Off: everything below returns the default."
        >
          <div className="flex items-center gap-3">
            <Switch
              aria-label="Enabled"
              checked={flag.enabled}
              disabled={setEnabled.loading}
              onCheckedChange={(checked) =>
                void setEnabled.execute({ key: flagKey, enabled: checked })
              }
            />
            <FlagEnabledBadge enabled={flag.enabled} />
          </div>
          <CommandAlert error={setEnabled.error} title="Could not change the flag" />
        </Rung>

        <Rung
          id="overrides"
          number={2}
          title="Tenant overrides"
          note="Beat every rule below."
          muted={off}
          notice={off ? "The flag is off, so everything below returns the default." : undefined}
          actions={
            <Button variant="outline" size="sm" onClick={() => open("override")}>
              Add override
            </Button>
          }
        >
          {overrides.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tenant overrides.</p>
          ) : (
            <LadderRows label="Tenant overrides">
              {overrides.map((o) => (
                <LadderRow
                  key={o.tenantId}
                  value={
                    <>
                      {o.valueMatchesType ? null : <WrongTypeBadge />}
                      <FlagValue value={o.value} type={flag.type} />
                    </>
                  }
                  actions={
                    <Button
                      variant="ghost"
                      size="xs"
                      aria-label={`Remove override for ${o.tenantId}`}
                      onClick={() => openRemove(o.tenantId)}
                    >
                      Remove
                    </Button>
                  }
                >
                  <span className="font-mono text-xs font-medium">{o.tenantId}</span>
                </LadderRow>
              ))}
            </LadderRows>
          )}
        </Rung>

        <Rung
          id="rules"
          number={3}
          title="Rules"
          note="First match wins."
          muted={off}
        >
          {rules.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No rules. Whatever reaches this rung falls through to the default.
            </p>
          ) : (
            <LadderRows label="Rules">
              {rules.map((r, i) => (
                <LadderRow
                  key={r.id}
                  lead={i + 1}
                  value={
                    <>
                      {r.returnMatchesType ? null : <WrongTypeBadge />}
                      <FlagValue value={r.returnValue} type={flag.type} />
                    </>
                  }
                >
                  <RuleSummary rule={r} />
                </LadderRow>
              ))}
            </LadderRows>
          )}
        </Rung>

        <Rung id="default" number={4} title="Default" note="Returned when nothing above decides.">
          <div className="flex flex-wrap items-center gap-2">
            <FlagValue value={flag.defaultValue} type={flag.type} />
            {flag.defaultMatchesType ? null : <WrongTypeBadge />}
          </div>
        </Rung>
      </Ladder>

      {data.cacheTtlSeconds > 0 ? (
        <p className="text-xs text-muted-foreground">
          Applications may serve a cached answer for up to {data.cacheTtlSeconds} seconds
          after a change.
        </p>
      ) : null}

      <RecentActivity entries={data.recentAudit} />

      {dialog === "default" && (
        <EditDefaultDialog
          flag={flag}
          update={update}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "description" && (
        <EditDescriptionDialog
          flag={flag}
          update={update}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "tags" && (
        <EditTagsDialog flag={flag} update={update} onClose={() => setDialog(null)} />
      )}
      {dialog === "override" && (
        <AddOverrideDialog
          flag={flag}
          setOverride={setOverride}
          onClose={() => setDialog(null)}
        />
      )}

      <ConfirmDialog
        open={removing !== null}
        // Escape must not close it while the command is in flight: a failure
        // would then be shown nowhere.
        onOpenChange={(next) => !next && !removeOverride.loading && setRemoving(null)}
        title={`Remove the override for ${removing ?? ""}?`}
        description={
          <span className="flex flex-col gap-2">
            <span>
              {removing ?? "That tenant"} goes back to the rules and the default.
            </span>
            <CommandAlert error={removeOverride.error} title="Could not remove the override" />
          </span>
        }
        confirmLabel="Remove"
        pending={removeOverride.loading}
        onConfirm={() => void confirmRemove()}
      />

      <ConfirmDialog
        open={deleting}
        onOpenChange={(next) => !next && !remove.loading && setDeleting(false)}
        title={`Delete ${flagKey}?`}
        description={
          <span className="flex flex-col gap-2">
            <span>
              {`This deletes ${flagKey}, its ${ruleWord} and ${overrideWord}. Applications fall back to their own default.`}
            </span>
            <CommandAlert error={remove.error} title="Could not delete" />
          </span>
        }
        confirmLabel="Delete"
        pending={remove.loading}
        onConfirm={() => void confirmDelete()}
      />
    </section>
  )
}

function EditButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button variant="ghost" size="xs" aria-label={label} onClick={onClick}>
      Edit
    </Button>
  )
}

function Variants({
  variants,
  type,
}: {
  variants: FlagVariantSummary[]
  type: FlagType
}) {
  return (
    <span className="flex flex-col gap-1">
      <span className="text-muted-foreground">Not used when evaluating</span>
      {variants.length === 0 ? (
        <NoneCell label="variants" />
      ) : (
        <ul className="flex flex-col gap-0.5">
          {variants.map((v, i) => (
            <li key={i} className="flex flex-wrap items-baseline gap-2">
              <FlagValue value={v.value} type={type} />
              {v.description === "" ? null : (
                <span className="text-muted-foreground">{v.description}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </span>
  )
}

function Metadata({ metadata }: { metadata: Record<string, string> }) {
  const tags = Object.entries(metadata)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
  return <TagList values={tags} label="metadata" />
}

function RecentActivity({ entries }: { entries: AuditEntry[] }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">Recent activity</h2>
      {entries.length === 0 ? (
        <EmptyState title="No recorded activity yet." />
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {entries.map((e) => (
            <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-mono text-xs">{e.action}</span>
                <span className="text-muted-foreground">{e.outcome}</span>
                {e.userId ? (
                  <span className="font-mono text-xs text-muted-foreground">{e.userId}</span>
                ) : null}
              </span>
              <Timestamp value={e.createdAt} label="time" className="text-muted-foreground" />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

interface FieldDialogProps {
  title: string
  description?: string
  errorTitle: string
  submitLabel: string
  command: CommandState<unknown>
  canSubmit: boolean
  /** Built at submit, from whatever the fields hold then. */
  payload: () => unknown
  onClose: () => void
  children: ReactNode
}

/**
 * The frame every flag dialog shares. Only mounted while open, so each open
 * starts from the flag's current values with no stale error (the caller
 * resets the command).
 *
 * The error renders inside the dialog: Base UI marks everything outside an
 * open dialog inert, so one on the page body is invisible to a person. And
 * the dialog cannot close while its command is in flight: Escape and the X go
 * through `onOpenChange` too, so guarding Cancel alone would let a failure
 * land in a dialog that is already gone.
 */
function FieldDialog({
  title,
  description,
  errorTitle,
  submitLabel,
  command,
  canSubmit,
  payload,
  onClose,
  children,
}: FieldDialogProps) {
  async function submit(event: FormEvent) {
    event.preventDefault()
    // Enter in a field submits even when the button is disabled.
    if (!canSubmit || command.loading) return
    const result = await command.execute(payload())
    // undefined means the client threw. Everything stays put for a retry.
    if (result === undefined) return
    onClose()
  }

  return (
    <Dialog open onOpenChange={(next) => !next && !command.loading && onClose()}>
      <DialogContent>
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>
          <CommandAlert error={command.error} title={errorTitle} />
          {children}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={command.loading} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit || command.loading}>
              {command.loading ? "Saving…" : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

interface EditProps {
  flag: FlagSummary
  update: CommandState<FlagResponse>
  onClose: () => void
}

function EditDefaultDialog({ flag, update, onClose }: EditProps) {
  // A stored default that is not a value of the type is not offered back as
  // if it were one: the field starts empty and save waits for a real value.
  const [value, setValue] = useState<unknown>(
    flag.defaultMatchesType ? flag.defaultValue : undefined,
  )
  return (
    <FieldDialog
      title={`Change the default of ${flag.key}`}
      description="What the flag returns when nothing above it decides."
      errorTitle="Could not change the default"
      submitLabel="Save default"
      command={update as CommandState<unknown>}
      canSubmit={value !== undefined}
      payload={() => ({ key: flag.key, defaultValue: value })}
      onClose={onClose}
    >
      <div className="flex flex-col gap-1.5">
        <Label id="edit-default-label" htmlFor="edit-default">
          Default
        </Label>
        <ValueInput
          id="edit-default"
          aria-labelledby="edit-default-label"
          type={flag.type}
          value={value}
          onChange={setValue}
        />
      </div>
    </FieldDialog>
  )
}

function EditDescriptionDialog({ flag, update, onClose }: EditProps) {
  const [text, setText] = useState(flag.description)
  return (
    <FieldDialog
      title={`Change the description of ${flag.key}`}
      errorTitle="Could not change the description"
      submitLabel="Save description"
      command={update as CommandState<unknown>}
      canSubmit
      payload={() => ({ key: flag.key, description: text.trim() })}
      onClose={onClose}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="edit-description">Description</Label>
        <Input
          id="edit-description"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </div>
    </FieldDialog>
  )
}

function EditTagsDialog({ flag, update, onClose }: EditProps) {
  const [text, setText] = useState(flag.tags.join(", "))
  return (
    <FieldDialog
      title={`Change the tags of ${flag.key}`}
      errorTitle="Could not change the tags"
      submitLabel="Save tags"
      command={update as CommandState<unknown>}
      canSubmit
      // An empty list is sent as one: it is how every tag is removed, and
      // leaving the field out would mean "keep them".
      payload={() => ({ key: flag.key, tags: parseTags(text) })}
      onClose={onClose}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="edit-tags">Tags</Label>
        <Input
          id="edit-tags"
          className="font-mono"
          autoComplete="off"
          spellCheck={false}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">Comma separated.</p>
      </div>
    </FieldDialog>
  )
}

function AddOverrideDialog({
  flag,
  setOverride,
  onClose,
}: {
  flag: FlagSummary
  setOverride: CommandState<OverrideResponse>
  onClose: () => void
}) {
  const [tenantId, setTenantId] = useState("")
  const [value, setValue] = useState<unknown>(undefined)
  const tenant = tenantId.trim()
  return (
    <FieldDialog
      title={`Add a tenant override for ${flag.key}`}
      description="The tenant gets this value whatever the rules say. An override that already exists for the tenant is replaced."
      errorTitle="Could not save the override"
      submitLabel="Save override"
      command={setOverride as CommandState<unknown>}
      canSubmit={tenant !== "" && value !== undefined}
      payload={() => ({ key: flag.key, tenantId: tenant, value })}
      onClose={onClose}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="override-tenant">Tenant ID</Label>
        <Input
          id="override-tenant"
          className="font-mono"
          autoComplete="off"
          spellCheck={false}
          value={tenantId}
          onChange={(e) => setTenantId(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label id="override-value-label" htmlFor="override-value">
          Value
        </Label>
        <ValueInput
          id="override-value"
          aria-labelledby="override-value-label"
          type={flag.type}
          value={value}
          onChange={setValue}
        />
      </div>
    </FieldDialog>
  )
}
