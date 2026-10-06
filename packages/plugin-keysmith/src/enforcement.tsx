/*
 * The three groups a policy's fields fall into, by what enforces them, with
 * the words the policy editor, the policy page and the Settings page all use
 * for them. One copy, so the three cannot drift apart. The rate limiter
 * group's line depends on the deployment: see `rateLimiterLine` below.
 */

/** The groups in the order the editor lays them out, top to bottom. */
export const ENFORCEMENT_GROUPS = [
  { id: "keysmith", heading: "Enforced by Keysmith" },
  { id: "rateLimiter", heading: "Enforced only with a rate limiter" },
  { id: "application", heading: "Stored for your application" },
] as const

export type EnforcementGroupId = (typeof ENFORCEMENT_GROUPS)[number]["id"]

export const GROUP_HEADING: Record<EnforcementGroupId, string> = {
  keysmith: ENFORCEMENT_GROUPS[0].heading,
  rateLimiter: ENFORCEMENT_GROUPS[1].heading,
  application: ENFORCEMENT_GROUPS[2].heading,
}

export const KEYSMITH_GROUP_LINE =
  "Keysmith checks these: the lifetime when a key is created, scopes when they are assigned, and the grace when a key is rotated."

/** The application group's line. A node, for the mono type name in it. */
export function ApplicationGroupLine() {
  return (
    <>
      Keysmith does not check these. Your application can read them from{" "}
      <span className="font-mono text-foreground">ValidationResult.Policy</span>
      .
    </>
  )
}

/**
 * What the rate limiter group says about enforcement here. The editor, the
 * policy page and the Settings page show the same line above the same group.
 */
export function rateLimiterLine(configured: boolean | undefined): string {
  if (configured === undefined) {
    return "Whether this deployment enforces these is not known right now."
  }
  return configured
    ? "This deployment has a rate limiter, so Keysmith enforces these."
    : "This deployment has no rate limiter. These are stored, but not enforced here."
}
