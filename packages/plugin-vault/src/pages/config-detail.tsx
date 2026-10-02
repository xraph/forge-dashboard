import { Suspense, lazy, useState } from "react"
import type { ComponentType, FormEvent } from "react"
import {
  PluginLink,
  useCommand,
  useNavigateTo,
  useQuery,
} from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
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
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { TagList } from "@forge-go/dashboard-kit/components/tag-list"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import {
  ConfigTypeBadge,
  UnsupportedTypeBadge,
  WrongTypeBadge,
} from "../badges"
import { ConfigValue } from "../components/config-value"
import { OverridesSection } from "../components/overrides-section"
import { RecentActivity } from "../components/recent-activity"
import { ResolvePanel } from "../components/resolve-panel"
import { ValueInput } from "../components/value-input"
import { isConfigType } from "../config-types"
import type {
  ConfigDetail,
  ConfigEntrySummary,
  ConfigType,
  ConfigVersion,
  ConfigVersions,
} from "../config-types"
import { prettyJson, sameJson } from "../json-text"
import { useUnsavedGuard } from "../use-unsaved-guard"
import type { JsonEdit } from "../components/json-editor"

// Both editors are their own chunks. Nothing on this page imports CodeMirror
// statically, and the route itself is lazy, so the shell's entry chunk holds
// none of it. The fallbacks say what is coming and show the text as it is.
const JsonEditor = lazy(() => import("../components/json-editor"))
const JsonDiff = lazy(() => import("../components/json-diff"))

/** Mirrors the Go `configEntryResponse`. */
interface EntryResponse {
  entry: ConfigEntrySummary
}

/** Mirrors the Go `configDeleteResponse`. */
interface DeleteResponse {
  ok: boolean
  key: string
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`
}

/**
 * The page for one config entry: its definition, its value as an editor typed
 * to match, and every version it has had.
 *
 * `params.key` arrives already decoded by the router. It is split from the
 * body because a hook cannot be skipped, and a query with no key would ask
 * about an entry called "".
 */
const ConfigDetailPage: ComponentType<PluginPageProps> = ({ params }) => {
  const key = params.key
  if (!key) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        No config key in the address, so there is nothing to show.
      </p>
    )
  }
  return <ConfigDetailBody entryKey={key} />
}

export default ConfigDetailPage

function ConfigDetailBody({ entryKey }: { entryKey: string }) {
  const detail = useQuery<ConfigDetail>("config.detail", { key: entryKey })
  const versions = useQuery<ConfigVersions>("config.versions", { key: entryKey })

  // Once there is data the page stays up through a refresh. A write
  // invalidates both reads, and QueryBoundary would swap the whole page for a
  // skeleton while they reload, taking every dialog and its state with it.
  if (detail.data !== undefined) {
    return <ConfigDetailView entryKey={entryKey} data={detail.data} versions={versions} />
  }

  // Matched on the message as well as the code: a wrong intent name is also
  // NOT_FOUND, and telling an operator "no entry named x" about a typo in the
  // page would send them looking for an entry that is there.
  if (
    detail.error?.code === "NOT_FOUND" &&
    /config entry not found/i.test(detail.error.message)
  ) {
    return (
      <EmptyState
        title={`No config entry named ${entryKey}.`}
        description="It may have been deleted, or the key may be mistyped."
        action={
          <PluginLink to="/config" className={buttonVariants({ variant: "outline" })}>
            Back to config
          </PluginLink>
        }
      />
    )
  }

  return (
    <QueryBoundary title="Config entry" query={detail} skeletonRows={4}>
      {(data) => <ConfigDetailView entryKey={entryKey} data={data} versions={versions} />}
    </QueryBoundary>
  )
}

interface VersionsQuery {
  data?: ConfigVersions
  error?: { code: string; message: string }
  loading: boolean
  refetch: () => void
}

function ConfigDetailView({
  entryKey,
  data,
  versions,
}: {
  entryKey: string
  data: ConfigDetail
  versions: VersionsQuery
}) {
  const { entry, overrides } = data
  const rollback = useCommand<EntryResponse>("config.rollback")
  const remove = useCommand<DeleteResponse>("config.delete")
  const navigateTo = useNavigateTo()

  const type = isConfigType(entry.valueType) ? entry.valueType : undefined

  const [editingDescription, setEditingDescription] = useState(false)
  // The version stays after the dialog closes, with `open` false, so the
  // closing frame keeps its title.
  const [rolling, setRolling] = useState<{ version: number; open: boolean } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [compared, setCompared] = useState<number | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  function openRollback(version: number) {
    // Reset at open, not at close: this hook is pointed at whichever row was
    // clicked, and an earlier row's refusal must not greet this one.
    rollback.reset()
    setRolling({ version, open: true })
  }

  function closeRollback() {
    setRolling((current) => (current === null ? null : { ...current, open: false }))
  }

  async function confirmRollback() {
    if (rolling === null || !rolling.open) return
    const result = await rollback.execute({ key: entryKey, version: rolling.version })
    // execute() resolves undefined only when the client throws.
    if (result === undefined) return
    setNotice(`Saved as version ${result.entry.version}.`)
    closeRollback()
  }

  function openDelete() {
    remove.reset()
    setDeleting(true)
  }

  async function confirmDelete() {
    const result = await remove.execute({ key: entryKey })
    if (result === undefined) return
    setDeleting(false)
    navigateTo("/config")
  }

  // The versions are counted from the list when it has loaded. Until then the
  // entry's own number is the count: versions are numbered from 1 with none
  // skipped.
  const versionCount = versions.data?.versions.length ?? entry.version
  const versionWord = plural(versionCount, "version")
  const overrideWord = plural(overrides.length, "tenant override")

  return (
    <section className="flex flex-col gap-6">
      <PageHeader
        title={entry.key}
        className="[&_h1]:font-mono [&_h1]:text-base"
        actions={
          <>
            <ConfigTypeBadge type={entry.valueType} />
            {entry.knownType ? null : <UnsupportedTypeBadge />}
            {entry.valueMatchesType ? null : <WrongTypeBadge />}
            <Button variant="destructive" onClick={openDelete}>
              Delete
            </Button>
          </>
        }
      />

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Definition</h2>
        <DescriptionList
          items={[
            {
              term: "Description",
              value: (
                <span className="flex flex-wrap items-center gap-2">
                  {entry.description === "" ? (
                    <NoneCell label="description" />
                  ) : (
                    <span>{entry.description}</span>
                  )}
                  <Button
                    variant="ghost"
                    size="xs"
                    aria-label="Edit description"
                    onClick={() => setEditingDescription(true)}
                  >
                    Edit
                  </Button>
                </span>
              ),
            },
            {
              term: "Metadata",
              value: (
                <TagList
                  values={Object.entries(entry.metadata).map(([k, v]) => `${k}: ${v}`)}
                  label="metadata"
                />
              ),
            },
            { term: "Version", value: <span className="font-mono text-xs">{entry.version}</span> },
            { term: "Created", value: <Timestamp value={entry.createdAt} label="creation time" /> },
            { term: "Updated", value: <Timestamp value={entry.updatedAt} label="update time" /> },
          ]}
        />
      </section>

      <section className="flex flex-col gap-2">
        <h2 id="config-value-heading" className="text-sm font-medium">
          Value
        </h2>
        {type === undefined ? (
          <>
            <p className="text-sm text-muted-foreground">
              {`This entry's type, ${entry.valueType}, is not one the vault validates, so its value cannot be edited here.`}
            </p>
            <ReadOnlyValue entry={entry} />
          </>
        ) : (
          // Keyed by what is stored, not by the version. A rollback changes the
          // value from outside, and an editor that owns its text would go on
          // showing the old one. But a description write also mints a version,
          // and it must not throw away a value you have typed and not saved.
          <ValueEditor
            key={`${entry.valueType}:${JSON.stringify(entry.value ?? null)}`}
            entry={entry}
            type={type}
            onEdit={() => setNotice(null)}
            onSaved={(version) => setNotice(`Saved as version ${version}.`)}
          />
        )}
        {notice === null ? null : (
          <p role="status" className="text-sm">
            {notice}
          </p>
        )}
      </section>

      <OverridesSection entry={entry} overrides={overrides} />

      {/* Keyed by entry, so a typed tenant and an answer are not carried to the next. */}
      <ResolvePanel key={entryKey} entryKey={entryKey} valueType={entry.valueType} />

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Versions</h2>
        {versions.data !== undefined ? (
          <VersionsTable
            entry={entry}
            versions={versions.data.versions}
            compared={compared}
            onCompare={(n) => setCompared((now) => (now === n ? null : n))}
            onRollback={openRollback}
          />
        ) : (
          <QueryBoundary title="Versions" query={versions} skeletonRows={3}>
            {(v) => (
              <VersionsTable
                entry={entry}
                versions={v.versions}
                compared={compared}
                onCompare={(n) => setCompared((now) => (now === n ? null : n))}
                onRollback={openRollback}
              />
            )}
          </QueryBoundary>
        )}
      </section>

      <RecentActivity entries={data.recentAudit} />

      {editingDescription && (
        <EditDescriptionDialog entry={entry} onClose={() => setEditingDescription(false)} />
      )}

      <ConfirmDialog
        open={rolling?.open === true}
        // Escape must not close it while the command is in flight: a refusal
        // would then be shown nowhere.
        onOpenChange={(next) => !next && !rollback.loading && closeRollback()}
        title={`Roll back ${entryKey} to version ${rolling?.version ?? ""}?`}
        description="This saves its value as a new version. The type and description stay as they are."
        confirmLabel="Roll back"
        destructive={false}
        pending={rollback.loading}
        onConfirm={() => void confirmRollback()}
      >
        <CommandAlert error={rollback.error} title="Could not roll back" />
      </ConfirmDialog>

      <ConfirmDialog
        open={deleting}
        onOpenChange={(next) => !next && !remove.loading && setDeleting(false)}
        title={`Delete ${entryKey}?`}
        description={`This deletes ${entryKey}, its ${versionWord} and ${overrideWord}. Applications fall back to their own default.`}
        confirmLabel="Delete"
        pending={remove.loading}
        onConfirm={() => void confirmDelete()}
      >
        <CommandAlert error={remove.error} title="Could not delete" />
      </ConfirmDialog>
    </section>
  )
}

/** The value of an entry whose type the vault does not validate: shown, never edited. */
function ReadOnlyValue({ entry }: { entry: ConfigEntrySummary }) {
  if (entry.value !== null && typeof entry.value === "object") {
    return (
      <pre className="max-h-96 overflow-auto rounded-md border p-3 font-mono text-xs">
        {prettyJson(entry.value)}
      </pre>
    )
  }
  return (
    <span>
      <ConfigValue value={entry.value} valueType={entry.valueType} />
    </span>
  )
}

/**
 * The editor for a value of a type the vault knows: CodeMirror for json, the
 * typed input for the rest. It owns the draft, so it is mounted fresh (keyed)
 * whenever the stored value or type changes.
 *
 * Save waits for a draft that is a value of the type, and that is not the value
 * already stored. A save that changes nothing would mint a version for
 * nothing, so it is never sent.
 */
function ValueEditor({
  entry,
  type,
  onEdit,
  onSaved,
}: {
  entry: ConfigEntrySummary
  type: ConfigType
  onEdit: () => void
  onSaved: (version: number) => void
}) {
  const save = useCommand<EntryResponse>("config.update")
  // What the editor holds as a value, or undefined while it holds none: a
  // half-typed number, text that does not parse, or a stored value that is not
  // one of the type (which is not offered back as if it were). The json editor
  // starts untouched, and untouched is the stored value.
  const [draft, setDraft] = useState<{ value: unknown } | undefined>(
    type !== "json" && entry.valueMatchesType ? { value: entry.value } : undefined,
  )
  // What was last saved from here, so the button stays off through the moment
  // between the write landing and the refreshed entry replacing this editor.
  const [saved, setSaved] = useState<{ value: unknown } | undefined>(undefined)

  const canSave =
    draft !== undefined &&
    !sameJson(draft.value, entry.value) &&
    !(saved !== undefined && sameJson(draft.value, saved.value))

  // Whether anything was typed. A draft of undefined is "no value" for two
  // reasons: nothing was touched (a stored value that is not valid for the
  // type), or what is typed is not a value yet. Only the second is a change
  // somebody would lose.
  const [touched, setTouched] = useState(false)
  const dirty = canSave || (touched && draft === undefined)
  useUnsavedGuard(dirty, "You have a value change that is not saved. Leave this page and lose it?")

  function changed(next: { value: unknown } | undefined) {
    if (save.error !== undefined || save.data !== undefined) save.reset()
    onEdit()
    setTouched(true)
    setDraft(next)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    // Enter in a field submits whatever the button says.
    if (!canSave || save.loading || draft === undefined) return
    const result = await save.execute({ key: entry.key, value: draft.value })
    // execute() resolves undefined only when the client throws. Everything
    // stays put for a retry.
    if (result === undefined) return
    setSaved(draft)
    onSaved(result.entry.version)
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="flex max-w-2xl flex-col gap-3">
      {type === "json" ? (
        <Suspense
          fallback={
            <pre
              role="region"
              aria-label="Value (editor loading)"
              className="max-h-96 overflow-auto rounded-md border p-3 font-mono text-xs"
            >
              {prettyJson(entry.value)}
            </pre>
          }
        >
          <JsonEditor
            label="Value"
            initial={prettyJson(entry.value)}
            onChange={(edit: JsonEdit) =>
              changed(edit.result.ok ? { value: edit.result.value } : undefined)
            }
          />
        </Suspense>
      ) : (
        <ValueInput
          id="config-value"
          aria-labelledby="config-value-heading"
          type={type}
          // The draft, not the stored value: a bool toggle shows what it is
          // handed, so handing it the stored value would keep showing that
          // while Save sent what you pressed. A stored value that is not a
          // value of the type has no draft, and stays unselected.
          value={draft?.value}
          reportEmptyOnMount={false}
          onChange={(v) => changed(v === undefined ? undefined : { value: v })}
        />
      )}
      <CommandAlert error={save.error} title="Could not save the value" />
      <div>
        <Button type="submit" disabled={!canSave || save.loading}>
          {save.loading ? "Saving…" : "Save value"}
        </Button>
      </div>
    </form>
  )
}

function VersionsTable({
  entry,
  versions,
  compared,
  onCompare,
  onRollback,
}: {
  entry: ConfigEntrySummary
  versions: ConfigVersion[]
  compared: number | null
  onCompare: (version: number) => void
  onRollback: (version: number) => void
}) {
  const current = versions.find((v) => v.current)
  const chosen = versions.find((v) => v.version === compared)

  // A version that holds what the entry holds now would save a new version
  // that changes nothing. It is not offered, and says so.
  const sameAsCurrent = (v: ConfigVersion) =>
    !v.current && current !== undefined && sameJson(v.value, current.value)

  const columns: Column<ConfigVersion>[] = [
    {
      id: "version",
      header: "Version",
      cell: (v) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-xs">{`v${v.version}`}</span>
          {v.current ? <Badge variant="secondary">Current</Badge> : null}
        </span>
      ),
    },
    {
      id: "value",
      header: "Value",
      cell: (v) => (
        // Capped, so a long value cannot push Compare and Roll back out of
        // view. The whole of it is the title here, and Compare shows it.
        <span className="flex min-w-0 flex-col gap-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span
              title={JSON.stringify(v.value) ?? String(v.value)}
              className="max-w-48 min-w-0 truncate"
            >
              <ConfigValue value={v.value} valueType={entry.valueType} />
            </span>
            {v.valueMatchesType ? null : <WrongTypeBadge />}
          </span>
          {v.valueMatchesType ? null : (
            <span id={`config-version-${v.version}-reason`} className="text-xs text-muted-foreground">
              {`Not a valid ${entry.valueType} value, so it cannot be rolled back to.`}
            </span>
          )}
          {v.valueMatchesType && sameAsCurrent(v) ? (
            <span id={`config-version-${v.version}-reason`} className="text-xs text-muted-foreground">
              Same as the current value.
            </span>
          ) : null}
        </span>
      ),
    },
    {
      id: "saved",
      header: "Saved",
      cell: (v) => <Timestamp value={v.createdAt} label="save time" />,
    },
  ]

  // The server refuses a rollback on an entry whose type it does not validate,
  // whatever the version holds. One sentence says so, and every Roll back
  // button points at it.
  const unsupportedId = "config-rollback-unsupported"

  return (
    <div className="flex flex-col gap-3">
      {entry.knownType ? null : (
        <p id={unsupportedId} className="text-sm text-muted-foreground">
          {`This entry's type, ${entry.valueType}, is not one the vault validates, so it cannot be rolled back.`}
        </p>
      )}
      <ResourceTable
        columns={columns}
        rows={versions}
        rowKey={(v) => String(v.version)}
        caption="Versions of this entry, newest first"
        emptyMessage="No versions."
        rowActions={(v) =>
          v.current ? (
            <span className="text-xs text-muted-foreground">This is the live version.</span>
          ) : (
            <>
              <Button
                variant="ghost"
                size="xs"
                aria-label={`Compare version ${v.version} with the current value`}
                aria-pressed={compared === v.version}
                onClick={() => onCompare(v.version)}
              >
                Compare
              </Button>
              <Button
                variant="outline"
                size="xs"
                aria-label={`Roll back to version ${v.version}`}
                disabled={!entry.knownType || !v.valueMatchesType || sameAsCurrent(v)}
                aria-describedby={
                  !entry.knownType
                    ? unsupportedId
                    : !v.valueMatchesType || sameAsCurrent(v)
                      ? `config-version-${v.version}-reason`
                      : undefined
                }
                onClick={() => onRollback(v.version)}
              >
                Roll back
              </Button>
            </>
          )
        }
      />
      {chosen !== undefined && current !== undefined ? (
        <VersionDiff entry={entry} was={chosen} now={current} />
      ) : null}
    </div>
  )
}

/**
 * One version against the current value. Json is a diff of the two texts;
 * anything else says what it was and what it is.
 */
function VersionDiff({
  entry,
  was,
  now,
}: {
  entry: ConfigEntrySummary
  was: ConfigVersion
  now: ConfigVersion
}) {
  const label = `Version ${was.version} against the current value`
  const same = sameJson(was.value, now.value)
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">{label}</h3>
      {same ? (
        <p className="text-sm text-muted-foreground">
          Version {was.version} is the same as the current value.
        </p>
      ) : entry.valueType === "json" ? (
        <Suspense
          fallback={
            <p role="status" className="text-sm text-muted-foreground">
              Loading the comparison.
            </p>
          }
        >
          <JsonDiff was={prettyJson(was.value)} now={prettyJson(now.value)} label={label} />
        </Suspense>
      ) : (
        <p className="text-sm">
          {"Was "}
          <ConfigValue value={was.value} valueType={entry.valueType} />
          {". Now "}
          <ConfigValue value={now.value} valueType={entry.valueType} />
          {"."}
        </p>
      )}
    </div>
  )
}

function EditDescriptionDialog({
  entry,
  onClose,
}: {
  entry: ConfigEntrySummary
  onClose: () => void
}) {
  // Mounted fresh on each open, so its command starts with no error and its
  // field with the stored text.
  const update = useCommand<EntryResponse>("config.update")
  const [text, setText] = useState(entry.description)
  const canSubmit = text.trim() !== entry.description.trim()

  async function submit(event: FormEvent) {
    event.preventDefault()
    // Enter in the field submits even when the button is disabled.
    if (!canSubmit || update.loading) return
    // Only the description. An empty one is sent as one: it is how a
    // description is cleared, and leaving the field out would mean "keep it".
    const result = await update.execute({ key: entry.key, description: text.trim() })
    if (result === undefined) return
    onClose()
  }

  return (
    <Dialog open onOpenChange={(next) => !next && !update.loading && onClose()}>
      <DialogContent>
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{`Change the description of ${entry.key}`}</DialogTitle>
            <DialogDescription>The value and the type stay as they are.</DialogDescription>
          </DialogHeader>
          <CommandAlert error={update.error} title="Could not change the description" />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-config-description">Description</Label>
            <Input
              id="edit-config-description"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={update.loading} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit || update.loading}>
              {update.loading ? "Saving…" : "Save description"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
