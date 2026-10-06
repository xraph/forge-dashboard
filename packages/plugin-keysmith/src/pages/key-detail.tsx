import { Suspense, lazy, useMemo, useState } from "react"
import type { ComponentType, ReactNode } from "react"
import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import {
  Button,
  buttonVariants,
} from "@forge-go/dashboard-kit/components/button"
import {
  DescriptionList,
  DetailLayout,
} from "@forge-go/dashboard-kit/components/detail-layout"
import { EmptyState } from "@forge-go/dashboard-kit/components/empty-state"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { Skeleton } from "@forge-go/dashboard-kit/components/skeleton"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { formatTimestamp } from "@forge-go/dashboard-kit/lib/format"
import { KeyStateBadge, RotationReasonBadge } from "../badges"
import {
  formatCount,
  formatDuration,
  maskedKey,
  policyPath,
  rangeBounds,
  rotationMasked,
} from "../format"
import { EndGraceDialog } from "../components/end-grace-dialog"
import {
  KeyStateActions,
  RevokeKeyDialog,
  SuspendKeyDialog,
  stateActionsFor,
  useReactivateKey,
} from "../components/key-actions"
import type { ReactivateKey } from "../components/key-actions"
import { PreviousKeyRow } from "../components/previous-key-row"
import { RotateKeyDialog } from "../components/rotate-key-dialog"
import { ScopesEditor, useScopeEditing } from "../components/scopes-editor"
import type { ScopeEditing } from "../components/scopes-editor"
import type {
  KeyDetail,
  KeyState,
  RotationItem,
  RotationsList,
  Settings,
  UsageSeries,
} from "../types"
import { WindowCell } from "./rotations"

// Lazy: the usage chart brings Recharts, and this page is eager, in the
// shell's entry chunk. A static import of usage-chart from here would put
// Recharts there too. The chart loads in its own chunk, inside a Suspense,
// once a key with recorded usage asks for it.
const UsageChart = lazy(() =>
  import("../components/usage-chart").then((m) => ({ default: m.UsageChart })),
)

/** How many rotations the key page lists before pointing at the full list. */
const HISTORY_LIMIT = 10

/**
 * The detail page for one key: what it is, which previous keys still work,
 * and what can be done to it: rotate, end a grace window, suspend,
 * reactivate, revoke, and change its scopes.
 *
 * `params.id` is split off so a missing id renders a status line before the
 * body's hook runs: a query with no id would ask the server about a key
 * called "". The body is keyed by the id, so moving to another key starts
 * with no dialog open and no earlier key's refusal on screen.
 */
export const KeyDetailPage: ComponentType<PluginPageProps> = ({ params }) => {
  const id = params.id
  if (!id) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        No key id in the address, so there is nothing to show.
      </p>
    )
  }
  return <KeyDetailBody key={id} id={id} />
}

function KeyDetailBody({ id }: { id: string }) {
  const detail = useQuery<KeyDetail>("keys.detail", { id })
  const latest = useLatestDetail(detail.data, id)

  // The dialogs sit outside the QueryBoundary, as on the keys list. Every
  // command on this page invalidates keys.detail, the boundary shows its
  // skeleton while that refetches, and anything inside it unmounts: for Rotate
  // that is the only copy of the new key, for the others their pending state
  // and their error. Their open state lives here for the same reason, and so
  // do the hooks for the two actions that have no dialog, Reactivate and the
  // scope changes.
  const [rotating, setRotating] = useState(false)
  const [ending, setEnding] = useState(false)
  const [suspending, setSuspending] = useState(false)
  const [revoking, setRevoking] = useState(false)
  // Named when End now is pressed and kept through the close, so the
  // confirmation does not change its wording as the refetch empties the list.
  const [endingMasked, setEndingMasked] = useState<string[]>([])
  // The key as named when Suspend or Revoke was pressed, for the same reason.
  const [actionMasked, setActionMasked] = useState("")
  const reactivate = useReactivateKey(id)
  const scopeEditing = useScopeEditing(id)

  // A refused Reactivate says why on the page, and stays until something else
  // is tried: by then it describes an attempt nobody is looking at. One still
  // out is left alone (the hook's reset does nothing then), so its answer
  // still lands. Each action resets again when it succeeds, which clears a
  // refusal that landed while its dialog was open: a revoked key offers
  // nothing else that would.
  const { reset: resetReactivate } = reactivate

  function startRotating() {
    resetReactivate()
    setRotating(true)
  }

  function startEnding(data: KeyDetail) {
    resetReactivate()
    setEndingMasked(previousMasked(data))
    setEnding(true)
  }

  function startAction(data: KeyDetail, open: (open: boolean) => void) {
    resetReactivate()
    setActionMasked(maskedKey(data.key))
    open(true)
  }

  // Matched on the message as well as the code: a wrong intent name is also
  // NOT_FOUND, and telling an operator "no key with this id" about a typo in
  // the page would send them looking for a key that is there. An id that is
  // not a key id at all (a mangled address) answers BAD_REQUEST, and no key
  // has that id either. Once there is data the page stays up, so this only
  // runs for a read that failed.
  const body =
    detail.data === undefined && isNoSuchKey(detail.error) ? (
      <EmptyState
        title="No key with this id."
        description="It may have been deleted, or the address may be mistyped."
        action={
          <PluginLink
            to="/keys"
            className={buttonVariants({ variant: "outline" })}
          >
            Back to keys
          </PluginLink>
        }
      />
    ) : (
      <QueryBoundary title="Key" query={detail} skeletonRows={4}>
        {(data) => (
          <KeyDetailView
            data={data}
            onRotate={startRotating}
            onEnd={() => startEnding(data)}
            onSuspend={() => startAction(data, setSuspending)}
            onRevoke={() => startAction(data, setRevoking)}
            reactivate={reactivate}
            scopeEditing={scopeEditing}
          />
        )}
      </QueryBoundary>
    )

  return (
    <>
      {body}
      {latest && (
        <>
          <RotateKeyDialog
            open={rotating}
            onOpenChange={setRotating}
            summary={latest.key}
            policy={latest.policy}
            onRotated={resetReactivate}
          />
          <EndGraceDialog
            open={ending}
            onOpenChange={setEnding}
            keyId={latest.key.id}
            masked={endingMasked}
            onEnded={resetReactivate}
          />
          <SuspendKeyDialog
            open={suspending}
            onOpenChange={setSuspending}
            keyId={latest.key.id}
            masked={actionMasked}
            onDone={resetReactivate}
          />
          <RevokeKeyDialog
            open={revoking}
            onOpenChange={setRevoking}
            keyId={latest.key.id}
            masked={actionMasked}
            onDone={resetReactivate}
          />
        </>
      )}
    </>
  )
}

/**
 * The last detail that arrived for this id. A refetch keeps the previous data
 * beside `loading`, but a refetch that fails drops it, and an open dialog
 * must not unmount because a read after the command went wrong.
 */
function useLatestDetail(
  data: KeyDetail | undefined,
  id: string
): KeyDetail | undefined {
  const [latest, setLatest] = useState(data)
  if (data !== undefined && data !== latest) setLatest(data)
  const current = data ?? latest
  return current?.key.id === id ? current : undefined
}

function isPast(at: string | undefined): boolean {
  return at !== undefined && Date.parse(at) <= Date.now()
}

function previousMasked(data: KeyDetail): string[] {
  const { key } = data
  return (data.previousKeys ?? []).map((p) =>
    maskedKey({ prefix: key.prefix, environment: key.environment, hint: p.hint })
  )
}

function isNoSuchKey(error: { code: string; message: string } | undefined | null): boolean {
  if (!error) return false
  if (error.code === "NOT_FOUND") return /key not found/i.test(error.message)
  if (error.code === "BAD_REQUEST") {
    return /^id (is not a key id|is required)$/i.test(error.message)
  }
  return false
}

function Section({
  title,
  action,
  children,
}: {
  title: string
  /** A link beside the heading, to the page that shows all of it. */
  action?: ReactNode
  children: ReactNode
}) {
  const heading = <h2 className="text-sm font-medium">{title}</h2>
  return (
    <section className="flex flex-col gap-2">
      {action ? (
        <div className="flex items-baseline justify-between gap-4">
          {heading}
          {action}
        </div>
      ) : (
        heading
      )}
      {children}
    </section>
  )
}

function KeyDetailView({
  data,
  onRotate,
  onEnd,
  onSuspend,
  onRevoke,
  reactivate,
  scopeEditing,
}: {
  data: KeyDetail
  onRotate: () => void
  onEnd: () => void
  onSuspend: () => void
  onRevoke: () => void
  reactivate: ReactivateKey
  scopeEditing: ScopeEditing
}) {
  const { key } = data
  const expiredUnmarked = key.effectiveState === "expired" && key.expiryPending
  // Matches the server: a revoked or expired key answers CONFLICT, and so
  // does a suspended one past its expiry, whose state still says suspended.
  const rotatable =
    (key.effectiveState === "active" || key.effectiveState === "suspended") &&
    !isPast(key.expiresAt)
  const offer = stateActionsFor(key)
  const anyAction = rotatable || offer.suspend || offer.reactivate || offer.revoke

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <PageHeader
          title={key.name}
          description={key.description}
          actions={
            anyAction ? (
              <>
                {rotatable && <Button onClick={onRotate}>Rotate key</Button>}
                <KeyStateActions
                  summary={key}
                  onSuspend={onSuspend}
                  onRevoke={onRevoke}
                  onReactivate={reactivate.reactivate}
                  reactivating={reactivate.loading}
                />
              </>
            ) : undefined
          }
        />
        {reactivate.error && (
          <p role="alert" className="text-sm text-destructive">
            {reactivate.error.message}
          </p>
        )}
        {!rotatable && (
          <p className="text-sm text-muted-foreground">
            A revoked or expired key cannot be rotated.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm">{maskedKey(key)}</span>
          <KeyStateBadge summary={key} />
        </div>
        {expiredUnmarked && (
          <p className="text-sm text-muted-foreground">
            {key.expiresAt ? `Expired on ${formatTimestamp(key.expiresAt)}.` : "Expired."}{" "}
            Keysmith marks expiry when the key is next used, so its recorded
            state is still active.
          </p>
        )}
      </div>
      <DetailLayout
        main={
          <>
            <ValiditySection data={data} onEnd={onEnd} />
            <DetailsSection data={data} />
            <Section title="Scopes">
              <ScopesEditor summary={key} editing={scopeEditing} />
            </Section>
            <RotationHistorySection keyId={key.id} />
            <MetadataSection metadata={data.metadata} />
          </>
        }
        aside={
          <>
            <PolicySection
              policyId={key.policyId}
              policy={data.policy}
              revoked={key.effectiveState === "revoked"}
            />
            <UsageSection keyId={key.id} />
            <WardenSection keyId={key.id} />
          </>
        }
      />
    </section>
  )
}

/** A heading's link to the full page, styled like the overview's View all. */
const SECTION_LINK = "text-sm underline underline-offset-4"

/**
 * The key's newest rotations, newest first, with a link to every rotation.
 * The Rotations page lists every key's, so the link names that.
 */
function RotationHistorySection({ keyId }: { keyId: string }) {
  const list = useQuery<RotationsList>("rotations.list", {
    keyId,
    limit: HISTORY_LIMIT,
  })
  return (
    <Section
      title="Rotation history"
      action={
        <PluginLink to="/rotations" aria-label="View all rotations" className={SECTION_LINK}>
          View all
        </PluginLink>
      }
    >
      <QueryBoundary title="Rotation history" query={list} skeletonRows={2}>
        {(data) => {
          const items = data.items ?? []
          if (items.length === 0) {
            return (
              <p className="text-sm text-muted-foreground">
                This key has not been rotated.
              </p>
            )
          }
          return (
            <>
              <ul className="flex flex-col divide-y">
                {items.map((r) => (
                  <RotationRow key={r.id} item={r} />
                ))}
              </ul>
              {data.hasMore && (
                <p className="text-sm text-muted-foreground">
                  {`Showing the ${HISTORY_LIMIT} newest.`}
                </p>
              )}
            </>
          )
        }}
      </QueryBoundary>
    </Section>
  )
}

/** One rotation: when, why, the old key and the key it became, and its window. */
function RotationRow({ item }: { item: RotationItem }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm first:pt-0 last:pb-0">
      <Timestamp value={item.rotatedAt} label="rotation time" />
      <RotationReasonBadge reason={item.reason} />
      <span className="flex items-center gap-1.5">
        <span className="font-mono text-xs">{rotationMasked(item, "old")}</span>
        <span aria-hidden="true" className="text-muted-foreground">
          →
        </span>
        <span className="sr-only">rotated to</span>
        <span className="font-mono text-xs">{rotationMasked(item, "new")}</span>
      </span>
      <span className="text-muted-foreground">
        <WindowCell item={item} />
      </span>
    </li>
  )
}

/**
 * This key's requests over the last 7 UTC days, as the Usage page's chart in
 * its compact form. Until the application records usage there is nothing to
 * draw, and seven empty days would read as a key nobody calls.
 */
function UsageSection({ keyId }: { keyId: string }) {
  // Pinned for the life of the section, so the window does not move under
  // the read and every render asks for the same thing.
  const [now] = useState(() => Date.now())
  const bounds = useMemo(() => rangeBounds("7d", now), [now])
  const series = useQuery<UsageSeries>("usage.series", { keyId, ...bounds })
  return (
    <Section
      title="Usage"
      action={
        <PluginLink to="/usage" className={SECTION_LINK}>
          Open usage
        </PluginLink>
      }
    >
      <QueryBoundary title="Usage" query={series} skeletonRows={2}>
        {(data) => {
          if (!data.recorded) {
            return (
              <p className="text-sm text-muted-foreground">
                Usage appears once your application calls RecordUsage.
              </p>
            )
          }
          const buckets = data.buckets ?? []
          const total = buckets.reduce((sum, b) => sum + b.requests, 0)
          return (
            <>
              <p className="text-sm text-muted-foreground">
                {`${formatCount(total)} ${total === 1 ? "request" : "requests"} in the last 7 days.`}
              </p>
              <Suspense
                fallback={
                  <div role="status" aria-label="Loading the usage chart">
                    <Skeleton className="h-24 w-full" />
                  </div>
                }
              >
                <UsageChart buckets={buckets} period={data.period} compact />
              </Suspense>
            </>
          )
        }}
      </QueryBoundary>
    </Section>
  )
}

/**
 * The Warden subject this key's permissions are granted to. Named as a link
 * into Warden only when settings says the warden-hook plugin is installed: a
 * link into a plugin you have not installed goes nowhere. While settings is
 * loading, or when it cannot be read, the subject stays text, and the read's
 * error is not shown here: the subject is right either way.
 */
function WardenSection({ keyId }: { keyId: string }) {
  const settings = useQuery<Settings>("settings")
  const subject = `api_key:${keyId}`
  const hooked = settings.data?.plugins?.includes("warden-hook") === true
  return (
    <Section title="Warden">
      {hooked ? (
        <>
          <p className="text-sm text-muted-foreground">
            The Warden hook grants this key&apos;s permissions to this subject:
          </p>
          {/* Absolute: the subject lives in Warden's scope, not keysmith's. */}
          <PluginLink
            to={`/@warden/subjects/api_key/${encodeURIComponent(keyId)}`}
            className="font-mono text-xs underline underline-offset-4"
          >
            {subject}
          </PluginLink>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            If the Warden hook is installed, it grants this key&apos;s
            permissions to this subject:
          </p>
          {/* On its own, with nothing after it: it gets copied with the id. */}
          <span className="font-mono text-xs">{subject}</span>
        </>
      )}
    </Section>
  )
}

function ValiditySection({
  data,
  onEnd,
}: {
  data: KeyDetail
  onEnd: () => void
}) {
  const { key } = data
  const previous = data.previousKeys ?? []
  const masked = previousMasked(data)
  const sentence = validitySentence(key.effectiveState, previous.length)
  return (
    <Section title="Validity">
      {previous.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No previous key is still accepted.
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {previous.map((p, i) => (
              <PreviousKeyRow
                // rotationId is "" on a window the server could not read back.
                key={p.rotationId || `window-${i}`}
                masked={masked[i]}
                graceEnds={p.graceEnds}
                state={key.effectiveState}
                onEnd={onEnd}
              />
            ))}
          </ul>
          {sentence && (
            <p className="text-sm text-muted-foreground">{sentence}</p>
          )}
        </>
      )}
    </Section>
  )
}

/**
 * What an open window means for this key. ValidateKey checks the key's own
 * state whichever hash is presented, and suspending a key does not end its
 * windows, so on a suspended key neither hash is accepted even though the
 * window is still open: it resumes if the key is reactivated in time.
 *
 * The server lists no windows for an expired or revoked key, since neither
 * can ever be accepted again. Should one arrive anyway, this says nothing
 * rather than claim a key is accepted.
 */
function validitySentence(state: KeyState, count: number): string | null {
  if (state === "suspended") {
    return "Neither the current key nor a previous key is accepted while this key is suspended. The window keeps running and ends at the time shown."
  }
  if (state !== "active") return null
  return count === 1
    ? "Both the current key and this previous key are accepted until then."
    : "The current key and each previous key are accepted until the time shown next to it."
}

function DetailsSection({ data }: { data: KeyDetail }) {
  const { key } = data
  return (
    <Section title="Details">
      <DescriptionList
        items={[
          { term: "ID", value: <span className="font-mono text-xs">{key.id}</span> },
          { term: "Prefix", value: <span className="font-mono text-xs">{key.prefix}</span> },
          { term: "Environment", value: key.environment },
          {
            term: "Created by",
            value: key.createdBy ? (
              <span className="font-mono text-xs">{key.createdBy}</span>
            ) : (
              <NoneCell label="creator" />
            ),
          },
          { term: "Created", value: <Timestamp value={key.createdAt} label="creation time" /> },
          { term: "Updated", value: <Timestamp value={key.updatedAt} label="update time" /> },
          { term: "Last used", value: <Timestamp value={key.lastUsedAt} label="recorded use" /> },
          { term: "Expires", value: <Timestamp value={key.expiresAt} label="expiry" /> },
          { term: "Rotated", value: <Timestamp value={key.rotatedAt} label="rotation" /> },
          { term: "Revoked", value: <Timestamp value={key.revokedAt} label="revocation" /> },
        ]}
      />
    </Section>
  )
}

/**
 * A key can point at a policy the server does not return: one that was
 * deleted, or one from another tenant, which is never shown. The engine then
 * validates the key without a policy, so the page says that. A revoked key
 * never validates, so for one of those the page only says the policy is gone.
 */
function PolicySection({
  policyId,
  policy,
  revoked,
}: {
  policyId: string | undefined
  policy: KeyDetail["policy"]
  revoked: boolean
}) {
  return (
    <Section title="Policy">
      {policy === null && policyId ? (
        <div className="flex flex-col gap-1">
          <p className="text-sm text-muted-foreground">
            {revoked
              ? "The policy this key used no longer exists."
              : "The policy this key points at could not be found, so the key validates without one."}
          </p>
          <span className="font-mono text-xs">{policyId}</span>
        </div>
      ) : policy === null ? (
        <NoneCell label="policy" />
      ) : (
        <DescriptionList
          items={[
            {
              term: "Name",
              value: <PluginLink to={policyPath(policy.id)}>{policy.name}</PluginLink>,
            },
            {
              term: "Max lifetime",
              value:
                policy.maxKeyLifetimeSeconds === null
                  ? "No maximum"
                  : formatDuration(policy.maxKeyLifetimeSeconds),
            },
            {
              term: "Grace period",
              // The engine rotates with a 24 hour grace when the policy sets none.
              value:
                policy.graceSeconds === null
                  ? "Not set (24 hours by default)"
                  : formatDuration(policy.graceSeconds),
            },
          ]}
        />
      )}
    </Section>
  )
}

function MetadataSection({ metadata }: { metadata: KeyDetail["metadata"] }) {
  const entries = Object.entries(metadata ?? {}).sort(([a], [b]) =>
    a.localeCompare(b),
  )
  return (
    <Section title="Metadata">
      {entries.length === 0 ? (
        <NoneCell label="metadata" />
      ) : (
        // DescriptionList's term is a plain string, and metadata keys are
        // identifiers, so this is the same <dl> with keys and values in mono.
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {entries.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="font-mono text-xs text-muted-foreground">{k}</dt>
              <dd className="font-mono text-xs">
                {/* JSON.stringify gives undefined for a value JSON cannot hold. */}
                {typeof v === "string" ? v : (JSON.stringify(v) ?? String(v))}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </Section>
  )
}
