import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { TagList } from "@forge-go/dashboard-kit/components/tag-list"

export function KeyScopes({ scopes }: { scopes: string[] }) {
  const regular = scopes.filter((scope) => scope !== "admin")
  return (
    <span className="flex flex-wrap items-center gap-1">
      {(regular.length > 0 || !scopes.length) && (
        <TagList values={regular} label="scopes" />
      )}
      {scopes.includes("admin") && <Badge>admin</Badge>}
    </span>
  )
}
