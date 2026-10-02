/** What names one relation graph: an object and a relation, and optionally more. */
export interface RelationGraphTarget {
  objectType: string
  objectId: string
  relation: string
  /** Ask for the walk's path to this subject. */
  subject?: { type: string; id: string }
  /** Where to expand from. Absent and "" are both the tenant root. */
  namespace?: string
}

/**
 * The route of a relation graph, scope-relative.
 *
 * A plugin cannot read a query string, so everything is a path segment, each
 * encoded so an id with a slash in it stays one. The namespace comes last and
 * only when it is not the root, so the root's routes are the short ones.
 * Kept apart from the graph itself so a page can link to one without
 * importing the canvas.
 */
export function relationGraphPath(target: RelationGraphTarget): string {
  const segment = encodeURIComponent
  let path = `/relations/graph/${segment(target.objectType)}/${segment(target.objectId)}/${segment(target.relation)}`
  if (target.subject) {
    path += `/to/${segment(target.subject.type)}/${segment(target.subject.id)}`
  }
  if (target.namespace) path += `/in/${segment(target.namespace)}`
  return path
}
