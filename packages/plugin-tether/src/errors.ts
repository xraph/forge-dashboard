/** The part of a ContractError the kit's error blocks read. */
export interface ExplainedError {
  code: string
  message: string
}

/**
 * Adds to a refusal what an operator needs to act on it.
 *
 * Every Tether intent answers UNAUTHENTICATED ("authentication required")
 * unless the dashboard user is signed in, and a dashboard with auth off, the
 * default, sends nobody. The bare message reads like a bug. The code stays as
 * it came, so a report still names what the server said.
 *
 * UNAVAILABLE is the broker not running, or Tether not started yet. It is
 * retryable, and the retry button the boundary draws is the right answer, so
 * this only names what is down.
 */
export function explainError(error: ExplainedError): ExplainedError
export function explainError(
  error: ExplainedError | undefined
): ExplainedError | undefined
export function explainError(
  error: ExplainedError | undefined
): ExplainedError | undefined {
  if (!error) return error
  switch (error.code) {
    case "UNAUTHENTICATED":
      return {
        code: error.code,
        message: `${error.message}. Sign in to the dashboard, or turn on dashboard auth, to use Tether.`,
      }
    case "UNAVAILABLE":
      return {
        code: error.code,
        message: `${error.message}. Tether's broker is not running on this node, or Tether has not started yet.`,
      }
    default:
      return error
  }
}
