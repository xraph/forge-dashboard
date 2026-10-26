import { useState } from "react"
import { PluginLink, useCommand, useQuery } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import {
  CommandAlert,
  QueryBoundary,
} from "@forge-go/dashboard-kit/components/query-boundary"
import { Section } from "@forge-go/dashboard-kit/components/section"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { ZeroState } from "@forge-go/dashboard-kit/components/zero-state"
import { useAccess } from "../components"

interface LessonRef {
  id: string
  revision: number
  digest: string
}
interface Publication {
  lesson_id: string
  revision: number
  domain: string
  operation: string
  generation: number
  attempts: number
  acknowledged: boolean
  error_code?: string
  lease_until: string
}
interface Publications {
  available: boolean
  reason?: string
  items: Publication[]
  after?: string
}
interface Lesson {
  ref: LessonRef
  domain: string
  evidence_class: string
  created_at: string
  expires_at: string
  revoked_at: string
  source_run_id: string
  source_result_id: string
  superseded_by?: LessonRef
}

// Generate once per proposal so a lost command reply keeps the same lesson ID.
export function newLessonID(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  let time = BigInt(Date.now())
  for (let i = 5; i >= 0; i--) {
    bytes[i] = Number(time & 255n)
    time >>= 8n
  }
  bytes[6] = (bytes[6]! & 15) | 112
  bytes[8] = (bytes[8]! & 63) | 128
  let value = bytes.reduce((n, byte) => (n << 8n) | BigInt(byte), 0n),
    encoded = ""
  for (let i = 0; i < 26; i++) {
    encoded = "0123456789abcdefghjkmnpqrstvwxyz"[Number(value & 31n)] + encoded
    value >>= 5n
  }
  return `lesson_${encoded}`
}

function LessonReview({
  id,
  onCorrect,
}: {
  id: string
  onCorrect: (lesson: Lesson) => void
}) {
  const query = useQuery<Lesson>("learning.detail", { id })
  const command = useCommand("learning.revoke")
  const manage = useAccess("manage")
  const [open, setOpen] = useState(false)
  return (
    <Section title="Lesson review">
      <QueryBoundary title="Lesson" query={query}>
        {(lesson) => {
          const revoked = Date.parse(lesson.revoked_at) > 0
          return (
            <div className="grid min-w-0 gap-3 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>
                  {lesson.domain} · revision {lesson.ref.revision} ·{" "}
                  {revoked ? "revoked" : "source checks required"}
                </span>
                <Timestamp value={lesson.expires_at} label="expires" />
              </div>
              <p className="text-xs text-muted-foreground">
                Evidence class: {lesson.evidence_class}. Delivery does not
                establish current recall eligibility. Open the source run for
                its current screened result.
              </p>
              <div className="flex flex-wrap gap-2">
                <PluginLink
                  to={`/runs/${lesson.source_run_id}`}
                  className="text-sm underline"
                >
                  Review source result
                </PluginLink>
                {manage && !revoked && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onCorrect(lesson)}
                    >
                      Correct from a verified result
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        command.reset()
                        setOpen(true)
                      }}
                    >
                      Revoke lesson
                    </Button>
                  </>
                )}
              </div>
              {lesson.superseded_by && (
                <p className="text-xs break-all">
                  Replaced by {lesson.superseded_by.id}
                </p>
              )}
              <CommandAlert title="Lesson command" error={command.error} />
              <ConfirmDialog
                open={open}
                onOpenChange={setOpen}
                title="Revoke this lesson?"
                description="This withdraws local recall eligibility immediately and queues destination revocation. Historical delivery may still need reconciliation."
                confirmLabel="Revoke lesson"
                pending={command.loading}
                onConfirm={async () => {
                  if (
                    (await command.execute({
                      id,
                      revision: lesson.ref.revision,
                      reason: "operator_withdrawal",
                    })) !== undefined
                  )
                    setOpen(false)
                }}
              />
            </div>
          )
        }}
      </QueryBoundary>
    </Section>
  )
}

function AcceptLesson({
  corrects,
  onAccepted,
  onCancel,
}: {
  corrects?: Lesson
  onAccepted: () => void
  onCancel: () => void
}) {
  const [id] = useState(newLessonID)
  const [runId, setRunId] = useState("")
  const [resultId, setResultId] = useState("")
  const [domain, setDomain] = useState(corrects?.domain ?? "")
  const [applies, setApplies] = useState("")
  const [expires, setExpires] = useState("")
  const command = useCommand("learning.accept")
  return (
    <Section title={corrects ? "Correct lesson" : "Accept a verified lesson"}>
      <form
        className="grid min-w-0 gap-3 p-3"
        onSubmit={async (event) => {
          event.preventDefault()
          const expiry = new Date(expires)
          if (!Number.isFinite(expiry.getTime())) return
          const accepted = await command.execute({
            id,
            run_id: runId,
            result_id: resultId,
            domain,
            applicability: applies ? [applies] : [],
            contraindications: [],
            expires_at: expiry.toISOString(),
            ...(corrects ? { corrects: corrects.ref } : {}),
          })
          if (accepted !== undefined) onAccepted()
        }}
      >
        <p className="text-xs text-muted-foreground">
          The host derives the lesson from the saved verified answer and
          rechecks its source. You define where it applies and when it expires.
        </p>
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          <label className="grid min-w-0 gap-1 text-sm">
            Source run
            <Input
              required
              value={runId}
              onChange={(e) => setRunId(e.target.value)}
              placeholder="arun_…"
            />
          </label>
          <label className="grid min-w-0 gap-1 text-sm">
            Committed result
            <Input
              required
              value={resultId}
              onChange={(e) => setResultId(e.target.value)}
              placeholder="vresult_…"
            />
          </label>
          <label className="grid min-w-0 gap-1 text-sm">
            Domain
            <Input
              required
              maxLength={256}
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
            />
          </label>
          <label className="grid min-w-0 gap-1 text-sm">
            Expires (your timezone)
            <Input
              required
              type="datetime-local"
              value={expires}
              onChange={(e) => setExpires(e.target.value)}
            />
          </label>
        </div>
        <label className="grid min-w-0 gap-1 text-sm">
          Applies when
          <Input
            maxLength={4096}
            value={applies}
            onChange={(e) => setApplies(e.target.value)}
          />
        </label>
        <CommandAlert title="Lesson command" error={command.error} />
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={command.loading}>
            {corrects ? "Accept correction" : "Accept lesson"}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Section>
  )
}

export function LearningPage() {
  const [cursors, setCursors] = useState([""])
  const query = useQuery<Publications>("learning.publications", {
    after: cursors[cursors.length - 1],
    limit: 25,
  })
  const retry = useCommand("learning.retry")
  const manage = useAccess("manage")
  const [selected, setSelected] = useState("")
  const [proposal, setProposal] = useState<{ key: number; corrects?: Lesson }>()
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <PageHeader
        title="Governed lessons"
        description="Inspect delivery and withdraw or correct lessons from verified results."
        actions={
          manage && query.data?.available && query.data.items.length > 0 ? (
            <Button size="sm" onClick={() => setProposal({ key: Date.now() })}>
              Accept lesson
            </Button>
          ) : undefined
        }
      />
      <PluginLink to="/improvements" className="text-sm underline">
        Review proposed improvements
      </PluginLink>
      <CommandAlert title="Delivery retry" error={retry.error} />
      <QueryBoundary title="Lesson delivery" query={query} keepPreviousData>
        {(data) =>
          !data.available ? (
            <ZeroState
              title="Governed learning unavailable"
              body={
                data.reason ?? "Your host has not installed the learning guard."
              }
            />
          ) : (
            <>
              {!data.items.length ? (
                proposal ? null : (
                  <ZeroState
                    title="No lesson publications"
                    body="Accepted lessons and destination revocations appear here. You can accept a lesson from a currently verified result."
                    action={
                      manage ? (
                        <Button
                          size="sm"
                          onClick={() => setProposal({ key: Date.now() })}
                        >
                          Accept lesson
                        </Button>
                      ) : undefined
                    }
                  />
                )
              ) : (
                <div className="grid min-w-0 gap-2">
                  {data.items.map((item) => (
                    <article
                      key={`${item.lesson_id}:${item.revision}`}
                      className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-md border p-3"
                    >
                      <div className="min-w-0">
                        <button
                          className="max-w-full text-left text-sm break-all underline"
                          onClick={() => setSelected(item.lesson_id)}
                        >
                          {item.domain} · {item.lesson_id}
                        </button>
                        <p className="text-xs text-muted-foreground">
                          Revision {item.revision} · {item.operation} ·{" "}
                          {item.acknowledged
                            ? "destination acknowledged"
                            : `${item.attempts} attempts, awaiting acknowledgment`}
                          {item.error_code ? ` · ${item.error_code}` : ""}
                        </p>
                      </div>
                      {manage &&
                        !item.acknowledged &&
                        item.generation > 0 &&
                        Date.parse(item.lease_until) <= Date.now() && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={retry.loading}
                            onClick={() =>
                              retry.execute({
                                id: item.lesson_id,
                                revision: item.revision,
                                generation: item.generation,
                              })
                            }
                          >
                            Retry delivery
                          </Button>
                        )}
                    </article>
                  ))}
                </div>
              )}
              {(data.items.length > 0 || cursors.length > 1) && (
                <div className="flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={cursors.length === 1 || query.loading}
                    onClick={() =>
                      setCursors((current) => current.slice(0, -1))
                    }
                  >
                    Previous
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!data.after || query.loading}
                    onClick={() =>
                      setCursors((current) => [...current, data.after!])
                    }
                  >
                    Next
                  </Button>
                </div>
              )}
            </>
          )
        }
      </QueryBoundary>
      {selected && (
        <LessonReview
          key={selected}
          id={selected}
          onCorrect={(lesson) =>
            setProposal({ key: Date.now(), corrects: lesson })
          }
        />
      )}
      {proposal && manage && (
        <AcceptLesson
          key={proposal.key}
          corrects={proposal.corrects}
          onAccepted={() => setProposal(undefined)}
          onCancel={() => setProposal(undefined)}
        />
      )}
    </section>
  )
}
