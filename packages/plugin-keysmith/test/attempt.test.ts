import { describe, expect, it } from "vitest"
import { ContractError } from "@forge-go/dashboard-plugin"
import { alreadyRan, claimFailed, lostAnswer, stillRunning } from "../src/attempt"
import { ALREADY_RAN_MESSAGE, STILL_RUNNING_MESSAGE } from "./harness"

const CLAIM_FAILED_MESSAGE = "could not claim the idempotency key"
// keysmith's own CONFLICT. It is about the key, not the idempotency key.
const CHANGED = "this key changed while you were acting on it. Reload and try again."

function withReason(code: string, message: string, reason: string): ContractError {
  return new ContractError(code, message, { reason })
}

describe("idempotency answers, by reason", () => {
  // The reason decides, whatever the wording says. forge is free to reword
  // the message once it names the reason.
  it("reads each reason whatever the message says", () => {
    const ran = withReason("CONFLICT", "reworded", "idempotency.already_ran")
    const running = withReason("CONFLICT", "reworded", "idempotency.still_running")
    const unclaimed = withReason("UNAVAILABLE", "reworded", "idempotency.claim_failed")

    expect([alreadyRan(ran), stillRunning(ran), claimFailed(ran)]).toEqual([true, false, false])
    expect([alreadyRan(running), stillRunning(running), claimFailed(running)]).toEqual([
      false,
      true,
      false,
    ])
    expect([alreadyRan(unclaimed), stillRunning(unclaimed), claimFailed(unclaimed)]).toEqual([
      false,
      false,
      true,
    ])
  })

  it("believes a reason over a message that says otherwise", () => {
    const err = withReason("CONFLICT", ALREADY_RAN_MESSAGE, "idempotency.still_running")
    expect(stillRunning(err)).toBe(true)
    expect(alreadyRan(err)).toBe(false)
  })

  it("matches none of them on a reason it does not know", () => {
    const err = withReason("CONFLICT", ALREADY_RAN_MESSAGE, "idempotency.something_new")
    expect([alreadyRan(err), stillRunning(err), claimFailed(err)]).toEqual([false, false, false])
  })

  it("does not count an idempotency reason as a lost answer", () => {
    for (const reason of [
      "idempotency.already_ran",
      "idempotency.still_running",
      "idempotency.claim_failed",
    ]) {
      expect(lostAnswer(withReason("CONFLICT", "reworded", reason))).toBe(false)
    }
  })
})

describe("idempotency answers, from forge v1.12.2 and earlier", () => {
  // No reason on the wire: the code and the start of the message decide.
  it("falls back to the code and the start of the message", () => {
    expect(alreadyRan(new ContractError("CONFLICT", ALREADY_RAN_MESSAGE))).toBe(true)
    expect(stillRunning(new ContractError("CONFLICT", STILL_RUNNING_MESSAGE))).toBe(true)
    expect(claimFailed(new ContractError("UNAVAILABLE", CLAIM_FAILED_MESSAGE))).toBe(true)
  })

  it("needs the code as well as the message", () => {
    expect(alreadyRan(new ContractError("INTERNAL", ALREADY_RAN_MESSAGE))).toBe(false)
    expect(stillRunning(new ContractError("UNAVAILABLE", STILL_RUNNING_MESSAGE))).toBe(false)
    expect(claimFailed(new ContractError("CONFLICT", CLAIM_FAILED_MESSAGE))).toBe(false)
  })

  it("leaves keysmith's own CONFLICT to show as it is", () => {
    const err = new ContractError("CONFLICT", CHANGED)
    expect([alreadyRan(err), stillRunning(err), claimFailed(err), lostAnswer(err)]).toEqual([
      false,
      false,
      false,
      false,
    ])
  })

  it("leaves details without a reason to the fallback", () => {
    const err = new ContractError("CONFLICT", ALREADY_RAN_MESSAGE, { field: "name" })
    expect(alreadyRan(err)).toBe(true)
  })

  it("answers false for no error at all", () => {
    expect([alreadyRan(undefined), stillRunning(undefined), claimFailed(undefined)]).toEqual([
      false,
      false,
      false,
    ])
  })
})
