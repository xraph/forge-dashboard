import type { ForgeSubPlugin } from "@forge-go/dashboard-plugin"
import { organizationSubPlugin } from "./organization"
import { apikeySubPlugin } from "./apikey"
import { waitlistSubPlugin } from "./waitlist"
import { consentSubPlugin } from "./consent"
import { subscriptionSubPlugin } from "./subscription"
import { passwordSubPlugin } from "./password"
import { settingsOnlySubPlugins } from "./settings-only"

export {
  organizationSubPlugin,
  apikeySubPlugin,
  waitlistSubPlugin,
  consentSubPlugin,
  subscriptionSubPlugin,
  passwordSubPlugin,
  settingsOnlySubPlugins,
}

/**
 * Every first-party authsome sub-plugin.
 *
 * Order does not decide anything. Nav sorts by group then priority, slot
 * contributions sort by priority then id, and routes are keyed by path. This
 * array is just the set, and it is ordered by hand for readability rather than
 * by any rule a reader has to learn.
 */
export const authsomeSubPlugins: ForgeSubPlugin[] = [
  organizationSubPlugin,
  apikeySubPlugin,
  waitlistSubPlugin,
  consentSubPlugin,
  subscriptionSubPlugin,
  passwordSubPlugin,
  ...settingsOnlySubPlugins,
]
