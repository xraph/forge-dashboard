import { IconButton } from "@forge-go/dashboard-kit/components/icon-button"
import { useState } from "react"
import { useQuery } from "@forge-go/dashboard-plugin"
import { plural } from "../format"
import type { Baseline, BaselinesList as BaselinesData } from "../types"
import { BaselinesTable } from "./baselines-table"
import { DeleteBaselineDialog } from "./delete-baseline-dialog"
import { SettledBoundary } from "./settled-boundary"

/**
 * Baselines for one suite or for all of them, each with a delete. A baseline
 * is saved from a completed run's page, so the empty state says where.
 */
export function BaselinesList({ suiteId }: { suiteId?: string }) {
  const baselines = useQuery<BaselinesData>("baselines.list", suiteId ? { suiteId } : undefined)
  const [deleting, setDeleting] = useState(false)
  // Taken when the dialog opens, so its wording holds through the refetch.
  const [target, setTarget] = useState<Baseline | null>(null)
  return (
    <>
      <SettledBoundary title="Baselines" query={baselines} skeletonRows={4}>
        {(data) => (
          <BaselinesTable
            baselines={data.items}
            showSuite={suiteId === undefined}
            caption={`${plural(data.items.length, "baseline", "baselines")}, newest first`}
            emptyMessage="No baselines yet. Save one from a completed run's page, and later runs are compared with it."
            actions={(b) => (
              <IconButton variant="ghost" onClick={() => {
                  setTarget(b)
                  setDeleting(true)
                }} label={`Delete ${b.name}`} />
            )}
          />
        )}
      </SettledBoundary>
      {target && <DeleteBaselineDialog open={deleting} onOpenChange={setDeleting} baseline={target} />}
    </>
  )
}
