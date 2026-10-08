import { IconButton } from "@forge-go/dashboard-kit/components/icon-button"
import { useState } from "react"
import type { CSSProperties } from "react"
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import type { DragEndEvent, DragOverEvent, UniqueIdentifier } from "@dnd-kit/core"
import { restrictToVerticalAxis } from "@dnd-kit/modifiers"
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { useCommand } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@forge-go/dashboard-kit/components/collapsible"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@forge-go/dashboard-kit/components/dropdown-menu"
import { CommandAlert } from "@forge-go/dashboard-kit/components/query-boundary"
import { cn } from "@forge-go/dashboard-kit/lib/utils"
import type { FlagRuleSummary, FlagType } from "../flag-types"
import {
  ADDABLE_RULE_TYPES,
  RULE_TYPE_LABELS,
  draftFromSaved,
  firstProblem,
  isChanged,
  newRule,
  payloadOfAll,
  problemWith,
  summaryOf,
} from "../rule-draft"
import type { AddableRuleType, DraftRule } from "../rule-draft"
import { useUnsavedGuard } from "../use-unsaved-guard"
import { FlagValue } from "./flag-value"
import { LadderRows } from "./ladder"
import { RuleForm } from "./rule-form"
import { RuleSummary } from "./rule-summary"

/** Mirrors the Go `flagsSetRulesResponse`. */
interface SetRulesResponse {
  rules: FlagRuleSummary[]
}

const LEAVE_MESSAGE =
  "You have unsaved changes to this flag's rules. Leave this page and lose them?"

function GripIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4 fill-current">
      <circle cx="5.5" cy="3.5" r="1.25" />
      <circle cx="10.5" cy="3.5" r="1.25" />
      <circle cx="5.5" cy="8" r="1.25" />
      <circle cx="10.5" cy="8" r="1.25" />
      <circle cx="5.5" cy="12.5" r="1.25" />
      <circle cx="10.5" cy="12.5" r="1.25" />
    </svg>
  )
}

interface RowProps {
  rule: DraftRule
  /** One-based, as the operator will see it once the drag ends. */
  number: number
  flagType: FlagType
  onChange: (uid: string, patch: Partial<DraftRule>) => void
  onRemove: (uid: string) => void
}

/**
 * One rule in the draft: a drag handle, its number, its words and value, and a
 * form that opens under them.
 *
 * The form stays mounted while closed. A value input keeps what is typed in
 * it (a half-written JSON document has no value to rebuild it from), so
 * closing the row must not empty it.
 */
function RuleRow({ rule, number, flagType, onChange, onRemove }: RowProps) {
  const [open, setOpen] = useState(rule.isNew)
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: rule.uid })
  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
  }
  const problem = problemWith(rule)

  return (
    <li
      ref={setNodeRef}
      style={style}
      data-rule-row={rule.uid}
      data-invalid={problem === undefined ? undefined : "true"}
      className={cn(
        "relative rounded-md border bg-background text-sm",
        isDragging && "z-10 shadow-md ring-1 ring-ring",
        problem !== undefined && "border-destructive/50",
      )}
    >
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="flex flex-wrap items-start gap-x-3 gap-y-1 px-3 py-2">
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            aria-label={`Drag to reorder rule ${number}`}
            className="-ml-1 mt-0.5 flex size-5 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden active:cursor-grabbing"
          >
            <GripIcon />
          </button>
          <span
            data-slot="row-lead"
            className="w-5 shrink-0 font-mono text-xs font-medium tabular-nums text-muted-foreground"
          >
            {number}
          </span>
          <div className="flex min-w-0 flex-1 basis-56 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <RuleSummary rule={summaryOf(rule)} />
            </div>
            {problem !== undefined ? (
              <p data-slot="rule-problem" className="text-xs text-destructive">
                {problem}
              </p>
            ) : null}
          </div>
          <div className="flex min-w-16 items-center justify-end gap-2 text-right">
            {rule.returnValue === undefined ? null : (
              <FlagValue value={rule.returnValue} type={flagType} />
            )}
          </div>
          <div className="flex items-center gap-1">
            <CollapsibleTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  aria-label={`${open ? "Close" : "Edit"} rule ${number}`}
                />
              }
            >
              {open ? "Done" : "Edit"}
            </CollapsibleTrigger>
            <IconButton type="button" variant="ghost" onClick={() => onRemove(rule.uid)} label={`Remove rule ${number}`} />
          </div>
        </div>
        <CollapsibleContent keepMounted className="border-t px-3 py-3">
          <RuleForm
            rule={rule}
            flagType={flagType}
            onChange={(patch) => onChange(rule.uid, patch)}
          />
        </CollapsibleContent>
      </Collapsible>
    </li>
  )
}

export interface RuleEditorProps {
  flagKey: string
  flagType: FlagType
  /** The rules as saved. The draft starts as a copy of them. */
  rules: FlagRuleSummary[]
  /** The draft was saved (true) or dropped (false). */
  onClose: (saved: boolean) => void
}

/**
 * Rung 3 as a draft of the whole rule list.
 *
 * Nothing here touches the server until Save rules, and then the whole list
 * goes in one `flags.setRules` in display order: the position is the priority.
 * Editing one rule's percentage does not send one rule. That is what makes
 * reordering, adding and removing the same operation as editing.
 *
 * A failed save leaves the draft exactly as it was, with the error above the
 * list, so the operator can fix it or retry without redoing anything.
 */
export function RuleEditor({ flagKey, flagType, rules, onClose }: RuleEditorProps) {
  const [draft, setDraft] = useState<DraftRule[]>(() => draftFromSaved(rules))
  const [confirmingDiscard, setConfirmingDiscard] = useState(false)
  // What the drag would do if it ended now, so the numbers move as the row does.
  const [preview, setPreview] = useState<{ from: number; to: number } | null>(null)
  const [announcement, setAnnouncement] = useState("")
  const setRules = useCommand<SetRulesResponse>("flags.setRules")

  const changed = isChanged(draft, rules)
  const problem = firstProblem(draft)
  const saving = setRules.loading
  useUnsavedGuard(changed, LEAVE_MESSAGE)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const ids = draft.map((r) => r.uid)
  const shownOrder = preview === null ? ids : arrayMove(ids, preview.from, preview.to)
  const numberOf = (id: UniqueIdentifier) => shownOrder.indexOf(String(id)) + 1

  function update(uid: string, patch: Partial<DraftRule>) {
    setDraft((current) => current.map((r) => (r.uid === uid ? { ...r, ...patch } : r)))
  }

  function remove(uid: string) {
    const at = draft.findIndex((r) => r.uid === uid)
    setDraft((current) => current.filter((r) => r.uid !== uid))
    setAnnouncement(`Removed rule ${at + 1}.`)
  }

  function add(type: AddableRuleType) {
    setDraft((current) => [...current, newRule(type)])
    setAnnouncement(`Added rule ${draft.length + 1}, ${RULE_TYPE_LABELS[type]}.`)
  }

  function dragOver({ active, over }: DragOverEvent) {
    if (over === null) return setPreview(null)
    const from = ids.indexOf(String(active.id))
    const to = ids.indexOf(String(over.id))
    setPreview(from < 0 || to < 0 ? null : { from, to })
  }

  function dragEnd({ active, over }: DragEndEvent) {
    setPreview(null)
    if (over === null || active.id === over.id) return
    const from = ids.indexOf(String(active.id))
    const to = ids.indexOf(String(over.id))
    if (from < 0 || to < 0) return
    setDraft((current) => arrayMove(current, from, to))
  }

  async function save() {
    // Enter and a double click both get here while a save is in flight.
    if (saving || problem !== undefined) return
    const result = await setRules.execute({ key: flagKey, rules: payloadOfAll(draft) })
    // undefined means the client threw. The draft stays for a retry.
    if (result === undefined) return
    onClose(true)
  }

  function discard() {
    if (changed) setConfirmingDiscard(true)
    else onClose(false)
  }

  return (
    <div className="flex flex-col gap-3">
      <CommandAlert error={setRules.error} title="Could not save the rules" />

      <DndContext
        id={`rules-${flagKey}`}
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis]}
        onDragOver={dragOver}
        onDragEnd={dragEnd}
        onDragCancel={() => setPreview(null)}
        accessibility={{
          screenReaderInstructions: {
            draggable:
              "To reorder a rule, press Space to pick it up, the up and down arrow keys to move it, and Space again to drop it. Escape cancels.",
          },
          announcements: {
            onDragStart: ({ active }) => `Picked up rule ${numberOf(active.id)}.`,
            onDragOver: ({ active, over }) =>
              over ? `Rule ${numberOf(active.id)} is now at position ${numberOf(over.id)}.` : undefined,
            onDragEnd: ({ active, over }) =>
              over
                ? `Rule ${numberOf(active.id)} was dropped at position ${numberOf(over.id)}.`
                : `Rule ${numberOf(active.id)} was dropped where it was.`,
            onDragCancel: ({ active }) =>
              `Reordering cancelled. Rule ${numberOf(active.id)} is back where it was.`,
          },
        }}
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {/* A fieldset, so every control in the draft is disabled at once
              while the save is in flight and nothing is edited under it. */}
          <fieldset disabled={saving} className="contents">
            {draft.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No rules. Whatever reaches this rung falls through to the default.
              </p>
            ) : (
              <LadderRows label="Rules">
                {draft.map((rule) => (
                  <RuleRow
                    key={rule.uid}
                    rule={rule}
                    number={numberOf(rule.uid)}
                    flagType={flagType}
                    onChange={update}
                    onRemove={remove}
                  />
                ))}
              </LadderRows>
            )}
          </fieldset>
        </SortableContext>
      </DndContext>

      <p role="status" className="sr-only">
        {announcement}
      </p>

      {problem !== undefined ? (
        <p id="rule-editor-problem" className="text-sm text-destructive">
          {problem}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button type="button" variant="outline" size="sm" disabled={saving} />}
          >
            Add rule
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            {ADDABLE_RULE_TYPES.map((type) => (
              <DropdownMenuItem key={type} onClick={() => add(type)}>
                {RULE_TYPE_LABELS[type]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="flex-1" />
        <IconButton type="button" variant="outline" disabled={saving} onClick={discard} label="Discard" />
        <Button
          type="button"
          size="sm"
          disabled={saving || problem !== undefined}
          aria-describedby={problem === undefined ? undefined : "rule-editor-problem"}
          onClick={() => void save()}
        >
          {saving ? "Saving…" : "Save rules"}
        </Button>
      </div>

      <ConfirmDialog
        open={confirmingDiscard}
        onOpenChange={setConfirmingDiscard}
        title="Discard your changes to the rules?"
        description="The rules go back to what is saved. What you changed here is lost."
        confirmLabel="Discard"
        onConfirm={() => {
          setConfirmingDiscard(false)
          onClose(false)
        }}
      />
    </div>
  )
}
