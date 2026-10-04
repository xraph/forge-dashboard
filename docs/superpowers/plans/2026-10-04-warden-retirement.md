# Warden templ retirement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record everything the templ dashboard did in `warden/MIGRATION.md`, retitle authsome's roles page to "App roles", and delete `warden/dashboard/` in a commit of its own.

**Architecture:** Three tasks, in order. The inventory comes first because once the directory is gone, `MIGRATION.md` is the only record of what the old pages did. The retitle is two small edits in `plugin-authsome`. The deletion is gated: it runs only when the inventory has no item marked blocked, and only after a grep proves nothing outside the directory imports it.

**Tech Stack:** Go (warden, templ), React and TypeScript (plugin-authsome), vitest.

**Spec:** `docs/superpowers/specs/2026-09-23-warden-dashboard-migration-design.md`, sections "Retiring the templ dashboard", "Decisions taken" and "Two templ surfaces are not what they look like".

## Global Constraints

- Success, from the spec: "every capability Warden's domain packages offer is reachable from the React dashboard or is recorded in `warden/MIGRATION.md` as deliberately dropped or blocked, and `warden/dashboard/` no longer exists."
- Every item is marked migrated, deliberately dropped with a reason, or blocked. Two are recorded rather than migrated: the settings panel, which has no write path, and the two forms posting without a base path, recorded as a bug the migration fixes.
- "If a templ surface turns out to have no contract equivalent and no way to build one, it is not deleted and not quietly dropped. It is recorded and reported."
- The deletion is its own commit, separate from everything else.
- Truth rule: every sentence a page or document states must be true in every case it can appear in. Check claims against the code, never against comments.
- No em dash (U+2014) anywhere: not in prose, code comments, UI strings or commit messages. No `Co-Authored-By` or any attribution trailer.
- Shared trees. Commit by explicit path (`git commit -m "..." -- <paths>`). Never `git add -A`, `commit -a`, `--amend`, `stash`, `checkout --`, `restore`, `reset --hard` or `clean`. A file that already has someone else's uncommitted edits gets changed with the Edit tool only, and committed through a private index holding only your hunks (Task 2 shows the commands).
- `MIGRATION.md` and the authsome description ship under Rex's name: before finishing them, invoke the `rex-voice` skill and run the draft through `humanizer` in embedded mode. Address the reader as "you", use "we" for team work and never "I".
- Warden work goes on warden's current branch, `soc2-hardening`. forge-dashboard work goes on `main`.

## Review Focus

1. A templ capability marked "migrated" whose React page does not actually do it, such as a filter, a bulk action or an empty-state call to action. The reviewer checks every "migrated" row against the named React route and intent.
2. A templ page that the inventory never mentions, because it was reachable only from a link inside another page and not from nav (for example `role_permissions.templ` or `resource_type_detail.templ`). Task 1 Step 1 lists every `.templ` file, and Step 4 checks that each one appears.
3. Something outside `warden/` that imports `github.com/xraph/warden/dashboard`, such as an app under `/Users/rexraphael/Work/xraph` that wires the old contributor. Task 3 Step 1 greps every Go module there.
4. The authsome pointer sentence claiming a link or a place that does not exist on a deployment without Warden's dashboard. Task 2's copy names no link, and its test asserts there is no anchor.
5. `go.mod` drift after the deletion: `github.com/a-h/templ` may still be needed through forge's dashboard contract. Task 3 runs `go build ./...` and leaves `go.mod` alone unless the build fails.

---

### Task 1: Write `warden/MIGRATION.md`

**Files:**
- Create: `/Users/rexraphael/Work/xraph/forgery/warden/MIGRATION.md`
- Read (source of truth, do not modify): every file under `/Users/rexraphael/Work/xraph/forgery/warden/dashboard/` except the generated `*_templ.go` files
- Read (the React side): `/Users/rexraphael/Work/xraph/forge-dashboard/packages/plugin-warden/src/` and the Go contract `/Users/rexraphael/Work/xraph/forgery/warden/extension/contract/` (`manifest.yaml` lists every intent)

**Interfaces:**
- Produces: `MIGRATION.md`, and in the report the count of items per status and a list of every item marked blocked or "gap". Task 3 is gated on that list.

The templ source to cover, as `.templ` and hand-written `.go` files:

```
dashboard/contributor.go, data.go, manifest.go, plugin_iface.go, forge.contributor.yaml
dashboard/components/  confirm_dialog, dialog_helpers, empty_state, footer_links, page_header,
                       pagination_meta.go, path_rewriter, plugin_sections, stat_card
dashboard/pages/       overview, roles, role_detail, role_form, role_permissions, role_view.go,
                       permissions, permission_form, assignments, assignment_form,
                       relations, relation_form, resource_types, resource_type_detail,
                       resource_type_form, policies, policy_detail, policy_form,
                       check_logs, playground, helpers, form_helpers.go
dashboard/settings/    config
dashboard/widgets/     recent_checks, stats
```

The React routes that exist today (from `packages/plugin-warden/src/index.tsx`):

```
/  /roles  /roles/:id  /permissions  /permissions/:id  /assignments
/policies  /policies/:id  /policies/:id/edit
/relations  /relations/graph/:objectType/:objectId/:relation[/to/:subjectType/:subjectId][/in/:namespace]
/resource-types  /resource-types/:id  /check-log  /check-log/:id
/subjects/:kind/:id  /playground  /playground/check/:checkId  /schema  /config
```

- [ ] **Step 1: List the source.** Run `cd /Users/rexraphael/Work/xraph/forgery/warden && find dashboard -type f ! -name '*_templ.go' ! -name '.DS_Store' | sort`. Every file it prints is a section or a row in the document.

- [ ] **Step 2: Inventory each page from its `.templ` source.** For each page record: its templ path and URL, every column, every action (button, row action, bulk action), every filter and search, every badge or status mark, every empty state and its text, and every form field with its validation. Record the playground in the most detail: the inputs, what a result shows, and how it explains a decision, because the templ version is the only description anywhere of what that reasoning looks like on screen. Record nav entries from `manifest.go`, the widgets, and the settings panel.

- [ ] **Step 3: Mark every item.** Each item gets exactly one status:
  - **migrated**: name the React route and the contract intent that now does it. Open the React page source and confirm it really does it before writing this.
  - **dropped**: give the reason. A reason is a fact about warden, not a preference.
  - **blocked**: say what would be needed, and why the contract cannot provide it today.
  - **gap**: the contract could do it but the React dashboard does not yet. Do not fix gaps in this task; list them in the report.

  Two rows are fixed by the spec. The settings panel (`settings/config.templ`, fields marked `Disabled` at about line 84) is recorded as a config display with no write path; `/config` shows the same values read-only. The forms in `pages/policy_form.templ` (about line 303) and `pages/resource_type_form.templ` (about line 44) fetch `/v1/policies` and `/v1/resource-types` with no base path, so they only worked when the API was mounted at root. Record that as a bug the migration fixes, not as a feature.

  Shared infrastructure (`components/`, `path_rewriter`, `pagination_meta.go`, `plugin_iface.go`, `contributor.go`, `forge.contributor.yaml`) is recorded under its own heading as replaced by the shell and the contract, one line each saying by what.

- [ ] **Step 4: Check coverage.** Every file from Step 1 must appear in `MIGRATION.md`. Run:

```bash
cd /Users/rexraphael/Work/xraph/forgery/warden && for f in $(find dashboard -type f ! -name '*_templ.go' ! -name '.DS_Store'); do grep -q "$f" MIGRATION.md || echo "MISSING $f"; done
```

Expected: no output.

- [ ] **Step 5: Check prose.** Run `grep -n $'\xe2\x80\x94' MIGRATION.md`. Expected: no output.

- [ ] **Step 6: Commit.**

```bash
cd /Users/rexraphael/Work/xraph/forgery/warden && git commit -m "docs: record what the templ dashboard did and where each piece went" -- MIGRATION.md
```

(`git commit -- <path>` needs the file tracked first: run `git add MIGRATION.md` immediately before it, naming only that file.)

Document shape: a short opening paragraph saying what the file is and that `warden/dashboard/` is deleted; a status key; one `##` section per page in nav order, then widgets, settings, nav, shared infrastructure, and a final "Gaps and blocked items" section (which may say "None."). Use tables for columns, actions and filters, with a Status column and a Where-now column.

---

### Task 2: Retitle authsome's roles page to "App roles"

**Files:**
- Modify: `/Users/rexraphael/Work/xraph/forge-dashboard/packages/plugin-authsome/src/index.tsx` (the nav entry `label: "Roles"`, `to: "/roles"`, near line 269)
- Modify: `/Users/rexraphael/Work/xraph/forge-dashboard/packages/plugin-authsome/src/pages/roles.tsx` (the `PageHeader` near line 142)
- Test: `/Users/rexraphael/Work/xraph/forge-dashboard/packages/plugin-authsome/test/roles.test.tsx` and `test/plugin.test.tsx`

**Interfaces:** none consumed or produced.

Both source files already carry another session's uncommitted edits. Change them with the Edit tool only, and commit only your hunks (Step 5).

The pointer copy is fixed. Authsome's roles always live in Warden: `authsome/service.go` `rbacStore()` returns `rbac.NewWardenStore(e.wardenEng)` and panics without a Warden engine. The copy names Warden's page but does not link to it. When the warden extension is not installed, the shell mounts no `/@warden` routes (`packages/host/src/host/PluginHost.tsx` mounts routes only for resolved plugins and has no catch-all), so a link would open an empty page.

- [ ] **Step 1: Write the failing tests.** In `test/roles.test.tsx`, add a test that renders the roles page through the file's existing harness and asserts:

```tsx
expect(screen.getByRole("heading", { level: 1, name: "App roles" })).toBeInTheDocument()
expect(
  screen.getByText(
    "Authsome keeps these roles in Warden, scoped to this app. Where Warden's dashboard is installed, its Roles page edits the same roles with every field, including namespace, inherited roles, the system and default flags, and member limits."
  )
).toBeInTheDocument()
expect(screen.queryByRole("link", { name: /warden/i })).toBeNull()
```

In `test/plugin.test.tsx`, add an assertion that the nav item whose `to` is `"/roles"` has `label` `"App roles"` (follow how that file already reads `nav`).

- [ ] **Step 2: Run them and watch them fail.** Run `cd /Users/rexraphael/Work/xraph/forge-dashboard && pnpm --filter "$(node -p "require('./packages/plugin-authsome/package.json').name")" test -- roles plugin`. Expected: the new assertions fail on "Roles" versus "App roles".

- [ ] **Step 3: Implement.** In `src/index.tsx`, change only the nav entry's `label: "Roles"` to `label: "App roles"`. In `src/pages/roles.tsx`, change the `PageHeader` to:

```tsx
<PageHeader
  title="App roles"
  description="Authsome keeps these roles in Warden, scoped to this app. Where Warden's dashboard is installed, its Roles page edits the same roles with every field, including namespace, inherited roles, the system and default flags, and member limits."
  actions={!creating && <Button onClick={() => setCreating(true)}>New role</Button>}
/>
```

Before writing it, confirm each named field exists on `warden.Role` (`/Users/rexraphael/Work/xraph/forgery/warden/role/role.go`: namespace, parent slug, `IsSystem`, `IsDefault`, `MaxMembers`) and that authsome's page shows none of them. If either check fails, stop and report rather than changing the copy.

- [ ] **Step 4: Run the package's tests, typecheck and lint.** Use the package's own `test`, `typecheck` and `lint` scripts. Expected: all pass. Fix any existing test that asserted the old "Roles" title or label.

- [ ] **Step 5: Commit only your hunks.** For each of the four paths, build the version to commit as HEAD's version plus only your change. Copy `git show HEAD:<path>` into the scratch directory, make the same edit there (the label, the header, or the added tests), and hash it with `git hash-object -w <scratch file>`. A path whose `git status --short` was clean before you started can be hashed straight from the working tree. Then, in ONE command so `GIT_INDEX_FILE` stays exported throughout:

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard && export GIT_INDEX_FILE=$(mktemp -u) && OLD=$(git rev-parse HEAD) && git read-tree $OLD \
  && git update-index --cacheinfo 100644,<blob1>,packages/plugin-authsome/src/index.tsx \
  && git update-index --cacheinfo 100644,<blob2>,packages/plugin-authsome/src/pages/roles.tsx \
  && git update-index --cacheinfo 100644,<blob3>,packages/plugin-authsome/test/roles.test.tsx \
  && git update-index --cacheinfo 100644,<blob4>,packages/plugin-authsome/test/plugin.test.tsx \
  && TREE=$(git write-tree) && NEW=$(git commit-tree $TREE -p $OLD -m "feat(plugin-authsome): call the roles page App roles and point at Warden's") \
  && git show --stat $NEW && git diff $OLD $NEW | grep -c '^[-+][^-+]' \
  && git update-ref refs/heads/main $NEW $OLD; unset GIT_INDEX_FILE
```

Read the `git show --stat` output: it must list only those four paths, and the diff must hold only your hunks. Then copy the four entries into the shared index with `git update-index --cacheinfo 100644,<blob>,<path>` so `git status` stops showing your hunks as staged-but-different. The working-tree files keep the other session's edits plus yours.

---

### Task 3: Delete `warden/dashboard/`

**Files:**
- Delete: `/Users/rexraphael/Work/xraph/forgery/warden/dashboard/` (72 tracked files)
- Modify: `/Users/rexraphael/Work/xraph/forgery/warden/extension/contract/errors.go:71` (the comment that names `warden/dashboard/contributor.go`)

**Interfaces:**
- Consumes: Task 1's report. If it lists any item marked **blocked**, do not run this task; report back. The controller rules on any **gap** before this task starts.

- [ ] **Step 1: Prove nothing imports it.** Run:

```bash
cd /Users/rexraphael/Work/xraph && grep -rln --include='*.go' 'xraph/warden/dashboard' . 2>/dev/null | grep -v '/warden/dashboard/'
```

Expected: only `forgery/warden/extension/contract/errors.go` (a comment). Any other hit is an importer: stop and report it with its path.

- [ ] **Step 2: Reword the comment.** In `errors.go`, replace "A scope helper ported from warden/dashboard/contributor.go compiles" with "A scope helper ported from the deleted templ dashboard's contributor (see MIGRATION.md) compiles". Keep the rest of the comment as it is.

- [ ] **Step 3: Delete the tracked files.** Run `cd /Users/rexraphael/Work/xraph/forgery/warden && git rm -r -q dashboard`. An untracked `dashboard/.DS_Store` stays on disk. Leave it, since it is not a tracked file.

- [ ] **Step 4: Build and test.** Run `cd /Users/rexraphael/Work/xraph/forgery/warden && go build ./... && go vet ./... && go test ./...`. Expected: PASS. If linking fails for lack of disk, report it and do not clear any cache. Do not run `go mod tidy`. If the build reports `github.com/a-h/templ` as unused, report that rather than editing `go.mod`, since forge's dashboard contract may still pull it.

- [ ] **Step 5: Commit the deletion alone.** The `git rm` staged the deletions. Commit them with nothing else:

```bash
cd /Users/rexraphael/Work/xraph/forgery/warden && git commit -m "chore: delete the templ dashboard" -- dashboard
```

Check `git show --stat HEAD` lists only `dashboard/` paths.

- [ ] **Step 6: Commit the comment.**

```bash
cd /Users/rexraphael/Work/xraph/forgery/warden && git commit -m "docs(contract): point the scope warning at MIGRATION.md" -- extension/contract/errors.go
```
