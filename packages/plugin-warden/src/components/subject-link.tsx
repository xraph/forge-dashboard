import { PluginLink } from "@forge-go/dashboard-plugin"
import { cn } from "@forge-go/dashboard-kit/lib/utils"

/**
 * The path of a subject's access page. Both parts are encoded, so an id that
 * holds a slash (`a/b`) stays one segment and the route matches it.
 */
export function subjectPath(kind: string, id: string): string {
  return `/subjects/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`
}

/**
 * A subject, `kind:id`, linked to what it can do.
 *
 * Plain text when the kind is empty, because the route has no segment for an
 * empty one (`/subjects//alice` names no route), and when the id is empty,
 * because the page refuses a subject with no id. A subject with no kind is a
 * real thing the check log can hold, so it is shown, only not linked.
 *
 * It always renders one element carrying `className`, so a caller styles the
 * subject the same whether or not it links.
 */
export function SubjectLink({
  kind,
  id,
  className,
}: {
  kind: string
  id: string
  className?: string
}) {
  const text = `${kind}:${id}`
  if (kind === "" || id === "") return <span className={className}>{text}</span>
  return (
    <PluginLink
      to={subjectPath(kind, id)}
      className={cn("underline underline-offset-4", className)}
    >
      {text}
    </PluginLink>
  )
}
