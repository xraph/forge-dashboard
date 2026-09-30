/**
 * An error alert made only of spans.
 *
 * It exists for alerts inside phrasing-only slots such as a dialog
 * description, which the kit renders as a `<p>`: the kit's CommandAlert is a
 * div, and a div inside a paragraph is invalid markup. Everywhere else, use
 * CommandAlert. Styled like it.
 */
export function InlineAlert({ title, error }: { title: string; error: { code: string; message: string } }) {
  return (
    <span role="alert" className="flex flex-col gap-0.5 rounded-md border border-destructive/50 px-3 py-2 text-sm text-destructive">
      <span className="font-medium">{title}</span>
      <span>{error.message}</span>
      <span className="font-mono text-xs opacity-70">{error.code}</span>
    </span>
  )
}
