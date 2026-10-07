import { useId, useState } from "react"
import type { FormEvent } from "react"
import { useNavigateTo, useQuery } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@forge-go/dashboard-kit/components/dialog"
import { Label } from "@forge-go/dashboard-kit/components/label"
import {
  NativeSelect,
  NativeSelectOption,
} from "@forge-go/dashboard-kit/components/native-select"
import { comparePath, formatDay, formatScore, shortRunId } from "../format"
import type { Run, RunsList } from "../types"

/**
 * Pick another run of the same suite and open the comparison. The older run
 * is always A and the newer B, because the server reads B as the current one
 * and every change as B minus A; the comparison page can swap them.
 */
export function CompareDialog({
  open,
  onOpenChange,
  run,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  run: Pick<Run, "id" | "suiteId" | "createdAt">
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-md">
        {open && <CompareForm run={run} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function CompareForm({ run, onDone }: { run: Pick<Run, "id" | "suiteId" | "createdAt">; onDone: () => void }) {
  const id = useId()
  const navigate = useNavigateTo()
  const runs = useQuery<RunsList>("runs.list", { suiteId: run.suiteId, limit: 100 })
  const others = (runs.data?.items ?? []).filter((r) => r.id !== run.id)
  const [otherId, setOtherId] = useState("")
  const chosen = others.find((r) => r.id === otherId) ?? others[0]

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!chosen) return
    const thisFirst = run.createdAt <= chosen.createdAt
    onDone()
    navigate(thisFirst ? comparePath(run.id, chosen.id) : comparePath(chosen.id, run.id))
  }

  return (
    <form onSubmit={submit} className="contents" noValidate>
      <DialogHeader>
        <DialogTitle>Compare with another run</DialogTitle>
        <DialogDescription>Runs of the same suite. The older run is A and the newer one B.</DialogDescription>
      </DialogHeader>
      {runs.error ? (
        <p role="alert" className="text-sm text-destructive">{`The suite's runs could not be read. ${runs.error.message}`}</p>
      ) : !runs.data ? (
        <p role="status" className="text-sm text-muted-foreground">
          Reading the suite's runs.
        </p>
      ) : others.length === 0 ? (
        <p className="text-sm text-muted-foreground">This suite has no other run to compare with.</p>
      ) : (
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${id}-run`}>Run</Label>
          <NativeSelect id={`${id}-run`} value={chosen?.id ?? ""} onChange={(e) => setOtherId(e.target.value)}>
            {others.map((r) => (
              <NativeSelectOption key={r.id} value={r.id}>
                {`${shortRunId(r.id)}, ${r.state}, ${formatDay(r.createdAt)}, pass rate ${formatScore(r.passRate)}`}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      )}
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
        <Button type="submit" disabled={!chosen}>
          Compare
        </Button>
      </DialogFooter>
    </form>
  )
}

