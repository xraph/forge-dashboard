/**
 * Rendered when a graph names an intent the registry cannot resolve. This is
 * the normal state for a contributor module that has not loaded yet, so it is
 * deliberately quiet and deliberately visible: quiet enough not to look like a
 * crash, visible enough that a typo in a manifest is noticed.
 */
export function UnknownIntent({ intent }: { intent: string }) {
  return (
    <div
      role="status"
      className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground"
    >
      Unknown intent: {intent}
    </div>
  )
}
