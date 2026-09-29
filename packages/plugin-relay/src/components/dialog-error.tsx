/**
 * An error rendered inside a dialog. Base UI makes everything outside an
 * open dialog inert, so an error on the page body is invisible to the person
 * who caused it. A <span>, because a dialog's description is a <p>.
 */
export function DialogError({
  what,
  error,
}: {
  what: string
  error?: { message: string; code: string }
}) {
  if (!error) return null
  return (
    <span role="alert" className="mt-2 block font-medium text-destructive">
      Could not {what}: {error.message} ({error.code})
    </span>
  )
}
