import { lazy } from "react"
import { definePlugin } from "@forge-go/dashboard-plugin"
import {
  BookmarkIcon,
  FlaskConicalIcon,
  HouseIcon,
  PlayIcon,
  Settings2Icon,
} from "@forge-go/dashboard-kit/icons"
import { BaselineDetailPage } from "./pages/baseline-detail"
import { BaselinesPage } from "./pages/baselines"
import { CaseDetailPage } from "./pages/case-detail"
import { OverviewPage } from "./pages/overview"
import { ResultDetailPage } from "./pages/result-detail"
import { RunDetailPage } from "./pages/run-detail"
import { RunsPage } from "./pages/runs"
import { SetupPage } from "./pages/setup"
import { SuiteDetailPage } from "./pages/suite-detail"
import { SuitesPage } from "./pages/suites"

export {
  BaselineDetailPage,
  BaselinesPage,
  CaseDetailPage,
  OverviewPage,
  ResultDetailPage,
  RunDetailPage,
  RunsPage,
  SetupPage,
  SuiteDetailPage,
  SuitesPage,
}
export {
  CurrentBadge,
  RedTeamBadge,
  ResultStatusBadge,
  RunStateBadge,
  ScenarioBadge,
  VerdictBadge,
  verdictLabel,
} from "./badges"
export {
  baselinePath,
  casePath,
  formatDelta,
  formatScore,
  plural,
  resultPath,
  runPath,
  SCENARIO_TYPES,
  scenarioLabel,
  suitePath,
  suiteTabPath,
  temperatureLabel,
  versionPath,
} from "./format"
export type {
  Baseline,
  BaselineDetail,
  BaselineRef,
  BaselineResult,
  BaselinesList,
  CasesList,
  ImportResult,
  Overview,
  PromptVersion,
  PromptVersionDetail,
  PromptVersionsList,
  RedTeamRef,
  Redaction,
  Regression,
  RegressionSummary,
  ResultDetail,
  ResultRow,
  ResultStatus,
  Run,
  RunDetail,
  RunResults,
  RunSettings,
  RunState,
  RunsList,
  ScorerConfig,
  ScorerInfo,
  ScorerResult,
  SentinelConfig,
  Suite,
  SuitesList,
  TargetInfo,
  TestCase,
  VersionRef,
} from "./types"

/**
 * The prompt version page carries the diff view, and the diff carries
 * CodeMirror, so the page is its own chunk and reaches the diff through a
 * second lazy import. The shell's entry chunk holds none of it. `PluginHost`
 * wraps every page in `Suspense`, so a lazy route is legal.
 */
const PromptVersionPage = lazy(() => import("./pages/prompt-version"))
/** The comparison opens output diffs, so it is a lazy route for the same reason. */
const ComparePage = lazy(() => import("./pages/compare"))

/**
 * The first-party UI for the `sentinel` extension: evaluation suites, their
 * cases and prompt versions, runs and their results, baselines, the overview
 * and the engine's setup.
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
    // Overview is first, so the scope lands on it.
    {
      label: "Overview",
      to: "/",
      priority: -10,
      icon: <HouseIcon />,
      group: "Evaluation",
    },
    {
      label: "Suites",
      to: "/suites",
      priority: 0,
      icon: <FlaskConicalIcon />,
      group: "Evaluation",
    },
    {
      label: "Runs",
      to: "/runs",
      priority: 1,
      icon: <PlayIcon />,
      group: "Evaluation",
    },
    {
      label: "Baselines",
      to: "/baselines",
      priority: 2,
      icon: <BookmarkIcon />,
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
    { path: "/", element: OverviewPage },
    { path: "/suites", element: SuitesPage },
    // No nav entries for the detail pages: a sidebar link to "a suite" with
    // none chosen points nowhere. They are reached from row links.
    { path: "/suites/:id", element: SuiteDetailPage },
    // The tab in the address: runs, prompts, baselines or redteam.
    { path: "/suites/:id/:tab", element: SuiteDetailPage },
    { path: "/suites/:id/cases/:caseId", element: CaseDetailPage },
    { path: "/suites/:id/prompts/:versionId", element: PromptVersionPage },
    { path: "/runs", element: RunsPage },
    { path: "/runs/:id", element: RunDetailPage },
    { path: "/runs/:id/results/:resultId", element: ResultDetailPage },
    { path: "/runs/:id/compare/:otherId", element: ComparePage },
    { path: "/baselines", element: BaselinesPage },
    { path: "/baselines/:id", element: BaselineDetailPage },
    { path: "/setup", element: SetupPage },
  ],
})

export default sentinelPlugin
