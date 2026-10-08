import { useQuery } from "@forge-go/dashboard-plugin"
import type { Collection, ListOutput } from "./types"

export interface CollectionOptions {
  options: { label: string; value: string }[]
  /** Something the person should know about the list, or null. */
  note: string | null
  /** true while collections.list has not answered yet. */
  loading: boolean
  /** true when collections.list answered with an error, so the note is an error rather than a hint. */
  error: boolean
}

/**
 * The options for a collection picker. A collection named by the address that
 * the list doesn't hold stays selected, labelled for why: still loading, the
 * read failed, or it isn't there. A failed read and a list longer than the
 * first page both come back as a note, so neither passes for "no collections".
 */
export function useCollectionOptions(selected: string, emptyLabel: string): CollectionOptions {
  const query = useQuery<ListOutput<Collection>>("collections.list", { limit: 100 })
  const items = query.data?.items ?? []
  const failed = query.error !== undefined
  const loading = query.data === undefined && !failed

  const options = [{ label: emptyLabel, value: "" }, ...items.map((c) => ({ label: c.name, value: c.id }))]
  if (selected !== "" && !items.some((c) => c.id === selected)) {
    options.push({ label: loading ? "Loading collections…" : failed ? selected : `${selected} (not found)`, value: selected })
  }

  let note: string | null = null
  if (query.error) note = `Couldn't load the collection list: ${query.error.message}`
  else if (query.data && query.data.total > items.length) note = `The picker lists the first ${items.length} of ${query.data.total} collections.`

  return { options, note, loading, error: failed }
}
