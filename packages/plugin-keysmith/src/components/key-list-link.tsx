import type { MouseEvent } from "react"
import { PluginLink } from "@forge-go/dashboard-plugin"

/**
 * "key list", as a link, for the notes the create and rotate dialogs show
 * when a command's answer was lost or cannot be shown again.
 *
 * A plain click on it closes the dialog as well. The create dialog sits on
 * the key list itself, so the navigation alone would leave the dialog over
 * the very list the note sends you to.
 */
export function KeyListLink({ onFollow }: { onFollow: () => void }) {
  return (
    <span onClick={(event) => followsHere(event) && onFollow()}>
      <PluginLink to="/keys" className="underline underline-offset-4">
        key list
      </PluginLink>
    </span>
  )
}

/**
 * A plain left click, which the router takes in this tab. A modifier or another
 * button opens the list elsewhere, and the dialog should still be here.
 */
function followsHere(event: MouseEvent): boolean {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  )
}
