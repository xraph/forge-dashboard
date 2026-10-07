import { useEffect, useRef, useState } from "react"
import type { ComponentType, ReactNode } from "react"
import {
  PluginLink,
  useCommand,
  useNavigateTo,
  useQuery,
} from "@forge-go/dashboard-plugin"
import type { PluginPageProps, QueryState } from "@forge-go/dashboard-plugin"
import {
  Button,
  buttonVariants,
} from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import {
  DescriptionList,
  DetailLayout,
} from "@forge-go/dashboard-kit/components/detail-layout"
import type { DescriptionItem } from "@forge-go/dashboard-kit/components/detail-layout"
import { EmptyState } from "@forge-go/dashboard-kit/components/empty-state"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { TagList } from "@forge-go/dashboard-kit/components/tag-list"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { KeyStateBadge } from "../badges"
import { PolicyEditorDialog } from "../components/policy-editor-dialog"
import {
  ApplicationGroupLine,
  GROUP_HEADING,
  KEYSMITH_GROUP_LINE,
  rateLimiterLine,
} from "../enforcement"
import { formatDuration, formatRateLimit, keyPath, maskedKey } from "../format"
import { useHeldPage } from "../held-page"
import type {
  KeysList,
  KeySummary,
  PolicyDetail,
  PolicyDetailResponse,
} from "../types"

const PAGE_SIZE = 25

const keyColumns: Column<KeySummary>[] = [
  {
    id: "name",
    header: "Name",
    className: "font-medium",
    cell: (k) => <PluginLink to={keyPath(k.id)}>{k.name}</PluginLink>,
  },
  {
    id: "key",
    header: "Key",
    className: "font-mono text-xs",
    cell: (k) => maskedKey(k),
  },
  {
    id: "state",
    header: "State",
    cell: (k) => <KeyStateBadge summary={k} />,
  },
]

/**
 * The page for one policy: every field, grouped the way the editor groups
 * them, the keys that use it, and Edit and Delete.
 *
 * `params.id` is split off so a missing id renders a status line before the
 * body's hooks run, and the body is keyed by the id, so moving to another
 * policy starts with no dialog open and no earlier policy's refusal on screen.
 */
export const PolicyDetailPage: ComponentType<PluginPageProps> = ({ params }) => {
  const id = params.id
  if (!id) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        No policy id in the address, so there is nothing to show.
      </p>
    )
  }
  return <PolicyDetailBody key={id} id={id} />
}

function PolicyDetailBody({ id }: { id: string }) {
  const detail = useQuery<PolicyDetailResponse>("policies.detail", { id })
  const latest = useLatestDetail(detail.data, id)

  // One-based, matching ResourceTable's PaginationState. Held here, above the
  // boundary, so a refetch of the policy does not send the table to page 1.
  const [page, setPage] = useState(1)
  const read = useQuery<KeysList>("keys.list", {
    policyId: id,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  })
  // What the table shows: the page on screen stays while the next one loads,
  // so the pager keeps the focus of the button you pressed.
  const keys = useHeldPage(read, id, page)
  // Keys revoked or moved elsewhere can leave the page past the end. Step back
  // to the last page that exists, as the keys list does. From the page's own
  // answer, never the held one.
  const total = read.data?.total
  const rowCount = read.data?.keys?.length
  if (page > 1 && total !== undefined && total > 0 && rowCount === 0) {
    const last = Math.max(1, Math.ceil(total / PAGE_SIZE))
    if (last !== page) setPage(last)
  }

  // The dialogs sit outside the QueryBoundary, with their open state here.
  // Both commands invalidate policies.detail, the boundary shows its skeleton
  // while that refetches, and anything inside it unmounts with what was typed,
  // the pending state and the error.
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  // Named when Delete is pressed, so the question does not change its wording
  // if a refetch under the open dialog brings a new name.
  const [deletingName, setDeletingName] = useState("")

  function startDeleting(data: PolicyDetailResponse) {
    setDeletingName(data.policy.name)
    setDeleting(true)
  }

  // Matched on the message as well as the code: a wrong intent name is also
  // NOT_FOUND, and "no policy with this id" about a typo in the page would
  // send an operator looking for a policy that is there. Once there is data
  // the page stays up, so this only runs for a read that failed.
  const body =
    detail.data === undefined && isNoSuchPolicy(detail.error) ? (
      <EmptyState
        title="No policy with this id."
        description="It may have been deleted, or the address may be mistyped."
        action={
          <PluginLink
            to="/policies"
            className={buttonVariants({ variant: "outline" })}
          >
            Back to policies
          </PluginLink>
        }
      />
    ) : (
      <QueryBoundary title="Policy" query={detail} skeletonRows={4}>
        {(data) => (
          <PolicyDetailView
            data={data}
            keys={keys}
            page={page}
            onPageChange={setPage}
            onEdit={() => setEditing(true)}
            onDelete={() => startDeleting(data)}
          />
        )}
      </QueryBoundary>
    )

  return (
    <>
      {body}
      {latest && (
        <>
          <PolicyEditorDialog
            open={editing}
            onOpenChange={setEditing}
            policy={latest.policy}
            rateLimiterConfigured={latest.rateLimiterConfigured}
          />
          <DeletePolicyDialog
            open={deleting}
            onOpenChange={setDeleting}
            policyId={latest.policy.id}
            name={deletingName}
          />
        </>
      )}
    </>
  )
}

/**
 * The last detail that arrived for this id. A refetch that fails drops the
 * query's data, and an open dialog must not unmount because of it. It also
 * keeps the last rate limiter answer for the editor.
 */
function useLatestDetail(
  data: PolicyDetailResponse | undefined,
  id: string,
): PolicyDetailResponse | undefined {
  const [latest, setLatest] = useState(data)
  if (data !== undefined && data !== latest) setLatest(data)
  const current = data ?? latest
  return current?.policy.id === id ? current : undefined
}

function isNoSuchPolicy(
  error: { code: string; message: string } | undefined | null,
): boolean {
  if (!error) return false
  if (error.code === "NOT_FOUND") return /policy not found/i.test(error.message)
  if (error.code === "BAD_REQUEST") {
    return /^id (is not a policy id|is required)$/i.test(error.message)
  }
  return false
}

function Section({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">{title}</h2>
      {children}
    </section>
  )
}

function Line({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>
}

function PolicyDetailView({
  data,
  keys,
  page,
  onPageChange,
  onEdit,
  onDelete,
}: {
  data: PolicyDetailResponse
  keys: QueryState<KeysList>
  page: number
  onPageChange: (page: number) => void
  onEdit: () => void
  onDelete: () => void
}) {
  const { policy } = data
  const blocked = data.keysBlockingDelete > 0

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <PageHeader
          title={policy.name}
          description={policy.description}
          actions={
            <>
              <Button variant="outline" onClick={onEdit}>
                Edit
              </Button>
              <Button variant="destructive" disabled={blocked} onClick={onDelete}>
                Delete
              </Button>
            </>
          }
        />
        {blocked && (
          <Line>
            You can delete this policy once no active, suspended or expired key
            uses it.
          </Line>
        )}
      </div>

      <DetailLayout
        main={
          <>
            <Section title={GROUP_HEADING.keysmith}>
              <Line>{KEYSMITH_GROUP_LINE}</Line>
              <DescriptionList items={keysmithItems(policy)} />
            </Section>
            <Section title={GROUP_HEADING.rateLimiter}>
              <Line>{rateLimiterLine(data.rateLimiterConfigured)}</Line>
              <DescriptionList
                items={[
                  {
                    term: "Rate limit",
                    value: formatRateLimit(policy) ?? (
                      <NoneCell label="rate limit" />
                    ),
                  },
                ]}
              />
            </Section>
            <Section title={GROUP_HEADING.application}>
              <Line>
                <ApplicationGroupLine />
              </Line>
              <DescriptionList items={storedItems(policy)} />
            </Section>
          </>
        }
        aside={
          <Section title="Details">
            <DescriptionList
              items={[
                {
                  term: "ID",
                  value: <span className="font-mono text-xs">{policy.id}</span>,
                },
                {
                  term: "Created",
                  value: (
                    <Timestamp value={policy.createdAt} label="creation time" />
                  ),
                },
                {
                  term: "Updated",
                  value: (
                    <Timestamp value={policy.updatedAt} label="update time" />
                  ),
                },
              ]}
            />
          </Section>
        }
      />

      <Section title="Keys using this policy">
        <Line>{keysLine(data.keysUsing, data.keysBlockingDelete)}</Line>
        <QueryBoundary title="Keys" query={keys} skeletonRows={3} keepPreviousData>
          {(list) => (
            <ResourceTable<KeySummary>
              columns={keyColumns}
              rows={list.keys ?? []}
              rowKey={(k) => k.id}
              caption={`${list.total} ${list.total === 1 ? "key" : "keys"}`}
              emptyMessage="No keys to show."
              pagination={{ page, pageSize: PAGE_SIZE, total: list.total }}
              onPageChange={onPageChange}
            />
          )}
        </QueryBoundary>
      </Section>
    </section>
  )
}

/** A duration, or the given node when the policy sets none. */
function durationOr(seconds: number | null, unset: ReactNode): ReactNode {
  return seconds === null ? unset : formatDuration(seconds)
}

/** A count, or NoneCell when the policy sets none. */
function countOr(n: number | null, label: string): ReactNode {
  return n === null ? <NoneCell label={label} /> : String(n)
}

function keysmithItems(p: PolicyDetail): DescriptionItem[] {
  return [
    {
      term: "Max key lifetime",
      value: durationOr(
        p.maxKeyLifetimeSeconds,
        <NoneCell label="maximum lifetime" />,
      ),
    },
    {
      term: "Grace on rotation",
      // No grace set is not "none": rotation then uses 24 hours.
      value: durationOr(
        p.graceSeconds,
        <span className="text-muted-foreground">24 hours (default)</span>,
      ),
    },
    {
      term: "Allowed scopes",
      // An empty allow list is the widest policy there is, not an absence.
      value:
        p.allowedScopes.length === 0 ? (
          <span className="text-muted-foreground">Any scope</span>
        ) : (
          <TagList values={p.allowedScopes} label="allowed scopes" />
        ),
    },
  ]
}

function storedItems(p: PolicyDetail): DescriptionItem[] {
  return [
    { term: "Burst limit", value: countOr(p.burstLimit, "burst limit") },
    {
      term: "Rotation period",
      value: durationOr(
        p.rotationPeriodSeconds,
        <NoneCell label="rotation period" />,
      ),
    },
    { term: "Daily quota", value: countOr(p.dailyQuota, "daily quota") },
    { term: "Monthly quota", value: countOr(p.monthlyQuota, "monthly quota") },
    {
      term: "Allowed IPs",
      value: <TagList values={p.allowedIps} label="allowed IPs" />,
    },
    {
      term: "Allowed origins",
      value: <TagList values={p.allowedOrigins} label="allowed origins" />,
    },
    {
      term: "Allowed methods",
      value: <TagList values={p.allowedMethods} label="allowed methods" />,
    },
    {
      term: "Allowed paths",
      value: <TagList values={p.allowedPaths} label="allowed paths" />,
    },
  ]
}

/** How many keys use the policy, and how many of those are revoked. */
function keysLine(using: number, blocking: number): string {
  if (using === 0) return "No keys use this policy."
  const revoked = using - blocking
  const head =
    using === 1 ? "1 key uses this policy." : `${using} keys use this policy.`
  if (revoked <= 0) return head
  if (using === 1) return `${head} It is revoked.`
  return revoked === 1
    ? `${head} 1 of them is revoked.`
    : `${head} ${revoked} of them are revoked.`
}

/**
 * The confirmation for policies.delete. The server refuses while a key that is
 * not revoked uses the policy, and that refusal shows here, in the body.
 */
function DeletePolicyDialog({
  open,
  onOpenChange,
  policyId,
  name,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  policyId: string
  /** The policy's name when Delete was pressed. */
  name: string
}) {
  const remove = useCommand<{ id: string }>("policies.delete")
  const { reset } = remove
  const navigate = useNavigateTo()
  // Set synchronously, so a second click in the same tick cannot slip past a
  // button that has not re-rendered as disabled yet.
  const sending = useRef(false)

  // A failure sticks to the hook, so it is cleared as the dialog opens.
  useEffect(() => {
    if (open) reset()
  }, [open, reset])

  async function confirm() {
    if (sending.current || remove.loading) return
    sending.current = true
    let result: { id: string } | undefined
    try {
      result = await remove.execute({ id: policyId })
    } finally {
      sending.current = false
    }
    if (!result) return
    onOpenChange(false)
    navigate("/policies")
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        // Closing while the command is out would hide its answer.
        if (!next && (remove.loading || sending.current)) return
        onOpenChange(next)
      }}
      title={`Delete ${name}?`}
      description="Revoked keys that used it will show no policy. This cannot be undone."
      confirmLabel="Delete"
      pending={remove.loading}
      onConfirm={() => void confirm()}
    >
      {remove.error && (
        <p role="alert" className="text-sm text-destructive">
          {remove.error.message}
        </p>
      )}
    </ConfirmDialog>
  )
}
