import { useId } from "react"
import { useCommand, useQuery, queryStore } from "@forge-go/dashboard-plugin"
import type { ContextDimension } from "@forge-go/dashboard-plugin"
import {
  NativeSelect,
  NativeSelectOption,
} from "@forge-go/dashboard-kit/components/native-select"

function Dimension({ dimension }: { dimension: ContextDimension }) {
  const id = useId()
  const read = useQuery(dimension.query)
  const switchTo = useCommand(dimension.switchCommand)

  // Nothing to switch between until the read lands. Rendering an empty select
  // in the meantime would let somebody pick "nothing" out of it.
  if (!read.data) return null

  const { current, options } = dimension.select(read.data)
  if (options.length === 0) return null

  async function select(optionId: string) {
    const result = await switchTo.execute(dimension.payload(optionId))
    if (result === undefined) return

    // Everything, not just what meta.invalidates named. The cookie changed, so
    // every read in the dashboard is now a question about a different app, and
    // the server has no way to enumerate that. This is the one place the store
    // throws away more than it was told to.
    queryStore.clear()
  }

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs text-muted-foreground">
        {dimension.label}
      </label>
      <NativeSelect
        id={id}
        value={current?.id ?? ""}
        disabled={switchTo.loading}
        onChange={(event) => void select(event.target.value)}
        className="w-full"
      >
        {options.map((option) => (
          <NativeSelectOption key={option.id} value={option.id}>
            {option.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  )
}

/**
 * The scope-wide selectors, rendered into the sidebar under the scope
 * switcher.
 *
 * The host has no idea what an app or an environment is. It reads whatever
 * intent the plugin named, projects it through the plugin's own `select`, and
 * sends the plugin's own command. Authsome declares two dimensions; core and
 * streaming declare none and this renders nothing for them.
 *
 * Two dimensions sharing one query is the normal case, not an edge case: both
 * of authsome's read `apps.context`. The store collapses that to a single
 * request, which is the reason this component can be this naive.
 */
export function ContextSwitchers({
  dimensions,
}: {
  dimensions: ContextDimension[]
}) {
  if (dimensions.length === 0) return null

  return (
    <div className="flex flex-col gap-2 px-2 py-1">
      {dimensions.map((dimension) => (
        <Dimension key={dimension.id} dimension={dimension} />
      ))}
    </div>
  )
}
