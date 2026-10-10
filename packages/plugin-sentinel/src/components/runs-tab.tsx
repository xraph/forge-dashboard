import { useState } from "react"
import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import type { SentinelConfig, Suite } from "../types"
import { RunsList } from "./runs-list"
import { RunTrend } from "./run-trend"
import { StartRunDialog } from "./start-run-dialog"

/**
 * A suite's runs, and the way to start one. The start button exists only when
 * a run could start: a target is registered and the suite has a case.
 * Otherwise the tab says which of the two is missing, in place of the button.
 */
export function RunsTab({
  suiteId,
  suite,
}: {
  suiteId: string
  suite: Suite | undefined
}) {
  const config = useQuery<SentinelConfig>("config.get")
  const [starting, setStarting] = useState(false)
  // Taken when the dialog opens, so its wording holds through a refetch.
  const [chosen, setChosen] = useState<{
    suite: Suite
    config: SentinelConfig
  } | null>(null)
  const cfg = config.data
  const noTarget = cfg !== undefined && cfg.targets.length === 0
  const noCase = suite !== undefined && suite.caseCount === 0
  const start =
    suite !== undefined && cfg !== undefined && !noTarget && !noCase ? (
      <Button
        onClick={() => {
          setChosen({ suite, config: cfg })
          setStarting(true)
        }}
      >
        Start run
      </Button>
    ) : null
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {noTarget ? (
            <>
              {"No target is registered, so no run can start. "}
              <PluginLink to="/setup">Setup</PluginLink>
              {" shows how to register one."}
            </>
          ) : noCase ? (
            "This suite has no cases, so a run would have nothing to score. Add a case first."
          ) : config.error ? (
            "The engine's targets could not be read, so a run cannot be started from here."
          ) : (
            "Each run sends every case to a target and scores the answers."
          )}
        </p>
        {start}
      </div>
      <RunTrend suiteId={suiteId} />
      <RunsList suiteId={suiteId} />
      {chosen && (
        <StartRunDialog
          open={starting}
          onOpenChange={setStarting}
          suite={chosen.suite}
          config={chosen.config}
        />
      )}
    </div>
  )
}
