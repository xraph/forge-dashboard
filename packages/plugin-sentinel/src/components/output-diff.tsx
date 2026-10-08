import { IconButton } from "@forge-go/dashboard-kit/components/icon-button"
import { Suspense, lazy, useState } from "react"
import { useQuery } from "@forge-go/dashboard-plugin"
import type { CasePair, ResultDetail } from "../types"
import { PlainText } from "./plain-text"

// CodeMirror's merge view, reached only through this lazy import from a page
// that is itself a lazy route.
const PromptDiff = lazy(() => import("./prompt-diff"))

/**
 * One case's outputs in two runs, as a diff: A's output is what was, B's is
 * what is now. A case only one run scored shows that run's output alone. A
 * red-team case stays collapsed until asked for, as everywhere else, and the
 * reveal belongs to this case alone.
 */
export function OutputDiff({ pair, aRunId, bRunId }: { pair: CasePair; aRunId: string; bRunId: string }) {
  const a = useQuery<ResultDetail>("results.detail", { runId: aRunId, resultId: pair.a?.id }, { enabled: pair.a !== undefined })
  const b = useQuery<ResultDetail>("results.detail", { runId: bRunId, resultId: pair.b?.id }, { enabled: pair.b !== undefined })
  const attack = pair.a?.redTeam?.attackType ?? pair.b?.redTeam?.attackType
  const [shown, setShown] = useState(false)
  const error = a.error ?? b.error
  if (error) {
    return <p role="alert" className="text-sm text-destructive">{`The outputs could not be read. ${error.message}`}</p>
  }
  if ((pair.a && !a.data) || (pair.b && !b.data)) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Reading the outputs.
      </p>
    )
  }
  if (attack && !shown) {
    return (
      <div className="flex flex-col items-start gap-2 rounded-md border border-dashed p-3">
        <p className="text-sm text-muted-foreground">
          Red-team output stays hidden until you ask for it: it may repeat the system prompt or carry the attack.
        </p>
        <IconButton variant="outline" onClick={() => setShown(true)} label={`Show outputs (${attack})`} />
      </div>
    )
  }
  if (!a.data || !b.data) {
    const only = a.data ?? b.data
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">
          {a.data ? "Only run A scored this case." : "Only run B scored this case."}
        </p>
        {only && <PlainText value={only.output} label={`Output of ${pair.caseName}`} />}
      </div>
    )
  }
  if (a.data.output === b.data.output) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">Both runs gave the same output.</p>
        <PlainText value={b.data.output} label={`Output of ${pair.caseName}`} />
      </div>
    )
  }
  return (
    <Suspense
      fallback={
        <p role="status" className="text-sm text-muted-foreground">
          Loading the comparison.
        </p>
      }
    >
      <PromptDiff was={a.data.output} now={b.data.output} label={`Output of ${pair.caseName}, A against B`} />
    </Suspense>
  )
}
