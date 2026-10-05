import { Link } from "react-router"

/**
 * What a plugin's scope shows at a path none of its routes answer: a stale
 * bookmark, a mistyped link, or a page a newer build of the plugin adds. Said
 * plainly, with the way back, so the pane is never silently blank.
 */
export function NotFoundPanel({ label, home }: { label: string; home: string }) {
  return (
    <div role="status" className="flex flex-col gap-2 rounded-md border border-dashed px-4 py-3 text-sm">
      <p>{label} has no page at this address.</p>
      <Link to={home} className="w-fit underline">
        Go to {label}
      </Link>
    </div>
  )
}
