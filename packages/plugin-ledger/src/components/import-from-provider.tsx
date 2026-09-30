import { useEffect, useId, useRef, useState } from "react"
import type { FormEvent } from "react"
import { useCommand, useNavigateTo, useQuery } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@forge-go/dashboard-kit/components/dialog"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { NativeSelect, NativeSelectOption } from "@forge-go/dashboard-kit/components/native-select"
import type { SettingsDetail } from "../types"
import { InlineAlert } from "./inline-alert"

interface ImportProps<T> {
  /** The command, such as "plans.importFromProvider". */
  intent: string
  /** The record in words: "plan", "feature", "subscription" or "invoice". */
  noun: string
  /** What an import does for this record, shown under the dialog title. */
  description: string
  /** The imported record's page, read from the command's answer. */
  pathOf: (result: T) => string
}

/**
 * The "from" half of provider sync: copy one record the payment provider holds
 * into this app, then open it. The "to" half is SyncPanel on each detail page.
 *
 * The button is always enabled. The dialog reads settings.detail only once it
 * opens, and with no provider registered it says so there instead of showing a
 * form. A disabled button cannot take focus, so its reason would be out of
 * reach for a keyboard or screen reader, and reading on open keeps the list
 * page at the reads it already makes.
 */
export function ImportFromProviderAction<T>(props: ImportProps<T>) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Import from provider
      </Button>
      {open && <ImportDialog {...props} onClose={() => setOpen(false)} />}
    </>
  )
}

function ImportDialog<T>({ intent, noun, description, pathOf, onClose }: ImportProps<T> & { onClose: () => void }) {
  const settings = useQuery<SettingsDetail>("settings.detail")
  const command = useCommand<T>(intent)
  const navigate = useNavigateTo()
  const fieldId = useId()
  const [chosen, setChosen] = useState("")
  const [providerId, setProviderId] = useState("")
  const errorRef = useRef<HTMLDivElement>(null)
  const providers = settings.data?.providers ?? []
  // One provider needs no choice. Several do: the engine's default is the one
  // registered first, and settings.detail lists them sorted, so this page
  // cannot tell which that is.
  const provider = providers.length === 1 ? providers[0] : chosen
  const id = providerId.trim()
  const canSubmit = !command.loading && provider !== "" && id !== ""

  // A failed submit moves focus to the refusal, so a keyboard or screen reader
  // user lands on it instead of hunting for it above the form.
  useEffect(() => {
    if (command.error) errorRef.current?.focus()
  }, [command.error])

  async function submit(event: FormEvent) {
    event.preventDefault()
    // Enter in a field submits even when the button is disabled.
    if (!canSubmit) return
    const result = await command.execute({ provider_name: provider, provider_id: id })
    // undefined means the command failed; the dialog stays open on its error.
    if (result === undefined) return
    navigate(pathOf(result))
  }

  return (
    <Dialog open onOpenChange={(next) => !next && !command.loading && onClose()}>
      <DialogContent>
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>
              Import {/^[aeiou]/i.test(noun) ? "an" : "a"} {noun} from the payment provider
            </DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {settings.error ? (
            <InlineAlert title="Could not read the payment providers" error={settings.error} />
          ) : settings.data === undefined ? (
            <p role="status" className="text-sm text-muted-foreground">
              Checking which payment providers are configured…
            </p>
          ) : providers.length === 0 ? (
            <p role="status" className="text-sm text-muted-foreground">
              No payment provider is configured, so there is nothing to import from. Once a payment provider is registered with the
              ledger extension, this dialog asks which record to import.
            </p>
          ) : (
            <>
              {command.error && (
                <div ref={errorRef} tabIndex={-1} className="outline-none">
                  <InlineAlert title={`Could not import the ${noun}`} error={command.error} />
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${fieldId}-provider`}>Provider</Label>
                <NativeSelect id={`${fieldId}-provider`} value={provider} onChange={(e) => setChosen(e.target.value)}>
                  {providers.length > 1 && <NativeSelectOption value="">Choose a provider</NativeSelectOption>}
                  {providers.map((p) => (
                    <NativeSelectOption key={p} value={p}>
                      {p}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${fieldId}-id`}>Provider ID</Label>
                <Input
                  id={`${fieldId}-id`}
                  aria-describedby={`${fieldId}-hint`}
                  className="font-mono"
                  autoComplete="off"
                  spellCheck={false}
                  value={providerId}
                  onChange={(e) => setProviderId(e.target.value)}
                />
                <p id={`${fieldId}-hint`} className="text-xs text-muted-foreground">
                  The {noun}'s ID at {provider || "the provider"}, as the provider shows it.
                </p>
              </div>
            </>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={command.loading} onClick={onClose}>
              Cancel
            </Button>
            {providers.length > 0 && (
              <Button type="submit" disabled={!canSubmit}>
                {command.loading ? "Importing…" : `Import ${noun}`}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
