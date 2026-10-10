import { IconButton } from "@forge-go/dashboard-kit/components/icon-button"
import { useState } from "react"
import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { CurrentBadge } from "../badges"
import { formatScore, plural, versionPath } from "../format"
import type { PromptVersion, PromptVersionsList, Suite } from "../types"
import { PromptVersionDialog } from "./prompt-version-dialog"
import { SetCurrentDialog } from "./set-current-dialog"
import { SettledBoundary } from "./settled-boundary"

const columns: Column<PromptVersion>[] = [
  {
    id: "version",
    header: "Version",
    className: "font-medium",
    cell: (v) => (
      <span className="flex items-center gap-2">
        <PluginLink
          to={versionPath(v.suiteId, v.id)}
        >{`Version ${v.version}`}</PluginLink>
        {v.isCurrent && <CurrentBadge />}
      </span>
    ),
  },
  {
    id: "changelog",
    header: "Changelog",
    cell: (v) => v.changelog || <NoneCell label="changelog" />,
  },
  {
    id: "runs",
    header: "Runs",
    align: "end",
    className: "tabular-nums",
    cell: (v) => v.runCount,
  },
  {
    id: "passRate",
    header: "Latest pass rate",
    align: "end",
    className: "tabular-nums",
    cell: (v) =>
      v.latestPassRate === undefined ? (
        <NoneCell label="completed run" />
      ) : (
        formatScore(v.latestPassRate)
      ),
  },
  {
    id: "created",
    header: "Created",
    cell: (v) => <Timestamp value={v.createdAt} label="creation time" />,
  },
]

/**
 * A suite's prompt versions, oldest first. Runs use the current version's
 * prompt, or the suite's own when no version is current, and the pass rate
 * beside each version is its newest completed run's.
 */
export function PromptsTab({ suiteId }: { suiteId: string }) {
  const versions = useQuery<PromptVersionsList>("prompts.list", { suiteId })
  // Shares its entry with the page's own read of the suite.
  const suite = useQuery<Suite>("suites.detail", { suiteId })
  const [creating, setCreating] = useState(false)
  const [making, setMaking] = useState(false)
  const [target, setTarget] = useState<PromptVersion | null>(null)

  const current = versions.data?.items.find((v) => v.isCurrent)
  const initialPrompt = current?.systemPrompt ?? suite.data?.systemPrompt ?? ""
  // A new version starts from the prompt runs use today, which is only known
  // once both reads have answered. Until then the form would start from the
  // wrong text, and making it current is ticked by default.
  const ready = versions.data !== undefined && suite.data !== undefined
  const create = (
    <Button disabled={!ready} onClick={() => setCreating(true)}>
      New version
    </Button>
  )

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">{create}</div>
      <SettledBoundary
        title="Prompt versions"
        query={versions}
        skeletonRows={3}
      >
        {(data) => (
          <div className="flex min-w-0 flex-col gap-1.5">
            <ResourceTable<PromptVersion>
              columns={columns}
              rows={data.items}
              rowKey={(v) => v.id}
              caption={plural(data.items.length, "version", "versions")}
              emptyMessage="No prompt versions yet. Runs use the suite's own prompt."
              emptyAction={create}
              rowActions={(v) =>
                v.isCurrent ? null : (
                  <IconButton
                    variant="outline"
                    onClick={() => {
                      setTarget(v)
                      setMaking(true)
                    }}
                    label={`Make version ${v.version} current`}
                  />
                )
              }
            />
            {data.items.length > 0 && !current && (
              <p className="text-xs text-muted-foreground">
                No version is current, so runs use the suite's own prompt.
              </p>
            )}
          </div>
        )}
      </SettledBoundary>
      <PromptVersionDialog
        open={creating}
        onOpenChange={setCreating}
        suiteId={suiteId}
        initialPrompt={initialPrompt}
      />
      {target && (
        <SetCurrentDialog
          open={making}
          onOpenChange={setMaking}
          version={target}
        />
      )}
    </div>
  )
}
