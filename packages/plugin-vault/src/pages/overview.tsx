import type { ComponentType } from "react"
import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { StatGrid } from "@forge-go/dashboard-kit/components/stat-grid"
import { RecentActivity } from "../components/recent-activity"
import type { AuditEntry } from "../flag-types"

/**
 * Mirrors the Go `overviewStatsResponse`. Field names are its JSON tags. Any
 * count that fails to read fails the whole query, so a zero here is a real
 * zero and never a stand-in for an error.
 */
export interface OverviewStats {
  secrets: number
  unencryptedSecrets: number
  flags: number
  configEntries: number
  configOverrides: number
  rotationPolicies: number
  rotationEnabled: number
  rotationOverdue: number
  rotationWithoutRotator: number
  rotationFailures24h: number
  /**
   * Earlier version rows stored without encryption, and earlier version rows
   * vault never recorded either way (written before it kept track). Each
   * secret's current version is left out of both: unencryptedSecrets already
   * counts a current value stored in the clear.
   */
  plaintextVersions: number
  unrecordedVersions: number
  /** Secrets whose expiry has passed, and secrets expiring within 30 days. */
  expiredSecrets: number
  expiringSecrets: number
  encryptionEnabled: boolean
  /** "" when no key is configured. */
  encryptionAlgorithm: string
  /** Writes only: the server leaves secret reads out. */
  recentActivity: AuditEntry[]
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The audit page reads these filters from its URL search params. The count
 * above it is the last 24 hours, so the link is too: without `since` it would
 * open every failure the vault has ever logged.
 */
function failedRotationsPath(now: number = Date.now()): string {
  const since = new Date(now - DAY_MS).toISOString()
  return `/audit?action=secret.rotated&outcome=failure&since=${encodeURIComponent(since)}`
}

interface Problem {
  id: string
  text: string
  to: string
}

/** One line per problem, only for a count that is not zero. */
function problems(s: OverviewStats): Problem[] {
  const out: Problem[] = []
  if (s.unencryptedSecrets > 0) {
    const n = s.unencryptedSecrets
    out.push({
      id: "unencrypted",
      text: `${n} ${n === 1 ? "secret is" : "secrets are"} stored without encryption.`,
      to: "/secrets",
    })
  }
  if (s.expiredSecrets > 0) {
    const n = s.expiredSecrets
    out.push({
      id: "expired",
      text: `${n} ${n === 1 ? "secret has" : "secrets have"} expired.`,
      to: "/secrets?expiry=expired",
    })
  }
  if (s.expiringSecrets > 0) {
    const n = s.expiringSecrets
    out.push({
      id: "expiring",
      text: `${n} ${n === 1 ? "secret expires" : "secrets expire"} within 30 days.`,
      to: "/secrets?expiry=30d",
    })
  }
  // Only with a key: with none, the encryption line already says everything is
  // stored in the clear, and a count of plaintext rows would add nothing.
  if (s.encryptionEnabled && s.plaintextVersions > 0) {
    const n = s.plaintextVersions
    out.push({
      id: "plaintext-versions",
      text: `${n} earlier secret ${n === 1 ? "version is" : "versions are"} stored without encryption.`,
      to: "/secrets",
    })
  }
  if (s.rotationOverdue > 0) {
    const n = s.rotationOverdue
    out.push({
      id: "overdue",
      text: `${n} rotation ${n === 1 ? "policy is" : "policies are"} overdue.`,
      to: "/rotation",
    })
  }
  if (s.rotationWithoutRotator > 0) {
    const n = s.rotationWithoutRotator
    out.push({
      id: "no-rotator",
      text: `${n} enabled ${n === 1 ? "policy has" : "policies have"} no rotator and will never rotate.`,
      to: "/rotation",
    })
  }
  if (s.rotationFailures24h > 0) {
    const n = s.rotationFailures24h
    out.push({
      id: "failed",
      text: `${n} rotation ${n === 1 ? "attempt" : "attempts"} failed in the last 24 hours.`,
      to: failedRotationsPath(),
    })
  }
  return out
}

/**
 * The encryption line. It says what happens to NEW secrets, and it never says
 * the vault is encrypted while a stored version is in the clear: adding a key
 * later does not encrypt what was stored before it, and neither does
 * replacing a value, which leaves the earlier versions as they were.
 *
 * The counts are real, so nothing here says they cannot be counted. A version
 * vault never recorded is reported as exactly that, not folded into either
 * figure.
 */
function EncryptionLine({ stats }: { stats: OverviewStats }) {
  if (!stats.encryptionEnabled) {
    return (
      <p className="text-sm text-destructive">
        No encryption key is configured, so new secrets are stored unencrypted.
      </p>
    )
  }
  const how = stats.encryptionAlgorithm
    ? ` with ${stats.encryptionAlgorithm}`
    : ""
  const parts = [`New secrets are encrypted${how}.`]
  if (stats.unencryptedSecrets > 0) {
    parts.push(
      "Secrets stored without encryption stay that way until their values are replaced."
    )
  }
  if (stats.plaintextVersions > 0) {
    const n = stats.plaintextVersions
    parts.push(
      `${n} earlier ${n === 1 ? "version is" : "versions are"} stored without encryption. Replacing a value does not encrypt the versions before it.`
    )
  }
  if (stats.unrecordedVersions > 0) {
    const n = stats.unrecordedVersions
    parts.push(
      `Vault can't tell how ${n} older ${n === 1 ? "version was" : "versions were"} stored.`
    )
  }
  return <p className="text-sm text-muted-foreground">{parts.join(" ")}</p>
}

export const OverviewPage: ComponentType<PluginPageProps> = () => {
  const stats = useQuery<OverviewStats>("overview.stats", {})

  return (
    <section className="flex min-w-0 flex-col gap-4">
      <PageHeader
        title="Overview"
        description="What needs attention in this vault, then what it holds."
      />

      <QueryBoundary title="Overview" query={stats} skeletonRows={4}>
        {(data) => {
          const list = problems(data)
          return (
            <>
              {list.length > 0 ? (
                <section className="flex min-w-0 flex-col gap-2">
                  <h2 className="text-sm font-medium text-destructive">
                    Needs attention
                  </h2>
                  <ul className="flex min-w-0 flex-col gap-1 text-sm">
                    {list.map((p) => (
                      <li key={p.id}>
                        <PluginLink
                          to={p.to}
                          className="underline underline-offset-4"
                        >
                          {p.text}
                        </PluginLink>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : data.encryptionEnabled ? (
                // A vault with no key is not one where nothing needs attention,
                // and the line below says so, so this stays out of its way.
                <p className="text-sm text-muted-foreground">
                  Nothing needs attention.
                </p>
              ) : null}

              <EncryptionLine stats={data} />

              <StatGrid
                items={[
                  { label: "Secrets", value: data.secrets },
                  { label: "Flags", value: data.flags },
                  { label: "Config entries", value: data.configEntries },
                  { label: "Config overrides", value: data.configOverrides },
                  {
                    label: "Rotation policies",
                    value: data.rotationPolicies,
                    hint: `${data.rotationEnabled} enabled`,
                  },
                ]}
              />

              <div className="flex min-w-0 flex-col gap-2">
                <RecentActivity entries={data.recentActivity ?? []} showKey />
                <PluginLink
                  to="/audit"
                  className="text-sm underline underline-offset-4"
                >
                  See the audit log
                </PluginLink>
              </div>
            </>
          )
        }}
      </QueryBoundary>
    </section>
  )
}
