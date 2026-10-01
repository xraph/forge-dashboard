/** A route's page. Config route ids contain "/", so the id is one encoded segment. */
export function routePath(id: string): string {
  return `/routes/${encodeURIComponent(id)}`
}

export function routeEditPath(id: string): string {
  return `${routePath(id)}/edit`
}
