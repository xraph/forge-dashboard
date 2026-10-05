import { definePlugin } from "@forge-go/dashboard-plugin"
import { Settings2Icon } from "@forge-go/dashboard-kit/icons"
import { SetupPage } from "./pages/setup"

export { SetupPage }
export { CurrentBadge, RedTeamBadge, ScenarioBadge } from "./badges"
export {
  casePath,
  formatScore,
  plural,
  SCENARIO_TYPES,
  scenarioLabel,
  suitePath,
  temperatureLabel,
  versionPath,
} from "./format"
export type {
  BaselineRef,
  CasesList,
  ImportResult,
  PromptVersion,
  PromptVersionDetail,
  PromptVersionsList,
  RedTeamRef,
  Redaction,
  ScorerConfig,
  ScorerInfo,
  SentinelConfig,
  Suite,
  SuitesList,
  TargetInfo,
  TestCase,
  VersionRef,
} from "./types"


/**
 * The first-party UI for the `sentinel` extension. This first cut has the
 * engine's setup; suites, runs and baselines arrive with later pages.
 *
 * `extension` is "sentinel", the Go contributor name from the sentinel
 * contract manifest. It is the join key the host looks up in the capabilities
 * response, and `test/plugin.test.tsx` checks it by resolving against a
 * capabilities document rather than comparing the string to itself. A wrong
 * name resolves to `hidden` with nothing logged.
 */
export const sentinelPlugin = definePlugin({
  extension: "sentinel",
  namespace: "sentinel",
  label: "Sentinel",
  nav: [
    {
      label: "Setup",
      to: "/setup",
      priority: 10,
      icon: <Settings2Icon />,
      group: "Evaluation",
    },
  ],
  routes: [{ path: "/setup", element: SetupPage }],
})

export default sentinelPlugin
