import { Button } from "@forge-go/dashboard-kit/components/button"
import type { Column } from "@forge-go/dashboard-kit/components/resource-table"
import { ResourceTable } from "@forge-go/dashboard-kit/components/resource-table"
import { CursorPager, EmptyResults, useCursor } from "./cursor"
import type { DurablePage } from "./durable-types"

export function DurableTable<T>({
  title,
  data,
  columns,
  rowKey,
  paging,
  loading,
  refresh,
  filtered = false,
  reset = paging.reset,
}: {
  title: string
  data: DurablePage<T>
  columns: Column<T>[]
  rowKey: (row: T) => string
  paging: ReturnType<typeof useCursor>
  loading: boolean
  refresh: () => void
  filtered?: boolean
  reset?: () => void
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p className="text-xs text-muted-foreground" role="status">
        {data.items.length === 0 ? `0 ${title} shown · ` : ""}Total unavailable
        · {data.observation.replaceAll("_", " ")}
        {data.revision ? ` · Revision ${data.revision}` : ""}
        {data.high_water ? ` · High water ${data.high_water}` : ""}
      </p>
      {data.restricted && (
        <p role="status" className="text-xs text-muted-foreground">
          Some linked runs are restricted. This view covers authorized records
          only.
        </p>
      )}
      {data.items.length ? (
        <ResourceTable
          density="compact"
          rows={data.items}
          columns={columns}
          rowKey={rowKey}
          caption={`${data.items.length} ${title} shown`}
          emptyMessage={`No ${title}`}
        />
      ) : (
        <EmptyResults
          subject={title}
          filtered={filtered}
          complete={data.complete}
          onReset={reset}
          onRefresh={refresh}
          onContinue={
            data.cursor && !loading
              ? () => paging.next(data.cursor!)
              : undefined
          }
        />
      )}
      {paging.page > 1 && (
        <Button
          size="xs"
          variant="ghost"
          disabled={loading}
          onClick={paging.reset}
        >
          Restart pagination
        </Button>
      )}
      <CursorPager
        result={{ nextCursor: data.cursor ?? null, complete: data.complete }}
        paging={paging}
        loading={loading}
      />
    </div>
  )
}
