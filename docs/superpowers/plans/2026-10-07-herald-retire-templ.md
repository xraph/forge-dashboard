# Herald: retire the templ dashboard (plan 2c) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record in `herald/MIGRATION.md` everything the templ dashboard did and where it went, delete `herald/dashboard/` in a commit of its own, then move Herald to forge v1.12.0 so `templ` and `forgeui` leave its module graph entirely.

**Architecture:** The extension already stopped registering the templ dashboard (herald 29c6271 removed `DashboardContributor`), and nothing outside `dashboard/` imports the package (checked 2026-10-07 across all of forgery). What remains is the package: 27 `.templ` files with their 27 generated `*_templ.go`, plus `bridge.go`, `contributor.go`, `contributor_test.go`, `data.go` and `manifest.go`. Task 1 writes the inventory from those sources while they exist. Task 2 deletes them with the Makefile's templ targets and tidies. Task 3 bumps forge and corrects the CHANGELOG. A probe on a scratch copy (2026-10-07) already showed the end state works: with `dashboard/` gone and forge at v1.12.0, `go mod tidy` removes `a-h/templ`, `forgeui`, `tailwind-merge-go` and `nhooyr.io/websocket`, and build, test and fresh-cache lint (0 issues) pass.

**Tech Stack:** Go (herald), Markdown.

**Spec:** `docs/superpowers/specs/2026-09-30-herald-dashboard-design.md`, section "Retiring the templ dashboard" (and the page sections it points back to: Messages for Retry, `engine.info` for the settings panel). Ledgers: `herald-2b1-ledger.md`, `herald-2b1-carried-rulings.md` and `herald-2b2-ledger.md` in this session's scratchpad; plan 2a's ledger was deleted after its clean review, so for 2a and the hardening work use `CHANGELOG.md` v1.7.0 and `git log` in herald. The spec says the inventory was kept in session notes (`herald-findings.md`); that file no longer exists, so Task 1 rebuilds the inventory from the templ sources, which are still intact.

## Global Constraints

- Herald repo `/Users/rexraphael/Work/xraph/forgery/herald` on `main`, no worktrees. Its working tree was clean on 2026-10-07; if `git status --short` shows files you didn't touch, leave them alone and don't commit them.
- Git: `git add <exact files>` or `git rm -r <exact path>`, then `git commit --only -m "..." -- <exact paths>`, then `git show --stat HEAD`. Never `git add -A`, `git add .`, `git add -- .`, `git add -N`, a directory with `git add`, `--amend`, `git checkout -- .`, `git restore .`, `git reset --hard`, `git stash`, `git clean`, a path-less `git reset`, or `git push`.
- Prose (MIGRATION.md, CHANGELOG, commit messages): invoke the `rex-voice` skill before drafting, then run the draft through `humanizer` in embedded mode. "We" for the team, never "I", "you" for the reader, varied sentence length, practical before rationale, no bolded lead-in fragments. No em or en dashes anywhere: `grep -n '—\|–' <file>` prints nothing. No Co-Authored-By trailer, no Claude or Anthropic attribution.
- The deletion commit (Task 2) contains only `dashboard/`, the Makefile's templ targets and the `go.mod`/`go.sum` tidy.
- Go lint uses a fresh cache: `C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C`.
- localhost 5432 and 6379 are Rex's live databases. Nothing in this plan needs a database; don't start or touch one.
- forge-dashboard is not modified by Tasks 1 to 3.

## Review Focus

1. A templ feature that silently disappears: every page, column, badge, filter, empty state, action, widget, bridge function, the settings panel and each manifest entry appears in MIGRATION.md as migrated (with the React path and contract intent), changed (with what changed), dropped (with why) or blocked. Pinned in Task 1 Step 4 by a script that lists every route, action, bridge function, widget and settings ID and every `.templ` file, and fails on any that MIGRATION.md doesn't name.
2. MIGRATION.md names a contract intent that doesn't exist, which sends a reader looking for something that isn't there. Pinned in Task 1 Step 5 by checking every backticked `area.verb` name against `extension/contract/manifest.yaml`.
3. `make all` still runs `templ generate ./dashboard/...` after the directory is gone, so the repo's own default target fails. Pinned in Task 2 Step 4 (`grep -n templ Makefile` prints nothing and `make -n all` runs).
4. The forge bump breaks one of the eleven driver modules, which `replace` the root module and so see its new requirements. Pinned in Task 3 Step 3 by building and testing every module under `drivers/`.
5. Someone upgrading imports `github.com/xraph/herald/dashboard`, calls `RegisterBridge`, or relied on `DashboardContributor`, and finds no word about where it went. Pinned in Task 1's "What you need to do" section, which names all three.

---

### Task 1: Write `MIGRATION.md`

**Files:**
- Create: `MIGRATION.md` (herald root)

**Interfaces:**
- Consumes: the templ sources in `dashboard/`; `extension/contract/manifest.yaml` (intent names); forge-dashboard `packages/plugin-herald/src/index.tsx` and `src/keys.ts` (React routes); `CHANGELOG.md` v1.7.0; the three scratchpad ledgers.
- Produces: `MIGRATION.md`, which Task 3's CHANGELOG entry links to.

Follow Vault's shape (`/Users/rexraphael/Work/xraph/forgery/vault/MIGRATION.md`; read its first 110 lines and one page section before drafting). Sections, in this order:

1. **Opening paragraph.** Herald's dashboard used to render server-side with templ and ForgeUI from `herald/dashboard/`. It now lives in the Forge dashboard's React shell as `@forge-go/dashboard-plugin-herald`, reading the `herald` contract contributor in `extension/contract`. Say how the inventory was built: by walking all 27 `.templ` files (13 pages and a helpers file, 8 components, 4 widgets, 1 settings panel) plus `bridge.go`, `contributor.go`, `data.go` and `manifest.go` before deleting them.
2. **What you need to do.**
   - The extension no longer registers a templ `DashboardContributor` (29c6271). It registers the contract contributor; the shell finds it.
   - Code importing `github.com/xraph/herald/dashboard`, or calling `dashboard.RegisterBridge`, has to drop that import: the package is gone, and the ForgeUI bridge functions (`herald.getOverview` and the rest) went with it. Their replacements are contract intents, listed per page below.
   - Add the plugin to the shell (`import heraldPlugin from "@forge-go/dashboard-plugin-herald"` and the `plugins` array), and an `@source` line for `packages/plugin-herald/src` in the shell's stylesheet.
   - Which app the dashboard shows: the session's `app_id` claim, else `dashboard_app_id` in the extension config, else the `""` app; a present but unusable claim is refused (CHANGELOG v1.7.0 "Dashboard contract"). The templ dashboard only ever showed the `""` app.
   - Herald needs forge v1.12.0 (Task 3), the first release whose dashboard packages pull in neither templ nor forgeui.
   - Credentials: rows the templ dashboard wrote before v1.7.0 are plaintext; run `EncryptStoredCredentials` once per app after setting `credentials_key` (CHANGELOG v1.7.0 "Provider credentials").
3. **Bugs found on the way.** The ones a templ-dashboard user could have hit, one short paragraph each, from `CHANGELOG.md` v1.7.0 and the ledgers. At least: the templ dashboard read only the `""` app; the REST API returned credential values in full; the templ provider form wrote rows without validation or encryption; `PreviewSend` reported no SMS sender for twilio, vonage and messagebird (07bbfcd); a recipient who opted out was reported as `sent`. Point at the CHANGELOG for the full list rather than copying it.
4. **Deliberately dropped.** From the spec: the four widgets (`herald-stats`, `herald-recent-messages`, `herald-delivery-status`, `herald-channel-breakdown`): the React host has no generic widget slot, and the Overview page replaces them with counts that aren't capped at 1,000 rows. Retry on a failed message: it re-sent the logged text body only, truncated, with no template data, so a retry sent something different from the original; the message detail page links to Send test prefilled instead. The manifest's `searchable` capability: never implemented. Anything else Step 2 finds dropped goes here with its reason.
5. **Blocked.** Anything the React side can't do yet because the host or forge lacks it. Write "Nothing is blocked." if Step 2 finds none.
6. **Page by page.** First a route map table (templ route, React route, notes), then one section per templ page with a table per page: the templ element (column, badge, filter, empty state, action, form field), its status (Migrated / Changed / Dropped / Blocked), where it lives now (React page and contract intent) or what replaced it, and a reason for anything not plainly migrated. The route map:

   | templ route | React route |
   |---|---|
   | `/` | `/` (Overview) |
   | `/providers` | `/providers` |
   | `/providers/create` | `/new-provider` |
   | `/providers/detail` | `/providers/:id`, edit at `/providers/:id/edit` |
   | `/templates` | `/templates`, plus `/templates-without-fallback` (new) |
   | `/templates/create` | `/new-template` |
   | `/templates/detail` | `/templates/:id` (the template workspace) |
   | `/templates/versions/create` | the workspace's locale rail (add a locale) |
   | `/messages` | `/messages` |
   | `/messages/detail` | `/messages/:id` |
   | `/inbox` | `/inbox` |
   | `/preferences` | `/preferences` |
   | `/send-test` | `/send-test`, plus `/providers/:id/send-test` and `/messages/:id/send-test` (prefilled) |
   | (none) | `/routing` (new: routing rules) |

   After the pages: a **Settings** section for the `herald-config` panel (replaced by `engine.info`, which feeds every page header; list each field the panel showed and where it shows now), a **Widgets** section, a **Navigation and manifest** section (each `baseNav` item with its group, the header's "Send Test" action, `searchable`), a **Bridge functions** table (each of the 24 `herald.*` functions in `bridge.go` and the intent that replaced it), and a **Shared components and helpers** section (each file in `dashboard/components/` and `pages/helpers.templ`, and what plays its role in the plugin).
7. **Still open.** Herald-side gaps a dashboard user will notice, one line each with where it lives: the CHANGELOG v1.7.0 "Still open" items that the dashboard shows (no delivery receipts, so `delivered` and `bounced` never appear; only the text body is logged; `Message.TemplateID` holds the slug; `Async` ignored), plus any open items in the scratchpad ledgers marked for Rex. Say that `a-h/templ` may reappear as an indirect requirement only if forge's own packages pull it again, which is forge's concern, not Herald's.

- [ ] **Step 1: Read the sources.** Invoke `rex-voice`. Read every `.templ` file in `dashboard/` (not the `*_templ.go` files), and `bridge.go`, `contributor.go`, `data.go`, `manifest.go`. Read `packages/plugin-herald/src/index.tsx`, `src/keys.ts` and the page files the route map names, and `extension/contract/manifest.yaml`. Read the three ledgers and CHANGELOG v1.7.0.
- [ ] **Step 2: Draft** `MIGRATION.md` with the seven sections above. Every row of a page table names a real element from the `.templ` source, and every "Migrated" row names the React page and the intent behind it.
- [ ] **Step 3: Humanize.** Run the draft through `humanizer` in embedded mode, then `grep -n '—\|–' MIGRATION.md`. Expected: no output.
- [ ] **Step 4: Prove coverage.** From the herald root:

```bash
miss=0
names=$( { grep -oE 'case "[^"]+"' dashboard/contributor.go | cut -d'"' -f2
           grep -oE 'Register\("herald\.[A-Za-z]+' dashboard/bridge.go | cut -d'"' -f2
           grep -oE 'ID: +"herald-[a-z-]+"' dashboard/manifest.go | cut -d'"' -f2
           grep -oE 'Label: +"[^"]+"' dashboard/manifest.go | cut -d'"' -f2
           git ls-files 'dashboard/*.templ' | xargs -n1 basename; } | sort -u)
while IFS= read -r n; do
  grep -qF -- "$n" MIGRATION.md || { echo "missing: $n"; miss=1; }
done <<< "$names"
echo "miss=$miss"
```

Expected: `miss=0`. A name can be missed honestly (the generic `delete` case, say) only if the page table that covers it uses the word; fix the document, not the script.
- [ ] **Step 5: Prove the intents exist.**

```bash
for i in $(grep -oE '`[a-z]+\.[a-zA-Z]+`' MIGRATION.md | tr -d '`' | sort -u); do
  case $i in herald.*|*.go|*.mod|*.sum|*.yaml|*.yml|*.md|*.ts|*.tsx|*.templ|*.json) continue;; esac
  grep -qE "name: $i[ ,}]" extension/contract/manifest.yaml || echo "no such intent: $i"
done
```

Expected: no output. (`herald.*` names are the old bridge functions, which Step 4 already checked.)
- [ ] **Step 6: Commit.**

```bash
git add MIGRATION.md
git commit --only -m "docs: record what the dashboard migration moved, changed and dropped" -- MIGRATION.md
git show --stat HEAD
```

### Task 2: Delete the templ dashboard

**Files:**
- Delete: `dashboard/` (all 59 tracked files)
- Modify: `Makefile` (remove the templ targets), `go.mod`, `go.sum` (via `go mod tidy`)

**Interfaces:**
- Consumes: Task 1's committed `MIGRATION.md` (the deletion must not land before the record of what it deletes).
- Produces: a tree with no `.templ` files and no `dashboard/` package, still on forge v1.11.2.

- [ ] **Step 1: Confirm nothing imports it.**

```bash
grep -rn 'herald/dashboard' --include='*.go' /Users/rexraphael/Work/xraph/forgery | grep -v '/herald/dashboard/'
```

Expected: no output. If anything prints, stop and report it: that importer has to change first.
- [ ] **Step 2: Delete.** `git rm -r -q dashboard`. Then look at what's left: `ls -A dashboard 2>/dev/null`. The only expected leftover is the ignored `dashboard/.DS_Store` (and the empty subdirectories around it); remove exactly that with `rm dashboard/.DS_Store` and then `find dashboard -type d -empty -delete`. If anything else is left, stop and report it.
- [ ] **Step 3: Remove the templ targets from `Makefile`.** Use the Edit tool. Remove: `templ templ-watch` from the `.PHONY` line; the two help lines `make templ` and `make templ-watch`; the `Installing templ...` and `go install github.com/a-h/templ/cmd/templ@latest` lines in `deps`; the templ line in `check-deps`; the `templ:` and `templ-watch:` targets with their `##` comments; and change `all: templ check test build` to `all: check test build` with its comment `## all: Run check, test, and build`.
- [ ] **Step 4: Prove the Makefile.** `grep -n templ Makefile` prints nothing, and `make -n all` exits 0.
- [ ] **Step 5: Tidy.** `go mod tidy`, then `git diff go.mod`. Expected: `github.com/a-h/templ` and `github.com/xraph/forgeui` leave the direct requirements. forge v1.11.2's own dashboard packages may keep them as `// indirect`; Task 3 removes that. Nothing else should leave the direct block.
- [ ] **Step 6: Prove it.**

```bash
find . -name '*.templ'
grep -rn 'herald/dashboard' --include='*.go' .
go build ./... && go test ./...
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C
```

Expected: the first two print nothing, build and tests pass, lint reports `0 issues.`
- [ ] **Step 7: Commit only the deletion.**

```bash
git commit --only -m "chore: delete the templ dashboard" -m "<body>" -- dashboard Makefile go.mod go.sum
git show --stat HEAD
```

The body (rex-voice, then humanizer) says the React plugin in forge-dashboard replaces the package, that MIGRATION.md records where every page, action and widget went, and that the Makefile lost its templ targets because nothing is left to generate. `git show --stat HEAD` lists the 59 `dashboard/` files, `Makefile`, `go.mod` and `go.sum`, and nothing else.

### Task 3: Move to forge v1.12.0 and correct the CHANGELOG

**Files:**
- Modify: `go.mod`, `go.sum`, `CHANGELOG.md`

**Interfaces:**
- Consumes: Task 2's tree.
- Produces: Herald on forge v1.12.0 with no templ or forgeui anywhere in its module graph.

- [ ] **Step 1: Bump.** `go get github.com/xraph/forge@v1.12.0 && go mod tidy`, then `git diff go.mod`. Expected (from the 2026-10-07 probe): forge v1.11.2 becomes v1.12.0; `a-h/templ`, `forgeui`, `Oudwins/tailwind-merge-go` and `nhooyr.io/websocket` leave the file entirely. `grep -n 'templ\|forgeui' go.mod` prints nothing.
- [ ] **Step 2: Prove the root module.**

```bash
go build ./... && go test ./...
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C
```

Expected: pass, `0 issues.`
- [ ] **Step 3: Prove every driver module.** The eleven modules under `drivers/` each `replace` the root module, so they see its new requirements.

```bash
for d in drivers/*/; do (cd "$d" && go build ./... && go test ./... >/dev/null && echo "ok $d" || echo "FAIL $d"); done
git status --short drivers
```

Expected: eleven `ok` lines and no changed `go.mod` under `drivers/` (none of them names forge). If a driver's `go.mod` or `go.sum` changes, run `go mod tidy` in that driver, include those files in the Step 5 commit, and say so in its body.
- [ ] **Step 4: Correct `CHANGELOG.md` (v1.7.0 is untagged, so edit its notes in place).** Use the Edit tool.
  - "Provider credentials", the line starting "The templ dashboard creates providers through the engine too": the templ dashboard no longer exists. Rewrite it in the past tense: providers the templ dashboard wrote before this release are still plaintext, and the one `EncryptStoredCredentials` run after you upgrade picks them up.
  - "Dashboard contract", the sentence "It needs forge v1.11.2 or later.": change it to forge v1.12.0.
  - Add to "Breaking changes": the templ dashboard is gone. `github.com/xraph/herald/dashboard` (its pages, widgets, settings panel and `RegisterBridge`) no longer exists; the React plugin replaces it, and `MIGRATION.md` lists where each page, action and widget went. Herald needs forge v1.12.0 and no longer depends on templ or forgeui.
  - rex-voice and humanizer on the new and changed lines; `grep -n '—\|–' CHANGELOG.md` prints nothing.
- [ ] **Step 5: Commit the bump, then the CHANGELOG.**

```bash
git commit --only -m "chore(deps): move to forge v1.12.0 and drop templ and forgeui" -m "<body>" -- go.mod go.sum
git show --stat HEAD
git commit --only -m "docs(changelog): record that the templ dashboard is gone" -- CHANGELOG.md
git show --stat HEAD
```

The bump's body says v1.12.0 is the first forge release whose dashboard packages import neither templ nor forgeui, so tidy takes both out of Herald's module graph, and that the root module and all eleven driver modules build and pass their tests.

### Task 4 (controller): Close out

- [ ] Final proof on the committed tree: `find . -name '*.templ'` prints nothing; `go build ./... && go test ./...` pass; fresh-cache lint `0 issues.`; `git log --oneline origin/main..main` shows exactly the four commits from Tasks 1 to 3.
- [ ] Whole-plan review on the most capable model: MIGRATION.md against the deleted sources (`git show HEAD~3:dashboard/...` reads them back) and against Review Focus 1 to 5.
- [ ] Report to Rex: the four commits, the proof output, anything Task 1 put under Blocked or Still open, and the push question (herald main is unpushed until he says so; v1.7.0 stays untagged until he says so).
- [ ] Update memory (`herald-dashboard-migration.md` and its `MEMORY.md` line): 2c done, commits, pushed or not.
