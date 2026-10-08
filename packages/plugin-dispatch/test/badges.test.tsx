import { expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import {
  CronBadge,
  HeartbeatBadge,
  JobStateBadge,
  ReplayBadge,
  RunStateBadge,
} from "../src/badges"
it("keeps routine states quiet and distinguishes failure from heartbeat evidence", () => {
  render(
    <>
      <JobStateBadge state="completed" />
      <JobStateBadge state="failed" />
      <JobStateBadge state="pending" />
      <RunStateBadge state="running" />
      <CronBadge enabled />
      <ReplayBadge replayed={false} />
      <HeartbeatBadge status="unknown" />
      <HeartbeatBadge status="silent" />
    </>
  )
  expect(screen.getByText("completed").getAttribute("data-variant")).toBe(
    "outline"
  )
  expect(screen.getByText("failed").getAttribute("data-variant")).toBe(
    "destructive"
  )
  expect(screen.getByText("pending").getAttribute("data-variant")).toBe(
    "secondary"
  )
  expect(screen.getByText("running").getAttribute("data-variant")).toBe(
    "default"
  )
  expect(screen.getByText("Enabled").getAttribute("data-variant")).toBe(
    "outline"
  )
  expect(screen.getByText("Not replayed").getAttribute("data-variant")).toBe(
    "outline"
  )
  expect(
    screen.getByText("Heartbeat unknown").getAttribute("data-variant")
  ).toBe("outline")
  expect(screen.getByText("Silent").getAttribute("data-variant")).toBe(
    "destructive"
  )
})
