import { IconButton } from "@forge-go/dashboard-kit/components/icon-button"
import { Suspense, lazy, useState } from "react"
import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { DescriptionList } from "@forge-go/dashboard-kit/components/detail-layout"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { CurrentBadge } from "../badges"
import { SetCurrentDialog } from "../components/set-current-dialog"
import { SettledBoundary } from "../components/settled-boundary"
import { formatScore, suitePath } from "../format"
import type { PromptVersion, PromptVersionDetail, Suite } from "../types"

// Its own chunk, and this page is itself a lazy route: nothing the plugin
// entry reaches imports CodeMirror statically. The fallback says what is
// coming.
const PromptDiff = lazy(() => import("../components/prompt-diff"))

/** /suites/:id/prompts/:versionId. Guards the ids, then keys the body on them. */
export default function PromptVersionPage({ params }: PluginPageProps) {
  const suiteId = params.id
  const versionId = params.versionId
  if (!suiteId || !versionId)
    return <p className="text-sm text-muted-foreground">No version selected.</p>
  return <PromptVersionBody key={versionId} versionId={versionId} />
}

function PromptVersionBody({ versionId }: { versionId: string }) {
  const detail = useQuery<PromptVersionDetail>("prompts.detail", { versionId })
  // The suite is the one the version names, not the one in the URL, so it is
  // asked for once the version has answered.
  const ownSuiteId = detail.data?.suiteId
  const suite = useQuery<Suite>(
    "suites.detail",
    { suiteId: ownSuiteId },
    { enabled: ownSuiteId !== undefined }
  )
  const [making, setMaking] = useState(false)
  const [target, setTarget] = useState<PromptVersion | null>(null)
  return (
    <section className="flex flex-col gap-6">
      <SettledBoundary title="Prompt version" query={detail} skeletonRows={5}>
        {(v) => (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <PageHeader
                title={`Version ${v.version}`}
                actions={
                  v.isCurrent ? undefined : (
                    <IconButton
                      variant="outline"
                      onClick={() => {
                        setTarget(v)
                        setMaking(true)
                      }}
                      label="Make current"
                    />
                  )
                }
              />
              {v.isCurrent && (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <CurrentBadge /> Runs started now use this prompt.
                </p>
              )}
            </div>
            <DescriptionList
              items={[
                {
                  term: "Suite",
                  value: (
                    <PluginLink to={suitePath(v.suiteId)}>
                      {suite.data?.name ?? "Back to the suite"}
                    </PluginLink>
                  ),
                },
                {
                  term: "Changelog",
                  value: v.changelog || <NoneCell label="changelog" />,
                },
                { term: "Runs", value: String(v.runCount) },
                {
                  term: "Latest pass rate",
                  value:
                    v.latestPassRate === undefined ? (
                      <NoneCell label="completed run" />
                    ) : (
                      formatScore(v.latestPassRate)
                    ),
                },
                {
                  term: "Created",
                  value: (
                    <Timestamp value={v.createdAt} label="creation time" />
                  ),
                },
              ]}
            />
            <section
              aria-labelledby="sentinel-version-prompt"
              className="flex flex-col gap-2"
            >
              <h2 id="sentinel-version-prompt" className="text-sm font-medium">
                Prompt
              </h2>
              <pre className="max-h-[32rem] overflow-auto rounded-md border p-3 font-mono text-xs break-words whitespace-pre-wrap">
                {v.systemPrompt}
              </pre>
            </section>
            <Changes version={v} />
          </div>
        )}
      </SettledBoundary>
      {target && (
        <SetCurrentDialog
          open={making}
          onOpenChange={setMaking}
          version={target}
        />
      )}
    </section>
  )
}

/** The diff against the version before, or why there is none. */
function Changes({ version }: { version: PromptVersionDetail }) {
  const previous = version.previous
  if (!previous) {
    return (
      <p className="text-sm text-muted-foreground">
        This is the first version, so there is nothing to compare it with.
      </p>
    )
  }
  const label = `Version ${previous.version} against version ${version.version}`
  return (
    <section
      aria-labelledby="sentinel-version-changes"
      className="flex flex-col gap-2"
    >
      <h2 id="sentinel-version-changes" className="text-sm font-medium">
        {`Changes from version ${previous.version}`}
      </h2>
      {previous.systemPrompt === version.systemPrompt ? (
        <p className="text-sm text-muted-foreground">
          {`The prompt is the same as version ${previous.version}'s.`}
        </p>
      ) : (
        <Suspense
          fallback={
            <p role="status" className="text-sm text-muted-foreground">
              Loading the comparison.
            </p>
          }
        >
          <PromptDiff
            was={previous.systemPrompt}
            now={version.systemPrompt}
            label={label}
          />
        </Suspense>
      )}
    </section>
  )
}
