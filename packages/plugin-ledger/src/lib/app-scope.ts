import { useQuery } from "@forge-go/dashboard-plugin"
import type { SettingsDetail } from "../types"

/**
 * Whether a feature's write controls show: "show", "hide", or "wait" while the
 * answer is on its way. Only a shared catalog feature is ever hidden.
 *
 * A shared feature (empty app_id) is readable from every app but writable only
 * with no app selected. The contract answers PERMISSION_DENIED to any other
 * write, so the page does not offer a button that promises that refusal.
 *
 * The page learns the scope from settings.detail, the same read the settings
 * page makes, and reads it only when the feature is shared. settings.detail
 * reports the app the extension is configured with. That is a one-way signal:
 * a configured app means an app is selected, but an empty one can also be an
 * app chosen by the dashboard's app switcher, which the read does not show. So
 * this hides the controls when settings names an app, or when the deployment
 * requires an app claim: then every request it accepts has an app, and a shared
 * feature is never writable there. While the answer is on its
 * way the caller shows neither the controls nor a note, so nothing flashes up
 * and vanishes. When settings cannot be read, or names no app, the controls
 * stay and the server decides.
 */
export function useSharedWrites(shared: boolean): "show" | "hide" | "wait" {
  const settings = useQuery<SettingsDetail>("settings.detail", undefined, { enabled: shared })
  if (!shared) return "show"
  if (settings.data !== undefined) return settings.data.app_id !== "" || settings.data.require_app_claim ? "hide" : "show"
  return settings.error === undefined ? "wait" : "show"
}
