/**
 * Plain presentational panels for two of the resolver's four states. These
 * take their content as props and render nothing else - no data fetching, no
 * client, no host wiring - so Task 5 can drop them in wherever
 * resolvePluginState says to, passing the matching PluginState fields
 * straight through.
 *
 * Styled with plain Tailwind utility classes rather than the component
 * library: this package stays free of @forge/dashboard-kit, matching the
 * house pattern in packages/runtime/src/fallbacks.tsx. The classes resolve
 * against the kit's tokens once the host loads its stylesheet.
 */

export function MismatchPanel({ required, reported }: { required: string; reported: string }) {
  return (
    <div
      role="status"
      className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground"
    >
      Version mismatch: this UI requires {required}, but the running extension reports {reported}.
    </div>
  )
}

export function SetupPanel({ message }: { message?: string }) {
  return (
    <div
      role="status"
      className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground"
    >
      {message ?? "This extension is not configured yet."}
    </div>
  )
}
