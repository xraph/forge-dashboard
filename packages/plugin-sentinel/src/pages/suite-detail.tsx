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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@forge-go/dashboard-kit/components/tabs"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { BaselinesList } from "../components/baselines-list"
import { CasesTab } from "../components/cases-tab"
import { PromptsTab } from "../components/prompts-tab"
import { RedTeamTab } from "../components/redteam-tab"
import { RunsTab } from "../components/runs-tab"
import { SettledBoundary } from "../components/settled-boundary"
import { StaleNotice } from "../components/stale-notice"
import { SuiteFormDialog } from "../components/suite-form-dialog"
import {
  baselinePath,
  formatScore,
  plural,
  suiteTabPath,
  temperatureLabel,
  versionPath,
} from "../format"
import type { Suite } from "../types"
import { useSettled } from "../use-settled"

const TABS = ["cases", "runs", "prompts", "baselines", "redteam"] as const
type SuiteTab = (typeof TABS)[number]

function isTab(value: string | undefined): value is SuiteTab {
  return TABS.some((t) => t === value)
}

/**
 * /suites/:id and /suites/:id/:tab. The tab lives in the address, so a link
 * can land on a suite's runs and the back button undoes a tab change. An
 * unknown tab shows the cases. Guards the id, then keys the body on it.
 */
export const SuiteDetailPage: ComponentType<PluginPageProps> = ({ params }) => {
  const id = params.id
  if (!id)
    return <p className="text-sm text-muted-foreground">No suite selected.</p>
  return (
    <SuiteDetailBody
      key={id}
      suiteId={id}
      tab={isTab(params.tab) ? params.tab : "cases"}
    />
  )
}

function SuiteDetailBody({ suiteId, tab }: { suiteId: string; tab: SuiteTab }) {
  // Edits, case writes, starting a run and deleting a baseline all invalidate
  // this read. If that refresh fails, the page keeps the suite it had, so the
  // tabs and any dialog open in one stay put (useSettled).
  const suite = useSettled(useQuery<Suite>("suites.detail", { suiteId }))
  const navigate = useNavigateTo()
  // Dialogs live here, outside the boundary: edits and case writes
  // invalidate suites.detail, and nothing typed should vanish while it
  // refetches.
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  // Taken when a dialog opens, so its wording holds through a refetch.
  const [target, setTarget] = useState<Suite | null>(null)
  return (
    <section className="flex flex-col gap-6">
      {suite.stale && (
        <StaleNotice
          what="this suite"
          error={suite.error}
          onRetry={suite.refetch}
        />
      )}
      <SettledBoundary title="Suite" query={suite} skeletonRows={4}>
        {(s) => (
          <div className="flex flex-col gap-4">
            <PageHeader
              title={s.name}
              description={s.description || undefined}
              actions={
                <>
                  <IconButton
                    variant="outline"
                    onClick={() => {
                      setTarget(s)
                      setEditing(true)
                    }}
                    label="Edit"
                  />
                  <IconButton
                    variant="outline"
                    onClick={() => {
                      setTarget(s)
                      setDeleting(true)
                    }}
                    label="Delete"
                  />
                </>
              }
            />
            <SuiteFacts suite={s} />
          </div>
        )}
      </SettledBoundary>
      {/* A suite that never loaded has no tabs: each would fail the same way. */}
      {(suite.data !== undefined || !suite.error) && (
        <Tabs
          value={tab}
          onValueChange={(value) => {
            if (isTab(String(value)))
              navigate(suiteTabPath(suiteId, String(value) as SuiteTab))
          }}
        >
          <TabsList variant="line">
            <TabsTrigger value="cases">Cases</TabsTrigger>
            <TabsTrigger value="runs">Runs</TabsTrigger>
            <TabsTrigger value="prompts">Prompts</TabsTrigger>
            <TabsTrigger value="baselines">Baselines</TabsTrigger>
            <TabsTrigger value="redteam">Red team</TabsTrigger>
          </TabsList>
          <TabsContent value="cases">
            <CasesTab suiteId={suiteId} />
          </TabsContent>
          <TabsContent value="runs">
            <RunsTab suiteId={suiteId} suite={suite.data} />
          </TabsContent>
          <TabsContent value="prompts">
            <PromptsTab suiteId={suiteId} />
          </TabsContent>
          <TabsContent value="baselines">
            <BaselinesList suiteId={suiteId} />
          </TabsContent>
          <TabsContent value="redteam">
            <RedTeamTab suiteId={suiteId} />
          </TabsContent>
        </Tabs>
      )}
      {target && (
        <>
          <SuiteFormDialog
            open={editing}
            onOpenChange={setEditing}
            suite={target}
          />
          <DeleteSuiteDialog
            open={deleting}
            onOpenChange={setDeleting}
            suite={target}
          />
        </>
      )}
    </section>
  )
}

function SuiteFacts({ suite }: { suite: Suite }) {
  return (
    <DescriptionList
      items={[
        {
          term: "Model",
          value: suite.model ? (
            <span className="font-mono text-xs">{suite.model}</span>
          ) : (
            <span className="text-muted-foreground">Engine default</span>
          ),
        },
        { term: "Temperature", value: temperatureLabel(suite.temperature) },
        {
          term: "Persona",
          value: suite.personaRef ? (
            <span className="font-mono text-xs">{suite.personaRef}</span>
          ) : (
            <NoneCell label="persona" />
          ),
        },
        {
          term: "Prompt",
          value: suite.currentPromptVersion ? (
            <PluginLink
              to={versionPath(suite.id, suite.currentPromptVersion.id)}
            >
              {`Version ${suite.currentPromptVersion.version}`}
            </PluginLink>
          ) : (
            "The suite's own prompt"
          ),
        },
        {
          term: "Current baseline",
          value: suite.currentBaseline ? (
            <>
              <PluginLink to={baselinePath(suite.currentBaseline.id)}>
                {suite.currentBaseline.name}
              </PluginLink>
              {`, pass rate ${formatScore(suite.currentBaseline.passRate)}`}
            </>
          ) : (
            <NoneCell label="current baseline" />
          ),
        },
        { term: "Cases", value: plural(suite.caseCount, "case", "cases") },
        {
          term: "Created",
          value: <Timestamp value={suite.createdAt} label="creation time" />,
        },
        {
          term: "Updated",
          value: <Timestamp value={suite.updatedAt} label="update" />,
        },
      ]}
    />
  )
}

/**
 * suites.delete takes everything under the suite with it: cases, runs and
 * their results, baselines and prompt versions. The confirm says so, then
 * the page leaves for the suite list, since the suite no longer exists.
 */
function DeleteSuiteDialog({
  open,
  onOpenChange,
  suite,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  suite: Suite
}) {
  const remove = useCommand<{ suiteId: string }>("suites.delete")
  const { reset } = remove
  const navigate = useNavigateTo()
  const sending = useRef(false)
  useEffect(() => {
    if (open) reset()
  }, [open, reset])
  async function confirm() {
    if (sending.current || remove.loading) return
    sending.current = true
    let result: { suiteId: string } | undefined
    try {
      result = await remove.execute({ suiteId: suite.id })
    } finally {
      sending.current = false
    }
    if (!result) return
    onOpenChange(false)
    navigate("/suites")
  }
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && (remove.loading || sending.current)) return
        onOpenChange(next)
      }}
      title={`Delete ${suite.name}?`}
      description={`Its ${plural(suite.caseCount, "case", "cases")}, every run and its results, its baselines and its prompt versions are deleted with it. This cannot be undone.`}
      confirmLabel="Delete suite"
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
