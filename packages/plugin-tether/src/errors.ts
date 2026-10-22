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
 *
 * PERMISSION_DENIED covers several refusals under one code: a tenant that is
 * disabled, a tenant outside the caller's own (a dashboard user who is not an
 * operator reaches only the tenant their session names), a session that names
 * no Tether tenant at all, and tenant management by someone who is not an
 * operator. The server's own words say which, so they stay first and the
 * sentence added names the ones a person can act on.
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
    case "PERMISSION_DENIED":
      return {
        code: error.code,
        message: `${error.message}. The tenant may be disabled, or you may not be authorized to use it: unless Tether makes you an operator, you reach only the tenant your session belongs to.`,
      }
    default:
      return error
  }
}
