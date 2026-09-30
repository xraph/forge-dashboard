import { PluginLink } from "@forge-go/dashboard-plugin"
import { buttonVariants } from "@forge-go/dashboard-kit/components/button"
import { EmptyState } from "@forge-go/dashboard-kit/components/empty-state"

/**
 * Whether a read failed because the record does not exist in this app.
 *
 * Matched on the message as well as the code: a mistyped intent name is also
 * NOT_FOUND, and telling an operator "no such plan" about a typo in the page
 * would send them looking for a plan that is there. Two spellings reach here.
 * The contract's own `notFound()` words another app's record "<noun> not
 * found". A truly missing id comes from the engine's sentinel errors, passed
 * through as err.Error(): "ledger: coupon not found", possibly wrapped
 * ("...: ledger: coupon not found"), or the generic "ledger: not found". Both
 * read the same to an operator. Another noun's message ("provider not found")
 * never matches. A malformed id also reads as no such record: see below.
 */
export function isNotFound(error: { code: string; message: string } | undefined, noun: string): boolean {
  if (error === undefined) return false
  const m = error.message
  // A truncated id, or one with another entity's prefix ("/plans/sub_..."), never
  // reaches a lookup: the contract's parseID refuses it as BAD_REQUEST, "id is not
  // a valid id: <id>". No record can have that id, and Retry would only repeat it.
  if (error.code === "BAD_REQUEST") return m.startsWith("id is not a valid id")
  if (error.code !== "NOT_FOUND") return false
  return m === `${noun} not found` || m.endsWith(`: ${noun} not found`) || m === "ledger: not found"
}

export function NotFoundState({ noun, id, backTo, backLabel }: { noun: string; id: string; backTo: string; backLabel: string }) {
  return (
    <EmptyState
      title={`No ${noun} with the id ${id}.`}
      description="It may have been deleted, or it belongs to a different app."
      action={
        <PluginLink to={backTo} className={buttonVariants({ variant: "outline" })}>
          {backLabel}
        </PluginLink>
      }
    />
  )
}
