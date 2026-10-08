import { IconButton } from "@forge-go/dashboard-kit/components/icon-button"
import { useState } from "react"
import type { ComponentType, FormEvent, ReactNode } from "react"
import {
  PluginLink,
  queryStore,
  useCommand,
  useNavigateTo,
  usePluginClient,
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
import {
  DecidedHereBadge,
  FlagEnabledBadge,
  FlagTypeBadge,
  NotReachedBadge,
  WrongTypeBadge,
} from "../badges"
import { RecentActivity } from "../components/recent-activity"
import { EvaluateBar, EvaluationSummary } from "../components/evaluate-bar"
import { FlagValue } from "../components/flag-value"
import { Ladder, LadderRow, LadderRows, Rung } from "../components/ladder"
import { RuleEditor } from "../components/rule-editor"
import { RuleSummary } from "../components/rule-summary"
import { ValueInput } from "../components/value-input"
import { readEvaluation } from "../evaluation"
import { isFlagType } from "../flag-types"
import type {
  FlagDetail,
  FlagEvaluation,
  FlagOverrideSummary,
  FlagRuleSummary,
  FlagType,
  FlagVariantSummary,
} from "../flag-types"
import { parseTags } from "../tags"
import type { FlagSummary } from "./flags"

/** Mirrors the Go `flagResponse`. */
/** The pair an operator asked about. Empty ids are already dropped. */
interface EvaluationRequest {
  tenantId?: string
  userId?: string
}

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
  const client = usePluginClient()

  // The value controls are typed. A flag of any other type (an older page
  // created `yaml` flags) can be read and deleted here, not edited.
  const type = isFlagType(flag.type) ? flag.type : undefined
  const typeReasonId = "flag-type-unsupported"
  const typeReason =
    type === undefined
      ? `This flag's type, ${flag.type}, is not one the vault evaluates, so its values cannot be edited here.`
      : undefined

  const [dialog, setDialog] = useState<Dialogs | null>(null)
  // The tenant stays after the dialog closes, with `open` false, so the
  // closing frame keeps its title. Nulling it would leave the exit animation
  // reading "Remove the override for ?".
  const [removal, setRemoval] = useState<{ tenantId: string; open: boolean } | null>(null)
  const [deleting, setDeleting] = useState(false)
  // Rung 3 is a draft of the whole list while this is true. The draft itself
  // lives in RuleEditor, which mounts fresh on each open.
  const [editingRules, setEditingRules] = useState(false)

  // What is typed, and what was submitted. Editing the inputs must not touch
  // the result: it stays until Evaluate is pressed again.
  const [draftTenant, setDraftTenant] = useState("")
  const [draftUser, setDraftUser] = useState("")
  const [request, setRequest] = useState<EvaluationRequest | null>(null)
  // Waits until Evaluate has been pressed. An id that was not given is absent
  // from the request, not sent empty.
  const evaluated = useQuery<FlagEvaluation>(
    "flags.evaluate",
    {
      key: flagKey,
      ...(request?.tenantId === undefined ? {} : { tenantId: request.tenantId }),
      ...(request?.userId === undefined ? {} : { userId: request.userId }),
    },
    { enabled: request !== null },
  )

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
    setRemoval({ tenantId, open: true })
  }

  function closeRemove() {
    setRemoval((current) => (current === null ? null : { ...current, open: false }))
  }

  function evaluate() {
    // The rules on the page may be older than the ones the engine is about to
    // walk. Reading them again is what lets "Press Evaluate again" work.
    queryStore.invalidate(client.extension, ["flags.detail"])
    // An empty id is left out of the request, not sent as "".
    const tenantId = draftTenant.trim() || undefined
    const userId = draftUser.trim() || undefined
    // The same pair is the same query, so the hook would serve what it holds.
    // Each press asks the engine, so it is asked to reload.
    if (request !== null && request.tenantId === tenantId && request.userId === userId) {
      evaluated.refetch()
    }
    setRequest({ tenantId, userId })
  }

  function clearEvaluation() {
    setRequest(null)
    setDraftTenant("")
    setDraftUser("")
  }

  function closeRuleEditor(saved: boolean) {
    setEditingRules(false)
    // A saved list is a different list: the answer on screen was worked out
    // against the old one, and its marks would sit on the wrong rows.
    if (saved) setRequest(null)
  }

  function openDelete() {
    remove.reset()
    setDeleting(true)
  }

  async function confirmRemove() {
    if (removal === null || !removal.open) return
    const result = await removeOverride.execute({ key: flagKey, tenantId: removal.tenantId })
    // execute() resolves undefined only when the client throws.
    if (result === undefined) return
    closeRemove()
  }

  async function confirmDelete() {
    const result = await remove.execute({ key: flagKey })
    if (result === undefined) return
    setDeleting(false)
    navigateTo("/flags")
  }

  const off = !flag.enabled
  const answer = evaluated.data
  // Marks read the SAVED rules by position. While a draft is open the rows on
  // screen are not those rules, so no mark may be drawn on them.
  const marks =
    answer === undefined || editingRules
      ? undefined
      : readEvaluation(answer, rules, overrides, request?.tenantId)
  const ruleNumber = marks?.decidedIndex === undefined ? undefined : marks.decidedIndex + 1
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
              <IconButton variant="destructive" onClick={openDelete} label="Delete" />
            </>
          }
        />
        <TagList values={flag.tags} label="tags" />
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Definition</h2>
        {typeReason === undefined ? null : (
          <p id={typeReasonId} className="text-sm text-muted-foreground">
            {typeReason}
          </p>
        )}
        <DescriptionList
          items={[
            {
              term: "Default",
              value: (
                <span className="flex flex-wrap items-center gap-2">
                  <FlagValue value={flag.defaultValue} type={flag.type} />
                  {flag.defaultMatchesType ? null : <WrongTypeBadge />}
                  <EditButton
                    label="Edit default"
                    onClick={() => open("default")}
                    disabledBecause={typeReason === undefined ? undefined : typeReasonId}
                  />
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

      <EvaluateBar
        tenantId={draftTenant}
        userId={draftUser}
        onTenantId={setDraftTenant}
        onUserId={setDraftUser}
        onEvaluate={evaluate}
        onClear={clearEvaluation}
        busy={evaluated.loading}
        canClear={request !== null || draftTenant !== "" || draftUser !== ""}
        disabledReason={
          editingRules ? "Save or discard the rule changes to evaluate." : undefined
        }
      >
        {evaluated.error ? (
          <CommandAlert error={evaluated.error} title="Could not evaluate" />
        ) : null}
        {answer !== undefined && marks !== undefined ? (
          <EvaluationSummary
            evaluation={answer}
            type={flag.type}
            tenantId={request?.tenantId}
            userId={request?.userId}
            ruleNumber={ruleNumber}
            cacheTtlSeconds={data.cacheTtlSeconds}
            mismatch={marks.mismatch}
          />
        ) : null}
      </EvaluateBar>

      <Ladder>
        <Rung
          id="enabled"
          number={1}
          title="Enabled"
          note="When off, everything below returns the default."
          decided={marks?.enabledDecided}
          mark={marks?.enabledDecided ? <DecidedHereBadge /> : undefined}
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
          muted={off || marks?.overridesNotReached}
          mark={marks?.overridesNotReached ? <NotReachedBadge /> : undefined}
          decided={marks?.overrideTenant !== undefined}
          annotation={overridesAnnotation(marks, request?.tenantId)}
          notice={off ? "The flag is off, so everything below returns the default." : undefined}
          actions={
            <Button
              variant="outline"
              size="sm"
              disabled={type === undefined}
              aria-describedby={type === undefined ? typeReasonId : undefined}
              onClick={() => open("override")}
            >
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
                  decided={marks?.overrideTenant === o.tenantId}
                  mark={marks?.overrideTenant === o.tenantId ? <DecidedHereBadge /> : undefined}
                  value={
                    <>
                      {o.valueMatchesType ? null : <WrongTypeBadge />}
                      <FlagValue value={o.value} type={flag.type} />
                    </>
                  }
                  actions={
                    <IconButton variant="ghost" onClick={() => openRemove(o.tenantId)} label={`Remove override for ${o.tenantId}`} />
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
          muted={off || marks?.rulesNotReached}
          mark={marks?.rulesNotReached ? <NotReachedBadge /> : undefined}
          decided={marks?.decidedIndex !== undefined}
          actions={
            editingRules ? undefined : (
              <IconButton variant="outline" disabled={type === undefined} aria-describedby={type === undefined ? typeReasonId : undefined} onClick={() => setEditingRules(true)} label="Edit rules" />
            )
          }
        >
          {editingRules && type !== undefined ? (
            <RuleEditor
              flagKey={flagKey}
              flagType={type}
              rules={rules}
              onClose={closeRuleEditor}
            />
          ) : rules.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No rules. Whatever reaches this rung falls through to the default.
            </p>
          ) : (
            <LadderRows label="Rules">
              {rules.map((r, i) => {
                const verdict = marks?.rules[i]
                const notReached = verdict?.notReached === true
                // When the whole rung is not reached its own badge says so,
                // and dimming each row again would dim them twice over.
                const behind = notReached && !marks?.rulesNotReached
                return (
                  <LadderRow
                    key={r.id}
                    lead={i + 1}
                    decided={verdict?.decided}
                    muted={behind}
                    mark={
                      verdict?.decided ? (
                        <DecidedHereBadge />
                      ) : behind ? (
                        <NotReachedBadge />
                      ) : undefined
                    }
                    annotation={
                      notReached
                        ? undefined
                        : ruleAnnotation(
                            r,
                            verdict?.note,
                            verdict?.decided === true,
                            answer?.bucket,
                            request?.tenantId,
                          )
                    }
                    value={
                      <>
                        {r.returnMatchesType ? null : <WrongTypeBadge />}
                        <FlagValue value={r.returnValue} type={flag.type} />
                      </>
                    }
                  >
                    <RuleSummary rule={r} />
                  </LadderRow>
                )
              })}
            </LadderRows>
          )}
        </Rung>

        <Rung
          id="default"
          number={4}
          title="Default"
          note="Returned when nothing above decides."
          decided={marks?.defaultDecided}
          muted={marks?.defaultNotReached}
          mark={
            marks === undefined ? undefined : marks.defaultDecided ? (
              <DecidedHereBadge />
            ) : (
              <NotReachedBadge />
            )
          }
        >
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

      {dialog === "default" && type !== undefined && (
        <EditDefaultDialog
          flag={flag}
          type={type}
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
      {dialog === "override" && type !== undefined && (
        <AddOverrideDialog
          flag={flag}
          type={type}
          setOverride={setOverride}
          onClose={() => setDialog(null)}
        />
      )}

      <ConfirmDialog
        open={removal?.open === true}
        // Escape must not close it while the command is in flight: a failure
        // would then be shown nowhere.
        onOpenChange={(next) => !next && !removeOverride.loading && closeRemove()}
        title={`Remove the override for ${removal?.tenantId ?? ""}?`}
        description={`${removal?.tenantId ?? "That tenant"} goes back to the rules and the default.`}
        confirmLabel="Remove"
        pending={removeOverride.loading}
        onConfirm={() => void confirmRemove()}
      >
        <CommandAlert error={removeOverride.error} title="Could not remove the override" />
      </ConfirmDialog>

      <ConfirmDialog
        open={deleting}
        onOpenChange={(next) => !next && !remove.loading && setDeleting(false)}
        title={`Delete ${flagKey}?`}
        description={`This deletes ${flagKey}, its ${ruleWord} and ${overrideWord}. Applications fall back to their own default.`}
        confirmLabel="Delete"
        pending={remove.loading}
        onConfirm={() => void confirmDelete()}
      >
        <CommandAlert error={remove.error} title="Could not delete" />
      </ConfirmDialog>
    </section>
  )
}

/**
 * The line under a rule after an evaluation: what the engine said about it.
 *
 * A rollout the engine checked for a tenant is said as the bucket the tenant
 * landed in against the rule's percentage, since that comparison is what the
 * verdict was. Everything else is the engine's own note, and for a rule the
 * engine looked at and turned down it starts "No match: ", so the line reads
 * as a verdict and not as a bare fragment ("tenant wayne"). The rule that
 * decided it keeps its note as it is. A rule the engine never got to has
 * nothing to say.
 */
function ruleAnnotation(
  rule: FlagRuleSummary,
  note: string | undefined,
  decided: boolean,
  bucket: number | undefined,
  tenantId: string | undefined,
): ReactNode {
  if (
    rule.type === "rollout" &&
    bucket !== undefined &&
    tenantId !== undefined &&
    // The engine gives a reached rollout a note. Without one this row has no
    // step behind it, and a verdict would be invented.
    note !== undefined &&
    note !== ""
  ) {
    const under = bucket < rule.percentage
    return `Tenant ${tenantId} lands in bucket ${bucket}, ${under ? "under" : "not under"} ${rule.percentage}.`
  }
  if (note === undefined || note === "") return undefined
  return decided ? note : `No match: ${note}`
}

/**
 * Rung 2 after an evaluation that walked past it: the engine looks for an
 * override only when a tenant is given, and only when the flag is on.
 */
function overridesAnnotation(
  marks: ReturnType<typeof readEvaluation> | undefined,
  tenantId: string | undefined,
): ReactNode {
  if (marks === undefined) return undefined
  if (marks.reason !== "rule" && marks.reason !== "default") return undefined
  return tenantId === undefined
    ? "No tenant was given, so no override was looked for."
    : `Tenant ${tenantId} has no override.`
}

function EditButton({
  label,
  onClick,
  disabledBecause,
}: {
  label: string
  onClick: () => void
  /** The id of the text saying why this cannot be pressed. Present means disabled. */
  disabledBecause?: string
}) {
  return (
    <IconButton variant="ghost" disabled={disabledBecause !== undefined} aria-describedby={disabledBecause} onClick={onClick} label={label} />
  )
}

function Variants({
  variants,
  type,
}: {
  variants: FlagVariantSummary[]
  type: string
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

function EditDefaultDialog({
  flag,
  type,
  update,
  onClose,
}: EditProps & {
  /** The flag's type, known to be one the vault evaluates. */
  type: FlagType
}) {
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
          type={type}
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
  type,
  setOverride,
  onClose,
}: {
  flag: FlagSummary
  type: FlagType
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
          type={type}
          value={value}
          onChange={setValue}
        />
      </div>
    </FieldDialog>
  )
}
