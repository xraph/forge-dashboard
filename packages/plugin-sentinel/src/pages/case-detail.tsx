import { IconButton } from "@forge-go/dashboard-kit/components/icon-button"
import { useEffect, useRef, useState } from "react"
import type { ComponentType } from "react"
import {
  PluginLink,
  useCommand,
  useNavigateTo,
  useQuery,
} from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { DescriptionList } from "@forge-go/dashboard-kit/components/detail-layout"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { TagList } from "@forge-go/dashboard-kit/components/tag-list"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { RedTeamBadge, ScenarioBadge } from "../badges"
import { CaseFormDialog } from "../components/case-form-dialog"
import { PlainText } from "../components/plain-text"
import { SettledBoundary } from "../components/settled-boundary"
import { plural, suitePath } from "../format"
import type { ScorerConfig, Suite, TestCase } from "../types"

/**
 * Keys a scorer row by its place in the list. A case may hold the same scorer
 * twice, even with the same config, so neither name nor config is unique.
 */
function indexKey(rows: ScorerConfig[]): (row: ScorerConfig) => string {
  const place = new Map(rows.map((row, i) => [row, i]))
  return (row) => String(place.get(row))
}

const scorerColumns: Column<ScorerConfig>[] = [
  {
    id: "name",
    header: "Scorer",
    className: "font-mono text-xs font-medium",
    cell: (s) => s.name,
  },
  {
    id: "config",
    header: "Config",
    cell: (s) =>
      Object.keys(s.config).length === 0 ? (
        <NoneCell label="config" />
      ) : (
        <pre className="font-mono text-xs break-words whitespace-pre-wrap">
          {JSON.stringify(s.config, null, 2)}
        </pre>
      ),
  },
  {
    id: "hidden",
    header: "Withheld",
    cell: (s) =>
      s.redacted ? (
        `The ${s.redacted.key}, ${plural(s.redacted.length, "character", "characters")}`
      ) : (
        <NoneCell label="withheld value" />
      ),
  },
]

/**
 * /suites/:id/cases/:caseId. Guards the ids, then keys the body on the case.
 * The suite the page links to is the one the case record names, not the one in
 * the URL, so a case reached through a stale or mistyped suite id still links
 * to its own.
 */
export const CaseDetailPage: ComponentType<PluginPageProps> = ({ params }) => {
  const suiteId = params.id
  const caseId = params.caseId
  if (!suiteId || !caseId)
    return <p className="text-sm text-muted-foreground">No case selected.</p>
  return <CaseDetailBody key={caseId} caseId={caseId} />
}

function CaseDetailBody({ caseId }: { caseId: string }) {
  const testCase = useQuery<TestCase>("cases.detail", { caseId })
  // Asked for once the case has answered, because the case says which suite.
  const ownSuiteId = testCase.data?.suiteId
  const suite = useQuery<Suite>(
    "suites.detail",
    { suiteId: ownSuiteId },
    { enabled: ownSuiteId !== undefined }
  )
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [target, setTarget] = useState<TestCase | null>(null)
  return (
    <section className="flex flex-col gap-6">
      <SettledBoundary title="Case" query={testCase} skeletonRows={5}>
        {(c) => (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <PageHeader
                title={c.name}
                actions={
                  <>
                    <IconButton
                      variant="outline"
                      onClick={() => {
                        setTarget(c)
                        setEditing(true)
                      }}
                      label="Edit"
                    />
                    <IconButton
                      variant="outline"
                      onClick={() => {
                        setTarget(c)
                        setDeleting(true)
                      }}
                      label="Delete"
                    />
                  </>
                }
              />
              <div className="flex flex-wrap items-center gap-2">
                <ScenarioBadge type={c.scenarioType} />
                {c.redTeam && (
                  <RedTeamBadge attackType={c.redTeam.attackType} />
                )}
              </div>
            </div>
            <DescriptionList
              items={[
                {
                  term: "Suite",
                  value: (
                    <PluginLink to={suitePath(c.suiteId)}>
                      {suite.data?.name ?? "Back to the suite"}
                    </PluginLink>
                  ),
                },
                {
                  term: "Tags",
                  value: <TagList values={c.tags} label="tags" />,
                },
                {
                  term: "Created",
                  value: (
                    <Timestamp value={c.createdAt} label="creation time" />
                  ),
                },
                {
                  term: "Updated",
                  value: <Timestamp value={c.updatedAt} label="update" />,
                },
              ]}
            />
            <section
              aria-labelledby="sentinel-case-input"
              className="flex flex-col gap-2"
            >
              <h2 id="sentinel-case-input" className="text-sm font-medium">
                Input
              </h2>
              <PlainText value={c.input} label="Input" />
            </section>
            <section
              aria-labelledby="sentinel-case-expected"
              className="flex flex-col gap-2"
            >
              <h2 id="sentinel-case-expected" className="text-sm font-medium">
                Expected output
              </h2>
              {c.expected ? (
                <PlainText value={c.expected} label="Expected output" />
              ) : (
                <NoneCell label="expected output" />
              )}
            </section>
            <section
              aria-labelledby="sentinel-case-scorers"
              className="flex flex-col gap-2"
            >
              <h2 id="sentinel-case-scorers" className="text-sm font-medium">
                Its own scorers
              </h2>
              <ResourceTable<ScorerConfig>
                columns={scorerColumns}
                rows={c.scorers}
                rowKey={indexKey(c.scorers)}
                caption={plural(c.scorers.length, "scorer", "scorers")}
                emptyMessage="No scorers of its own. The run's scorers judge it."
              />
              {c.scorers.some((s) => s.redacted) && (
                <p className="text-xs text-muted-foreground">
                  A withheld substring is the system prompt this case checks
                  for, so the server never sends it.
                </p>
              )}
            </section>
            {Object.keys(c.context).length > 0 && (
              <section
                aria-labelledby="sentinel-case-context"
                className="flex flex-col gap-2"
              >
                <h2 id="sentinel-case-context" className="text-sm font-medium">
                  Context
                </h2>
                <PlainText
                  value={JSON.stringify(c.context, null, 2)}
                  label="Context"
                />
              </section>
            )}
            {Object.keys(c.metadata).length > 0 && (
              <section
                aria-labelledby="sentinel-case-metadata"
                className="flex flex-col gap-2"
              >
                <h2 id="sentinel-case-metadata" className="text-sm font-medium">
                  Metadata
                </h2>
                <PlainText
                  value={JSON.stringify(c.metadata, null, 2)}
                  label="Metadata"
                />
              </section>
            )}
          </div>
        )}
      </SettledBoundary>
      {target && (
        <>
          <CaseFormDialog
            open={editing}
            onOpenChange={setEditing}
            suiteId={target.suiteId}
            testCase={target}
          />
          <DeleteCaseDialog
            open={deleting}
            onOpenChange={setDeleting}
            testCase={target}
          />
        </>
      )}
    </section>
  )
}

/**
 * cases.delete. Past results stay in the runs that scored the case, under the
 * name it had then, so the confirm says that rather than implying history goes
 * too. The page leaves for the suite afterwards.
 */
function DeleteCaseDialog({
  open,
  onOpenChange,
  testCase,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  testCase: TestCase
}) {
  const remove = useCommand<{ caseId: string }>("cases.delete")
  const { reset } = remove
  const navigate = useNavigateTo()
  const sending = useRef(false)
  useEffect(() => {
    if (open) reset()
  }, [open, reset])
  async function confirm() {
    if (sending.current || remove.loading) return
    sending.current = true
    let result: { caseId: string } | undefined
    try {
      result = await remove.execute({ caseId: testCase.id })
    } finally {
      sending.current = false
    }
    if (!result) return
    onOpenChange(false)
    navigate(suitePath(testCase.suiteId))
  }
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && (remove.loading || sending.current)) return
        onOpenChange(next)
      }}
      title={`Delete ${testCase.name}?`}
      description="Runs that already scored it keep their results. This cannot be undone."
      confirmLabel="Delete case"
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
