import { TagList } from "@forge-go/dashboard-kit/components/tag-list"
import { NeverMatchesBadge } from "../badges"
import type { FlagRuleSummary } from "../flag-types"

/**
 * A UTC instant as the operator would write it: "2026-03-01 09:00". Seconds
 * appear only when they are not zero. An unparseable value is shown as it
 * arrived, since that string is the only useful thing to see then.
 */
export function formatUTC(iso: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return iso
  return at
    .toISOString()
    .replace(/\.000Z$/, "")
    .replace(/Z$/, "")
    .replace(/:00$/, "")
    .replace("T", " ")
}

function mono(text: string) {
  return <span className="font-mono text-xs">{text}</span>
}

function scheduleWords(rule: FlagRuleSummary): string {
  const start = rule.startAt ? formatUTC(rule.startAt) : undefined
  const end = rule.endAt ? formatUTC(rule.endAt) : undefined
  if (start && end) return `Between ${start} and ${end} UTC`
  if (start) return `From ${start} UTC`
  if (end) return `Until ${end} UTC`
  return "Schedule with no start or end, so it always matches"
}

/**
 * One rule said in words. The words are the whole of what the rule does: the
 * type's name is never all there is to read.
 *
 * `implemented` decides the Never matches badge, not the type name, so a type
 * the engine has never heard of gets it too. It stays a badge and a word: a
 * rule that cannot match is not an error, it is dead weight the operator
 * should see.
 */
export function RuleSummary({ rule }: { rule: FlagRuleSummary }) {
  const never = rule.implemented ? null : <NeverMatchesBadge />
  switch (rule.type) {
    case "when_tenant":
      return (
        <>
          <span>Tenant is one of</span>
          <TagList values={rule.tenantIds} label="tenants" />
        </>
      )
    case "when_user":
      return (
        <>
          <span>User is one of</span>
          <TagList values={rule.userIds} label="users" />
        </>
      )
    case "rollout":
      return (
        <span className="flex flex-col gap-0.5">
          <span>
            Rollout to <span className="tabular-nums">{rule.percentage}%</span>{" "}
            of tenants
          </span>
          <span className="text-xs text-muted-foreground">
            Tenants are bucketed by id, never by user.
          </span>
        </span>
      )
    case "schedule":
      return <span>{scheduleWords(rule)}</span>
    case "when_tenant_tag":
      return (
        <>
          <span>
            Tenant tag {mono(rule.tagKey ?? "")} = {mono(rule.tagValue ?? "")}
          </span>
          {never}
        </>
      )
    case "custom":
      return (
        <>
          <span>Custom evaluator {mono(rule.evaluator ?? "")}</span>
          {never}
        </>
      )
    default:
      return (
        <>
          <span>Unknown rule type {mono(rule.type)}</span>
          {never}
        </>
      )
  }
}
