import { definePlugin } from "@forge-go/dashboard-plugin"
import { FlaskConicalIcon, Settings2Icon } from "@forge-go/dashboard-kit/icons"
import { CaseDetailPage } from "./pages/case-detail"
import { SetupPage } from "./pages/setup"
import { SuiteDetailPage } from "./pages/suite-detail"
import { SuitesPage } from "./pages/suites"

export { CaseDetailPage, SetupPage, SuiteDetailPage, SuitesPage }
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
 * The first-party UI for the `sentinel` extension: evaluation suites, their
 * cases and prompt versions, and the engine's setup.
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
      label: "Suites",
      to: "/suites",
      priority: 0,
      icon: <FlaskConicalIcon />,
      group: "Evaluation",
    },
    {
      label: "Setup",
      to: "/setup",
      priority: 10,
      icon: <Settings2Icon />,
      group: "Evaluation",
    },
  ],
  routes: [
    { path: "/suites", element: SuitesPage },
    // No nav entries for the next two: a sidebar link to "a suite" with none
    // chosen points nowhere. They are reached from row links.
    { path: "/suites/:id", element: SuiteDetailPage },
    { path: "/suites/:id/cases/:caseId", element: CaseDetailPage },
    { path: "/setup", element: SetupPage },
  ],
})

export default sentinelPlugin
