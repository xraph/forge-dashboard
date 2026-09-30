/**
 * A record's tenant.
 *
 * chronicle sends "" for an app-level record. A server from before the field
 * existed sends nothing at all, and that is not the same thing: it is never
 * shown as app level, because nothing said so. `appLevel` is the caller's
 * wording, since what an app-level record reaches depends on the record.
 */
export function TenantValue({ tenantId, appLevel = "App level" }: { tenantId: string | undefined; appLevel?: string }) {
  if (tenantId === undefined) return <span className="text-muted-foreground">Not reported by this server</span>
  if (tenantId === "") return <span>{appLevel}</span>
  return <span className="font-mono text-xs">{tenantId}</span>
}
