import type { VerifyReport } from "../../src/types"

/** A report with every flag in its quiet state; each test overrides what it is about. */
export function report(over: Partial<VerifyReport> = {}): VerifyReport {
  return {
    valid: true,
    verified: 12431,
    firstEvent: 1,
    lastEvent: 12431,
    headSeq: 12431,
    partial: false,
    headMatch: true,
    headChecked: true,
    checkpointsChecked: true,
    checkpointHeadOk: true,
    checkpointHeadChecked: true,
    retentionPolicies: 0,
    coverage: [{ fromSeq: 1, toSeq: 12431, level: "keyed" }],
    ...over,
  }
}

/** The default deployment: plain digests, no checkpoint store. */
export const plainNoCheckpoints = report({
  coverage: [{ fromSeq: 1, toSeq: 12431, level: "unkeyed" }],
  checkpointsChecked: false,
  checkpointHeadChecked: false,
  checkpointHeadOk: false,
})

/** The spec's mixed chain: keyed from 48,201. */
export const mixed = report({
  verified: 61004,
  lastEvent: 61004,
  headSeq: 61004,
  coverage: [
    { fromSeq: 1, toSeq: 48200, level: "unkeyed" },
    { fromSeq: 48201, toSeq: 60000, level: "signed" },
    { fromSeq: 60001, toSeq: 61004, level: "keyed" },
  ],
})

/** The fixture's broken chain. */
export const broken = report({
  valid: false,
  verified: 4696,
  lastEvent: 5000,
  headSeq: 5000,
  gaps: [2311, 2312],
  tampered: [2780],
  downgrades: [2901],
  retained: [{ fromSeq: 101, toSeq: 400, recordSeq: 401, policyId: "retpol_globex_debug" }],
  retentionPolicies: 2,
  coverage: [{ fromSeq: 1, toSeq: 5000, level: "keyed" }],
})

/** The fixture's truncated chain. */
export const truncated = report({
  valid: false,
  verified: 3000,
  lastEvent: 3000,
  headSeq: 3000,
  headMatch: false,
  checkpointHeadOk: false,
  checkpoints: [
    { id: "ckpt_initech_1", fromSeq: 1, toSeq: 1500, signatureValid: true, hashMatch: true, hashChecked: true, continuityOk: true, continuityChecked: true },
    { id: "ckpt_initech_2", fromSeq: 1501, toSeq: 3400, signatureValid: true, hashMatch: false, hashChecked: false, continuityOk: true, continuityChecked: true, note: "The checkpoint ends past the chain's head, so its hash could not be compared." },
  ],
})
