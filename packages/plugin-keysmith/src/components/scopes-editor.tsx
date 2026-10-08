import { IconButton } from "@forge-go/dashboard-kit/components/icon-button"
import { useCallback, useId, useRef, useState } from "react"
import { useCommand, useQuery } from "@forge-go/dashboard-plugin"
import type { ContractError } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Label } from "@forge-go/dashboard-kit/components/label"
import {
  NativeSelect,
  NativeSelectOption,
} from "@forge-go/dashboard-kit/components/native-select"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { TagList } from "@forge-go/dashboard-kit/components/tag-list"
import type { KeyOnly, KeySummary, PoliciesList, ScopesList } from "../types"

// The same reads as the create dialog's pickers, so the two share a cache entry.
const PICKER_LIMIT = 200
const PICKER_PARAMS = { limit: PICKER_LIMIT }

export interface ScopeEditing {
  /** Sends keys.scopes.assign with one name. Resolves true when the server took it. */
  add: (name: string) => Promise<boolean>
  /** Sends keys.scopes.remove with one name. */
  remove: (name: string) => void
  /** A change is out. Every control waits for it. */
  busy: boolean
  /** Why the last change was refused. */
  error?: ContractError
}

/**
 * The two scope commands, for the page to hold ABOVE its QueryBoundary.
 *
 * The editor itself sits inside the boundary, in the Scopes section, so it
 * unmounts whenever keys.detail refetches. A failed change does not refetch,
 * but the key's other actions do: a Reactivate that lands just after a remove
 * was refused would take the refusal with it before anyone read it. Held up
 * here, the refusal stays until the next change starts.
 */
export function useScopeEditing(keyId: string): ScopeEditing {
  const assign = useCommand<KeyOnly>("keys.scopes.assign")
  const unassign = useCommand<KeyOnly>("keys.scopes.remove")
  const { execute: sendAssign, reset: resetAssign } = assign
  const { execute: sendRemove, reset: resetRemove } = unassign
  // Set synchronously, so a second click in the same tick cannot slip past a
  // button that has not re-rendered as disabled yet. One ref for both: one
  // change at a time, so a refusal always belongs to the change just made.
  const sending = useRef(false)

  const add = useCallback(
    async (name: string) => {
      if (sending.current) return false
      sending.current = true
      // Only one refusal is ever on screen: the one for this change.
      resetRemove()
      try {
        return (await sendAssign({ id: keyId, scopes: [name] })) !== undefined
      } finally {
        sending.current = false
      }
    },
    [keyId, sendAssign, resetRemove]
  )

  const remove = useCallback(
    (name: string) => {
      if (sending.current) return
      sending.current = true
      resetAssign()
      void sendRemove({ id: keyId, scopes: [name] }).finally(() => {
        sending.current = false
      })
    },
    [keyId, sendRemove, resetAssign]
  )

  return {
    add,
    remove,
    busy: assign.loading || unassign.loading,
    error: assign.error ?? unassign.error,
  }
}

export interface ScopesEditorProps {
  summary: KeySummary
  editing: ScopeEditing
}

/**
 * The key's scopes, each removable, and a picker to add one. A revoked key
 * shows its scopes read-only: the server refuses to change them.
 */
export function ScopesEditor({ summary, editing }: ScopesEditorProps) {
  if (summary.effectiveState === "revoked") {
    return (
      <div className="flex flex-col gap-2">
        <TagList values={summary.scopes ?? []} label="scopes" />
        <p className="text-sm text-muted-foreground">
          A revoked key&apos;s scopes cannot be changed.
        </p>
      </div>
    )
  }
  return <EditableScopes summary={summary} editing={editing} />
}

function EditableScopes({ summary, editing }: ScopesEditorProps) {
  const pickerId = useId()
  const scopes = useQuery<ScopesList>("scopes.list", PICKER_PARAMS)
  const policies = useQuery<PoliciesList>("policies.list", PICKER_PARAMS)
  const [choice, setChoice] = useState("")

  const held = summary.scopes ?? []
  const hasPolicy = summary.policyId !== undefined
  // Until the policies are in, a key with a policy may still be narrowed, so
  // nothing is added from a list that could shrink under the operator.
  const policySettling = hasPolicy && !policies.data && !policies.error
  const policyFailed =
    hasPolicy && policies.error !== undefined && !policies.data
  // A policy that is not in the first page, or a list that failed, leaves the
  // choice wide, and the server refuses a scope the policy does not allow.
  const allowed =
    policies.data?.policies?.find((p) => p.id === summary.policyId)
      ?.allowedScopes ?? []
  const narrowed = hasPolicy && allowed.length > 0
  const tenantScopes = scopes.data?.scopes ?? []
  const available = tenantScopes
    .map((s) => s.name)
    .filter((n) => !held.includes(n) && (!narrowed || allowed.includes(n)))

  async function add() {
    if (choice === "") return
    if (await editing.add(choice)) setChoice("")
  }

  return (
    <div className="flex flex-col gap-3">
      {held.length === 0 ? (
        <NoneCell label="scopes" />
      ) : (
        <ul className="flex flex-wrap gap-1">
          {held.map((name) => (
            <li
              key={name}
              className="inline-flex items-center gap-0.5 rounded-4xl border py-0.5 pr-0.5 pl-2"
            >
              <span className="font-mono text-xs">{name}</span>
              <IconButton
                variant="ghost"
                disabled={editing.busy}
                onClick={() => editing.remove(name)}
                label={`Remove ${name}`}
              />
            </li>
          ))}
        </ul>
      )}

      {scopes.error ? (
        <p className="text-sm text-muted-foreground">
          Scopes could not be loaded, so none can be added right now.
        </p>
      ) : scopes.data && tenantScopes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No scopes exist in this tenant yet.
        </p>
      ) : scopes.data && available.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {narrowed
            ? "This key already holds every scope its policy allows."
            : "This key already holds every scope there is to add."}
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={pickerId}>Add scope</Label>
          <div className="flex items-center gap-2">
            <NativeSelect
              id={pickerId}
              value={choice}
              disabled={!scopes.data || policySettling || editing.busy}
              onChange={(e) => setChoice(e.target.value)}
            >
              <NativeSelectOption value="">
                {!scopes.data
                  ? "Loading scopes…"
                  : policySettling
                    ? "Loading the key's policy…"
                    : "Choose a scope"}
              </NativeSelectOption>
              {available.map((name) => (
                <NativeSelectOption key={name} value={name}>
                  {name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <Button
              variant="outline"
              size="sm"
              disabled={choice === "" || policySettling || editing.busy}
              onClick={() => void add()}
            >
              Add
            </Button>
          </div>
        </div>
      )}
      {policyFailed && !scopes.error && (
        <p className="text-sm text-muted-foreground">
          The key&apos;s policy could not be loaded, so this list is not
          narrowed to it. The server refuses a scope the policy does not allow.
        </p>
      )}
      {narrowed && !scopes.error && (
        <p className="text-sm text-muted-foreground">
          Only the scopes this key&apos;s policy allows are listed.
        </p>
      )}
      {scopes.data?.hasMore && (
        <p className="text-sm text-muted-foreground">
          {`Only the first ${PICKER_LIMIT} scopes are listed.`}
        </p>
      )}

      {editing.error && (
        <p role="alert" className="text-sm text-destructive">
          {editing.error.message}
        </p>
      )}
    </div>
  )
}
