import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, screen } from "@testing-library/react"
import type { ComponentType } from "react"
import type { PluginPageProps, ScopedClient } from "@forge-go/dashboard-plugin"
import { layoutViolations } from "@forge-go/dashboard-kit/lib/layout-check"
import { BaselineDetailPage } from "../src/pages/baseline-detail"
import { BaselinesPage } from "../src/pages/baselines"
import { CaseDetailPage } from "../src/pages/case-detail"
import ComparePage from "../src/pages/compare"
import { OverviewPage } from "../src/pages/overview"
import PromptVersionPage from "../src/pages/prompt-version"
import { ResultDetailPage } from "../src/pages/result-detail"
import { RunDetailPage } from "../src/pages/run-detail"
import { RunsPage } from "../src/pages/runs"
import { SetupPage } from "../src/pages/setup"
import { SuiteDetailPage } from "../src/pages/suite-detail"
import { SuitesPage } from "../src/pages/suites"
import {
  baseline,
  baselineDetail,
  BASELINE_ID,
  CASE_ID,
  comparison,
  config,
  leakageCase,
  OTHER_RUN_ID,
  overview,
  redTeamReport,
  regressed,
  resultDetail,
  resultRow,
  RESULT_ID,
  run,
  RUN_ID,
  runDetail,
  runningRun,
  suite,
  SUITE_ID,
  testCase,
  trend,
  version,
  VERSION_2,
  versionDetail,
} from "./fixtures"
import { renderNavPage, stubClient } from "./harness"

afterEach(cleanup)

/** Renders a page the way the host does, waits for `ready`, then checks it. */
async function follows(
  Page: ComponentType<PluginPageProps>,
  client: ScopedClient,
  params: PluginPageProps["params"],
  ready: () => Promise<unknown>,
  regions: string[] = []
) {
  const { container } = renderNavPage(Page, client, params)
  await ready()
  expect(layoutViolations(container)).toEqual([])
  for (const name of regions) {
    expect(screen.getByRole("region", { name })).toBeTruthy()
  }
}

const suiteAnswers = {
  "suites.detail": suite(),
  "cases.list": { items: [testCase(), leakageCase()] },
  "prompts.list": { items: [version()] },
  "config.get": config(),
  "runs.list": { items: [run()], hasMore: false },
  "runs.trend": trend(),
  "baselines.list": { items: [baseline()] },
  "redteam.report": redTeamReport(),
}

describe("sentinel pages follow the shared layout", () => {
  it("Overview follows the shared layout", async () => {
    await follows(
      OverviewPage,
      stubClient({
        "overview.stats": overview({ activeRuns: [runningRun()] }),
      }),
      {},
      async () => {
        await screen.findByText("27")
        await screen.findByRole("link", { name: "Every run" })
      },
      ["Running now", "Recent regressions", "Recent runs"]
    )
  })

  it("Suites follows the shared layout", async () => {
    await follows(
      SuitesPage,
      stubClient({ "suites.list": { items: [suite()] } }),
      {},
      () => screen.findByRole("link", { name: "Support assistant" }),
      ["Suite list"]
    )
  })

  it("Suite detail, cases tab, follows the shared layout", async () => {
    await follows(
      SuiteDetailPage,
      stubClient(suiteAnswers),
      { id: SUITE_ID },
      async () => {
        await screen.findByRole("heading", {
          level: 1,
          name: "Support assistant",
        })
        await screen.findByRole("link", { name: "Reset password" })
      },
      ["Details", "Case list"]
    )
  })

  it("Suite detail, runs tab, follows the shared layout", async () => {
    await follows(
      SuiteDetailPage,
      stubClient(suiteAnswers),
      { id: SUITE_ID, tab: "runs" },
      async () => {
        await screen.findByRole("heading", { name: "Pass rate over runs" })
        await screen.findByRole("link", { name: RUN_ID })
      },
      ["Details", "Pass rate over runs", "Run list"]
    )
  })

  it("Suite detail, runs tab, follows the layout with the trend as a table", async () => {
    const { container } = renderNavPage(
      SuiteDetailPage,
      stubClient(suiteAnswers),
      { id: SUITE_ID, tab: "runs" }
    )
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Show pass rate over runs as a table",
      })
    )
    await screen.findAllByRole("columnheader", { name: "Cost reported" })
    expect(layoutViolations(container)).toEqual([])
  })

  it("Suite detail, prompts tab, follows the shared layout", async () => {
    await follows(
      SuiteDetailPage,
      stubClient(suiteAnswers),
      { id: SUITE_ID, tab: "prompts" },
      () => screen.findAllByRole("link", { name: "Version 2" }),
      ["Prompt version list"]
    )
  })

  it("Suite detail, baselines tab, follows the shared layout", async () => {
    await follows(
      SuiteDetailPage,
      stubClient(suiteAnswers),
      { id: SUITE_ID, tab: "baselines" },
      () => screen.findAllByRole("link", { name: "Release 1.4" }),
      ["Baseline list"]
    )
  })

  it("Suite detail, red team tab, follows the shared layout", async () => {
    await follows(
      SuiteDetailPage,
      stubClient(suiteAnswers),
      { id: SUITE_ID, tab: "redteam" },
      async () => {
        await screen.findByRole("heading", { name: "Newest completed run" })
        await screen.findByRole("link", { name: "leakage_direct_request" })
      },
      ["Newest completed run", "Red-team case list"]
    )
  })

  it("Case detail follows the shared layout", async () => {
    await follows(
      CaseDetailPage,
      stubClient({
        "cases.detail": testCase({
          context: { persona: "Nimbus" },
          metadata: { source: "import" },
        }),
        "suites.detail": suite(),
        "config.get": config(),
      }),
      { id: SUITE_ID, caseId: CASE_ID },
      async () => {
        await screen.findByRole("heading", {
          level: 1,
          name: "Reset password",
        })
        await screen.findByRole("heading", { name: "Metadata" })
      },
      ["Details", "Input", "Expected output", "Its own scorers", "Context"]
    )
  })

  it("Runs follows the shared layout", async () => {
    await follows(
      RunsPage,
      stubClient({
        "runs.list": { items: [runningRun(), run()], hasMore: true },
        "suites.list": { items: [suite()] },
      }),
      {},
      async () => {
        await screen.findByRole("region", { name: "Runs 1 to 2, newest first" })
        // The kit draws the pager strip for this label.
        await screen.findByRole("navigation", { name: "Pagination" })
      },
      ["Run list"]
    )
  })

  it("Baselines follows the shared layout", async () => {
    await follows(
      BaselinesPage,
      stubClient({ "baselines.list": { items: [baseline()] } }),
      {},
      () => screen.findByRole("link", { name: "Release 1.4" }),
      ["Baseline list"]
    )
  })

  it("Baseline detail follows the shared layout", async () => {
    await follows(
      BaselineDetailPage,
      stubClient({ "baselines.detail": baselineDetail() }),
      { id: BASELINE_ID },
      async () => {
        await screen.findByRole("heading", { level: 1, name: "Release 1.4" })
        await screen.findByRole("link", { name: "Reset password" })
      },
      ["Details", "Dimension scores", "Saved results"]
    )
  })

  it("Prompt version follows the shared layout", async () => {
    await follows(
      PromptVersionPage,
      stubClient({
        "prompts.detail": versionDetail(),
        "suites.detail": suite(),
      }),
      { id: SUITE_ID, versionId: VERSION_2 },
      async () => {
        await screen.findByRole("heading", { level: 1, name: "Version 2" })
        await screen.findByRole("region", {
          name: "Version 1 against version 2",
        })
      },
      ["Details", "Prompt", "Changes from version 1"]
    )
  })

  it("Run detail follows the shared layout", async () => {
    await follows(
      RunDetailPage,
      stubClient({
        "runs.detail": runDetail(),
        "runs.results": {
          items: [resultRow()],
          counts: { pass: 3, fail: 1, error: 0 },
        },
        "baselines.detail": baselineDetail(),
        "redteam.report": redTeamReport(),
      }),
      { id: RUN_ID },
      async () => {
        await screen.findByRole("heading", { level: 1, name: /^Run / })
        await screen.findByRole("heading", { name: "Results" })
        await screen.findByRole("heading", { name: "Red team" })
        await screen.findByRole("heading", { name: "Change from baseline" })
        await screen.findAllByRole("link", { name: "Reset password" })
      },
      ["Results", "Red team", "Change from baseline", "Dimension scores"]
    )
  })

  it("Run detail follows the layout while the baseline scores load", async () => {
    await follows(
      RunDetailPage,
      stubClient({
        "runs.detail": runDetail({ regression: regressed() }),
        "runs.results": {
          items: [resultRow()],
          counts: { pass: 3, fail: 1, error: 0 },
        },
        "redteam.report": redTeamReport({ total: 0 }),
      }),
      { id: RUN_ID },
      async () => {
        await screen.findByRole("heading", { level: 1, name: /^Run / })
        await screen.findByRole("link", { name: "Reset password" })
        await screen.findByText("The scores could not be read.", {
          exact: false,
        })
      },
      ["Results", "Change from baseline"]
    )
  })

  it("Result detail follows the shared layout", async () => {
    await follows(
      ResultDetailPage,
      stubClient({
        "results.detail": resultDetail({
          error: "The target timed out.",
          runTrace: {
            steps: [{ index: 0, type: "llm", output: "Hello", tokensUsed: 12 }],
            toolCalls: [
              {
                toolName: "lookup",
                arguments: "{}",
                result: "ok",
              },
            ],
          },
        }),
        "runs.detail": runDetail(),
        "cases.detail": testCase(),
      }),
      { id: RUN_ID, resultId: RESULT_ID },
      async () => {
        await screen.findByRole("heading", {
          level: 1,
          name: "Reset password",
        })
        await screen.findByRole("heading", { name: "Trace" })
        await screen.findByText("lookup")
      },
      ["Details", "Why it could not be judged", "Input", "Output", "Trace"]
    )
  })

  it("Compare follows the shared layout", async () => {
    await follows(
      ComparePage,
      stubClient({ "runs.compare": comparison() }),
      { id: OTHER_RUN_ID, otherId: RUN_ID },
      async () => {
        await screen.findByRole("heading", { name: "Scores, A to B" })
        await screen.findByText("Refund window")
      },
      ["Runs", "Scores, A to B", "Cases"]
    )
  })

  it("Setup follows the shared layout", async () => {
    await follows(
      SetupPage,
      stubClient({ "config.get": config() }),
      {},
      () => screen.findByText("4 scorers"),
      ["Engine configuration", "Targets", "Scorers"]
    )
  })
})
