import { PluginLink } from "@forge-go/dashboard-plugin"
import { buttonVariants } from "@forge-go/dashboard-kit/components/button"
import { EmptyState } from "@forge-go/dashboard-kit/components/empty-state"

/**
 * Whether a read failed because the record does not exist in this app.
 *
 * Matched on the message as well as the code: a mistyped intent name is also
 * NOT_FOUND, and telling an operator "no such plan" about a typo in the page
 * would send them looking for a plan that is there. The contract words every
 * missing record as "<noun> not found", including one that belongs to another
 * app, which is deliberate and reads the same here.
 */
export function isNotFound(error: { code: string; message: string } | undefined, noun: string): boolean {
  return error?.code === "NOT_FOUND" && error.message === `${noun} not found`
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
