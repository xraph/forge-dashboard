import { useState } from "react"
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
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { formatTimestamp } from "@forge-go/dashboard-kit/lib/format"
import { KeyStateBadge } from "../badges"
import { formatDuration, maskedKey } from "../format"
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
import type { KeyDetail, KeyState } from "../types"

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

  function startEnding(data: KeyDetail) {
    setEndingMasked(previousMasked(data))
    setEnding(true)
  }

  function startAction(data: KeyDetail, open: (open: boolean) => void) {
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
            onRotate={() => setRotating(true)}
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
          />
          <EndGraceDialog
            open={ending}
            onOpenChange={setEnding}
            keyId={latest.key.id}
            masked={endingMasked}
          />
          <SuspendKeyDialog
            open={suspending}
            onOpenChange={setSuspending}
            keyId={latest.key.id}
            masked={actionMasked}
          />
          <RevokeKeyDialog
            open={revoking}
            onOpenChange={setRevoking}
            keyId={latest.key.id}
            masked={actionMasked}
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

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">{title}</h2>
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
  // Matches the server: a revoked or expired key answers CONFLICT.
  const rotatable =
    key.effectiveState === "active" || key.effectiveState === "suspended"
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
            <MetadataSection metadata={data.metadata} />
          </>
        }
        aside={
          <>
            <PolicySection policyId={key.policyId} policy={data.policy} />
            <Section title="Warden">
              <p className="text-sm text-muted-foreground">
                If the Warden hook is installed, it grants this key&apos;s
                permissions to this subject:
              </p>
              {/* On its own, with nothing after it: it gets copied with the id. */}
              <span className="font-mono text-xs">api_key:{key.id}</span>
            </Section>
          </>
        }
      />
    </section>
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
          <p className="text-sm text-muted-foreground">
            {validitySentence(key.effectiveState, previous.length)}
          </p>
        </>
      )}
    </Section>
  )
}

/**
 * What an open window means for this key. ValidateKey checks the key's own
 * state and expiry whichever hash is presented, and suspending a key does not
 * end its windows, so on a key that is not active neither hash is accepted
 * even though the window is still open.
 */
function validitySentence(state: KeyState, count: number): string {
  if (state !== "active") {
    return `Neither the current key nor a previous key is accepted while this key is ${state}. The window keeps running and ends at the time shown.`
  }
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
 * validates the key without a policy, so the page says that.
 */
function PolicySection({
  policyId,
  policy,
}: {
  policyId: string | undefined
  policy: KeyDetail["policy"]
}) {
  return (
    <Section title="Policy">
      {policy === null && policyId ? (
        <div className="flex flex-col gap-1">
          <p className="text-sm text-muted-foreground">
            The policy this key points at could not be found, so the key
            validates without one.
          </p>
          <span className="font-mono text-xs">{policyId}</span>
        </div>
      ) : policy === null ? (
        <NoneCell label="policy" />
      ) : (
        <DescriptionList
          items={[
            { term: "Name", value: policy.name },
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
