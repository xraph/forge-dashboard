import { useId, useState } from "react"
import type { FormEvent } from "react"
import { useCommand, useQuery } from "@forge-go/dashboard-plugin"
import type { CommandState } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@forge-go/dashboard-kit/components/dialog"
import { Field, FieldGroup } from "@forge-go/dashboard-kit/components/field"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import {
  NativeSelect,
  NativeSelectOption,
} from "@forge-go/dashboard-kit/components/native-select"
import { joinFilters, slugProblem } from "../topics"
import type { Ack, Role, TopicRules } from "../types"
import { TetherBoundary, TetherCommandAlert } from "./boundary"
import { TopicFields, readTopics } from "./topic-fields"

interface RoleDialogProps {
  tenantId: string
  onClose: () => void
}

// ------------------------------------------------------------------- create

/**
 * Creates a role. The body mounts when the dialog opens and goes with it, so
 * every open is a blank form on a fresh command.
 */
export function CreateRoleDialog({
  open,
  roles,
  ...rest
}: RoleDialogProps & { open: boolean; roles: Role[] }) {
  if (!open) return null
  return <CreateBody roles={roles} {...rest} />
}

function CreateBody({
  tenantId,
  roles,
  onClose,
}: RoleDialogProps & { roles: Role[] }) {
  const create = useCommand<Role>("roles.create")
  const base = useId()
  const id = (name: string) => `${base}-${name}`
  const [slug, setSlug] = useState("")
  const [name, setName] = useState("")
  const [parent, setParent] = useState("")
  const [publish, setPublish] = useState("")
  const [subscribe, setSubscribe] = useState("")
  const [problem, setProblem] = useState<string | null>(null)
  const topics = readTopics(publish, subscribe)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (create.loading || !topics.valid) return
    const trimmed = slug.trim()
    const bad = slugProblem(trimmed)
    if (bad) return setProblem(bad)
    setProblem(null)
    const result = await create.execute({
      tenantId,
      slug: trimmed,
      ...(name.trim() !== "" && { name: name.trim() }),
      ...(parent !== "" && { parentSlug: parent }),
      publish: topics.publish.filters,
      subscribe: topics.subscribe.filters,
    })
    // A failed create keeps the form: a reused slug is fixed by editing it.
    if (result !== undefined) onClose()
  }

  return (
    <Dialog
      open
      onOpenChange={(open, details) => {
        if (open) return
        if (create.loading) details.cancel()
        else onClose()
      }}
      disablePointerDismissal={create.loading}
    >
      <DialogContent showCloseButton={!create.loading} className="sm:max-w-lg">
        <form onSubmit={(e) => void submit(e)} className="contents" noValidate>
          <DialogHeader>
            <DialogTitle>Create role</DialogTitle>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <Label htmlFor={id("slug")}>Slug</Label>
              <Input
                id={id("slug")}
                value={slug}
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
                onChange={(e) => setSlug(e.target.value)}
              />
            </Field>
            <Field>
              <Label htmlFor={id("name")}>Name</Label>
              <Input
                id={id("name")}
                value={name}
                autoComplete="off"
                placeholder="Defaults to the slug"
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field>
              <Label htmlFor={id("parent")}>Parent</Label>
              <NativeSelect
                id={id("parent")}
                value={parent}
                onChange={(e) => setParent(e.target.value)}
              >
                <NativeSelectOption value="">No parent</NativeSelectOption>
                {roles.map((r) => (
                  <NativeSelectOption key={r.slug} value={r.slug}>
                    {r.slug}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <TopicFields
              publish={publish}
              subscribe={subscribe}
              onPublish={setPublish}
              onSubscribe={setSubscribe}
            />
          </FieldGroup>

          {problem ? (
            <p role="alert" className="text-sm text-destructive">
              {problem}
            </p>
          ) : (
            <TetherCommandAlert
              error={create.error}
              title="Could not create the role"
            />
          )}

          <DialogFooter>
            <DialogClose
              render={<Button type="button" variant="outline" />}
              disabled={create.loading}
            >
              Cancel
            </DialogClose>
            <Button type="submit" disabled={create.loading || !topics.valid}>
              Create role
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ------------------------------------------------------------------- topics

/**
 * Edits one role's publish and subscribe filters. The rules are read fresh with
 * `roles.topics.get` when the dialog opens, not taken from the list, so what is
 * edited is what the server holds now.
 */
export function TopicsDialog({
  role,
  ...rest
}: RoleDialogProps & { role: Role | null }) {
  if (role === null) return null
  return <TopicsBody key={role.slug} role={role} {...rest} />
}

function TopicsBody({
  tenantId,
  role,
  onClose,
}: RoleDialogProps & { role: Role }) {
  const rules = useQuery<TopicRules>("roles.topics.get", {
    tenantId,
    roleSlug: role.slug,
  })
  const set = useCommand<TopicRules>("roles.topics.set")

  return (
    <Dialog
      open
      onOpenChange={(open, details) => {
        if (open) return
        if (set.loading) details.cancel()
        else onClose()
      }}
      disablePointerDismissal={set.loading}
    >
      <DialogContent showCloseButton={!set.loading} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{`Topic permissions of ${role.slug}`}</DialogTitle>
        </DialogHeader>
        <TetherBoundary
          title="Topic permissions"
          query={rules}
          skeletonRows={3}
        >
          {(data) => (
            <TopicsForm
              tenantId={tenantId}
              rules={data}
              command={set}
              onClose={onClose}
            />
          )}
        </TetherBoundary>
      </DialogContent>
    </Dialog>
  )
}

function TopicsForm({
  tenantId,
  rules,
  command,
  onClose,
}: RoleDialogProps & {
  rules: TopicRules
  command: CommandState<TopicRules>
}) {
  const [publish, setPublish] = useState(joinFilters(rules.publish ?? []))
  const [subscribe, setSubscribe] = useState(joinFilters(rules.subscribe ?? []))
  const topics = readTopics(publish, subscribe)

  async function submit(event: FormEvent) {
    event.preventDefault()
    // The button is disabled for these too; Enter in a field gets here.
    if (command.loading || !topics.valid) return
    const result = await command.execute({
      tenantId,
      roleSlug: rules.roleSlug,
      // Both lists, always: an absent one is BAD_REQUEST, and [] clears.
      publish: topics.publish.filters,
      subscribe: topics.subscribe.filters,
    })
    if (result !== undefined) onClose()
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="contents" noValidate>
      <FieldGroup>
        <TopicFields
          publish={publish}
          subscribe={subscribe}
          onPublish={setPublish}
          onSubscribe={setSubscribe}
        />
      </FieldGroup>
      <TetherCommandAlert
        error={command.error}
        title="Could not save the topic permissions"
      />
      <DialogFooter>
        <DialogClose
          render={<Button type="button" variant="outline" />}
          disabled={command.loading}
        >
          Cancel
        </DialogClose>
        <Button type="submit" disabled={command.loading || !topics.valid}>
          Save topics
        </Button>
      </DialogFooter>
    </form>
  )
}

// ------------------------------------------------------------------- delete

export function DeleteRoleDialog({
  role,
  ...rest
}: RoleDialogProps & { role: Role | null }) {
  if (role === null) return null
  return <DeleteBody key={role.slug} role={role} {...rest} />
}

function DeleteBody({
  tenantId,
  role,
  onClose,
}: RoleDialogProps & { role: Role }) {
  const remove = useCommand<Ack>("roles.delete")

  async function confirm() {
    const result = await remove.execute({ tenantId, roleSlug: role.slug })
    // Close on success only. A role a device holds, or another role names as
    // its parent, is CONFLICT and stays in front of the person, in here.
    if (result !== undefined) onClose()
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={`Delete role “${role.slug}”?`}
      description="Removes the role and its topic permissions. A role that a device holds, or that another role inherits from, cannot be deleted."
      confirmLabel="Delete"
      pending={remove.loading}
      onConfirm={() => void confirm()}
    >
      <TetherCommandAlert
        error={remove.error}
        title="Could not delete the role"
      />
    </ConfirmDialog>
  )
}
