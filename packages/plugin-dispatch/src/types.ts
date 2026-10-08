export type JobState =
  "pending" | "running" | "completed" | "failed" | "retrying" | "cancelled"
export type RunState = "running" | "completed" | "failed"
export interface Duration {
  text: string
  ms: number
}
export interface Page<T> {
  items: T[]
  nextCursor: string | null
  complete: boolean
  asOf: string
}
export interface Snapshot {
  asOf: string
}
