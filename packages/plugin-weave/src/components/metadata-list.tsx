import { DescriptionList } from "@forge-go/dashboard-kit/components/detail-layout"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"

/** Metadata sorted by key. A retrieval hit's metadata can be null. */
export function MetadataList({ metadata }: { metadata: Record<string, string> | null | undefined }) {
  const map = metadata ?? {}
  const keys = Object.keys(map).sort()
  if (keys.length === 0) return <NoneCell label="metadata" />
  return (
    <DescriptionList
      items={keys.map((k) => ({
        term: k,
        value: <span className="font-mono text-xs break-all">{map[k]}</span>,
      }))}
    />
  )
}
