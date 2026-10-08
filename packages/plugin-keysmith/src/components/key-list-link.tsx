import { PluginLink } from "@forge-go/dashboard-plugin"

/**
 * "key list", as a link, for the notes the create and rotate dialogs show
 * when a command's answer was lost or cannot be shown again.
 *
 * Following it closes the dialog as well. The create dialog sits on the key
 * list itself, so the navigation alone would leave the dialog over the very
 * list the note sends you to.
 */
export function KeyListLink({ onFollow }: { onFollow: () => void }) {
  return (
    <span onClick={onFollow}>
      <PluginLink to="/keys" className="underline underline-offset-4">
        key list
      </PluginLink>
    </span>
  )
}
