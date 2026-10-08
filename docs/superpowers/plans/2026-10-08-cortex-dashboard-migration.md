# Cortex React dashboard migration

You can review Cortex configuration and recorded execution in one scoped app. The React plugin uses the real engine through Forge contract intents; the demo uses SQLite on disk and labels its seed records. Templ stays until the inventory in Cortex's `MIGRATION.md` closes.

## Source and decisions

Read all 734 lines of `packages/plugin/PLAYBOOK.md`, `cortex/dashboard/contributor.go`, the legacy forms/tables/widgets/settings and `cortex/engine`, entity and store interfaces. Primary source is the engine and its constructed dependencies. The templ routes are the parity checklist.

Cortex scope is an ordered hierarchy of at most three levels (`cortex/scope.go`). A zero scope is refused by all real stores. Use a host-provided authenticated scope resolver, with an explicit single-scope deployment default only when claims are absent; malformed claims must refuse. Never accept scope, tenant, app or caller identity from a command payload. Reads and writes have separate authorization scopes. Preserve the principal through `cortex.WithPrincipal` so tool authorization sees the caller.

Stable TypeIDs are route identities. Names used by composition references stay immutable through the dashboard. Updates use pointer fields to preserve omitted values. Read the row before patching, preserve timestamps/scope and validate nested values and referenced records. Writes call engine methods, especially prompt synchronization, cancellation and checkpoint resolution. Return canonical errors and invalidate every affected query through manifest metadata.

`RunAgent` echoes without an LLM. The UI names that limitation and requires an explicit echo demonstration request, separate from model execution. Registered LLM, knowledge and safety adapters are reported separately from available remote providers. Sentinel's auto-evaluation hook is TODO. The old safety adapter swallows errors and performs bounded post-filtering; it cannot supply a trustworthy complete scan result. Keep external model, safety and knowledge data behind scoped provider interfaces and report unavailable providers visibly.

Runtime `UpdateConfig` is in-memory and unsynchronized. Settings show actual runtime values, with no Save action until a persistent synchronized configuration service is supplied. This is a deliberate correction to the old form and is recorded in the inventory.

## UI direction

Use the existing dashboard tokens and typefaces. The light palette comes from shared background, card, foreground, muted and destructive variables; dark mode follows the same semantic tokens. No new global CSS. Configuration lists use compact shared tables, a search row and a nearby create action. Details show composition references and prompts in a practical two-column layout that wraps to one column on narrow screens.

Agents are the central workflow. Their detail opens prompt preview, sessions and run history. Operations are runs, pending approvals and session memory. The playground keeps configuration next to input and comparison results, with saved identities visible. Structured arrays use repeatable controls, selectors and typed numeric inputs. Supported prompt text and JSON payload viewers use the installed CodeMirror dependencies, loaded only on editor/review routes. Use shared ZeroState, QueryBoundary, CommandAlert, ConfirmDialog, Timestamp and NoneCell. No unregistered tour controls.

Badges: enabled and completed use outline; disabled, created and paused use secondary; running uses default; failed and blocked use destructive. This is stable across pages. Filters carry the workload when deployment distributions differ.

## Implementation slices

1. Contract foundation and configuration: contributor registration, scope/auth adapters, canonical errors, inventory, list/detail and typed create/update/delete for agents, personas, skills, traits and behaviors. Cover missing/malformed claims, foreign IDs, omission versus empty arrays and populated SQLite round trips. Commit only this slice after checks.
2. Execution review: run lists/details/steps/tool calls, pending checkpoints/decisions, sessions and memory clearing. Use real engine actions with principal and scope. Add runtime capabilities, prompt preview and explicit execution modes. Cover denial, invalid state, session ownership and audit outcomes.
3. React composition: plugin package, compact tables/details, structured editors and reference selectors, lazy prompt editor, visible errors and correct invalidation. Test field names, pending dialogs, command failure visibility, empty/filtered states and routing identity.
4. React operations and integrations: run review, approval detail, session memory, playground, runtime settings and truthful external-provider status. Account for every legacy contribution and domain-only capability in MIGRATION.md. Add orchestration and A2A inspection where the engine supports it; leave no fake write controls over missing services.
5. Real demo: coordinate narrowly additive changes with Ctrlplane. Persistent SQLite, idempotent labelled seeds, live contract registration, authenticated scoped demo identities and secure command handshake. Use free ports 8096/5176 if available. No synthetic Cortex fallback.
6. Live verification: exercise every shipped read/write through real Go HTTP and browser at desktop and 390px; error/retry/denied/missing/filtered/empty states, external refresh, restart readback and stable identity. Record exact commands, commit IDs, screenshots and bundle sizes. Run plugin tests/typecheck/lint, shell build and workspace tests. Report unrelated baseline failures separately.
7. Retirement: only after the required inventory closes, remove legacy dashboard and unused imports/dependencies as its own commit. Build/test each nested Go module and the real demo with the package gone. No push or remote merge.

## Verification and limits

The initial root test invocation passed core, engine, SQLite and PostgreSQL. MongoDB failed to start on Docker's Linux 7.0.14 kernel because the image rejects kernels 6.19 and newer by default. Record that as blocked, not a passing backend qualification.

Both primary checkouts are on main. Cortex is clean with two pre-existing local commits. All local feature/fix branch patches are already included in main and all fetched feature/fix tips are ancestors, so no replay is needed. There are no extra worktrees to remove. Shared dashboard edits belong to other chats and remain untouched.
