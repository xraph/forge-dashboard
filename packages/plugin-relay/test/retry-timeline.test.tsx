import { describe, expect, it } from "vitest"
import { render, screen, within } from "@testing-library/react"
import { RetryTimeline, type Attempt } from "../src/components/retry-timeline"
import { formatDuration } from "../src/lib/format"

const T0 = Date.parse("2026-09-29T10:00:00Z")

function attempt(
  n: number,
  offsetMs: number,
  over: Partial<Attempt> = {}
): Attempt {
  return {
    id: `att_${n}`,
    attemptNum: n,
    statusCode: 503,
    latencyMs: 180,
    outcome: "retry",
    attemptedAt: new Date(T0 + offsetMs).toISOString(),
    ...over,
  }
}

function renderTimeline(
  attempts: Attempt[],
  state = "failed",
  extra: { endpointEnabled?: boolean } = {}
) {
  render(
    <RetryTimeline
      attempts={attempts}
      state={state}
      maxAttempts={5}
      nextAttemptAt={new Date(T0 + 3_600_000).toISOString()}
      {...extra}
    />
  )
  return screen.getByRole("list", { name: "Retry sequence" })
}

describe("formatDuration", () => {
  it("drops precision as the number grows", () => {
    expect(formatDuration(850)).toBe("850 ms")
    expect(formatDuration(5_000)).toBe("5s")
    expect(formatDuration(90_000)).toBe("1m 30s")
    expect(formatDuration(900_000)).toBe("15m")
    expect(formatDuration(3_600_000)).toBe("1h")
    expect(formatDuration(3_900_000)).toBe("1h 5m")
    expect(formatDuration(-1)).toBe("–")
  })
})

describe("RetryTimeline", () => {
  it("shows every attempt oldest first, with the wait between each pair on the line between them", () => {
    const list = renderTimeline(
      [
        attempt(1, 0),
        attempt(2, 5_000),
        attempt(3, 35_000, { statusCode: 200, outcome: "delivered" }),
      ],
      "delivered"
    )
    const items = within(list).getAllByRole("listitem")
    expect(items).toHaveLength(3)
    expect(items[0].textContent).toContain("Attempt 1")
    expect(items[0].textContent).not.toContain("waited")
    expect(items[1].textContent).toContain("waited 5s")
    expect(items[2].textContent).toContain("waited 30s")
    expect(items[2].textContent).toContain("Delivered on attempt 3.")
  })

  it("says it gave up after the last attempt when retries ran out", () => {
    const list = renderTimeline(
      [1, 2, 3, 4]
        .map((n) => attempt(n, n * 1000))
        .concat(attempt(5, 9000, { statusCode: 500, outcome: "dlq" }))
    )
    expect(list.textContent).toContain(
      "Gave up after 5 attempts. Sent to the dead letter queue."
    )
  })

  // Three endings, three different fixes. A 4xx is the receiver refusing
  // the payload, and retrying would not change its mind.
  it("tells a client error apart from running out of retries", () => {
    const list = renderTimeline([
      attempt(1, 0, { statusCode: 422, outcome: "dlq" }),
    ])
    expect(list.textContent).toContain("Client error 422, not retried.")
    expect(list.textContent).not.toContain("Gave up")
  })

  it("names a 410 as the receiver going away, and says if the endpoint is back", () => {
    const gone = renderTimeline([
      attempt(1, 0, { statusCode: 410, outcome: "endpoint_disabled" }),
    ])
    expect(gone.textContent).toContain(
      "The receiver answered 410 Gone, so Relay disabled the endpoint."
    )
    expect(gone.textContent).not.toContain("enabled again")
  })

  it("adds that a disabled endpoint has been enabled again since", () => {
    const back = renderTimeline(
      [attempt(1, 0, { statusCode: 410, outcome: "endpoint_disabled" })],
      "failed",
      {
        endpointEnabled: true,
      }
    )
    expect(back.textContent).toContain("It has been enabled again since.")
  })

  it("shows a response of 0 as no response, with the error that explains it", () => {
    const list = renderTimeline(
      [
        attempt(1, 0, {
          statusCode: 0,
          error: "i/o timeout",
          latencyMs: 10_000,
        }),
      ],
      "pending"
    )
    const item = within(list).getAllByRole("listitem")[0]
    expect(item.textContent).toContain("No response")
    expect(item.textContent).toContain("i/o timeout")
    expect(item.textContent).toContain("10s")
  })

  it("ends a delivery still retrying with the attempt that is due", () => {
    const list = renderTimeline([attempt(1, 0), attempt(2, 5000)], "pending")
    const items = within(list).getAllByRole("listitem")
    expect(items).toHaveLength(3)
    expect(items[2].textContent).toContain("Attempt 3 of 5 is due")
  })

  it("says a queued delivery has not been attempted", () => {
    const list = renderTimeline([], "pending")
    expect(list.textContent).toContain("Not attempted yet.")
  })

  it("keeps a response body folded until asked for", () => {
    renderTimeline([
      attempt(1, 0, {
        response: '{"error":"database is locked"}',
        outcome: "dlq",
        statusCode: 500,
      }),
    ])
    const summary = screen.getByText("Response body")
    const details = summary.closest("details")
    expect(details?.open).toBe(false)
    expect(
      within(details as HTMLElement).getByLabelText("response to attempt 1")
        .textContent
    ).toContain('"error": "database is locked"')
  })
})
