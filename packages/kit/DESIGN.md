# Compact dashboard design

Import `@forge-go/dashboard-kit/globals.css` in your application entry. The
approved reference theme is the default, so you don't need a theme attribute
or a separate stylesheet to use it.

Use shared components first. `DashboardShell` provides the navigation and
44px breadcrumb header. `PageHeader`, `FilterBar`, `StatGrid`, `ResourceTable`,
`DetailLayout` and `SettingsForm` provide the page layout and compact controls.
Standard buttons, inputs and selects are 32px tall. Small controls are 28px,
and large controls are 36px. Keep labels readable and preserve focus states.

Use 16px between page sections, 12px to 16px inside panels, and horizontal
controls where the available width permits them. Keep a multiline editor as
tall as its content needs. A chart, code editor or file preview can use more
space when that helps you work with it.

Use `ZeroState` for empty results and missing resources. Keep loading,
denied access and failed requests distinct through `QueryBoundary` and the
host's existing authorization checks. Show the explanation and next action
inside the empty state. A walkthrough needs a registered tour and working
route targets.

Use pale neutral surfaces and fine borders, black primary actions, violet
chart lines, and green success indicators. Keep metric values in Inter;
reserve monospace for paths, logs and identifiers. Active navigation uses a
white outlined row in light mode. Dark mode follows the same hierarchy.

Tailwind must scan the packages that your application renders. Add explicit
`@source` entries for the host, runtime and plugin sources beside your Kit
stylesheet import. A package import alone does not make its utility classes
available in the generated stylesheet.

## Page pass

The October 2026 pass audited 444 page and presentation modules, including
211 files under plugin `pages` directories. Core and Ctrlplane also define
pages in top-level modules. Existing compact layouts retain their spacing;
large section gaps, panel padding and headings now use the compact defaults.
Flex and grid layouts can shrink inside narrow containers. Query arguments,
commands, resource identity and authorization behavior are preserved.

| Package          | Modules audited | Modules adjusted |
| ---------------- | --------------: | ---------------: |
| plugin-authsome  |              38 |               35 |
| plugin-bastion   |              16 |               14 |
| plugin-chronicle |              34 |               24 |
| plugin-conduit   |               3 |                2 |
| plugin-core      |               6 |                5 |
| plugin-cortex    |               8 |                6 |
| plugin-ctrlplane |               4 |                2 |
| plugin-dispatch  |              17 |                3 |
| plugin-herald    |              30 |               23 |
| plugin-keysmith  |              26 |               18 |
| plugin-ledger    |              37 |               29 |
| plugin-nexus     |              27 |                5 |
| plugin-relay     |              24 |               18 |
| plugin-sentinel  |              49 |               34 |
| plugin-shield    |               6 |                3 |
| plugin-streaming |               8 |                7 |
| plugin-trove     |              18 |               11 |
| plugin-vault     |              31 |               25 |
| plugin-warden    |              29 |               23 |
| plugin-weave     |              24 |               18 |

Authentication screens, runtime fallback views, the playground and both
shell previews also use the shared theme. Browser qualification covers
representative pages with local fixtures, not every backend command in every
plugin. Missing fixture intents remain visible as request errors.

## Checks

This repository has no `make l` or `make f` targets. Use `pnpm lint` for
workspace lint, and `pnpm exec prettier --write <changed files>` for focused
formatting. Check the formatted files with `pnpm exec prettier --check`.
Run `pnpm test:ci` and `pnpm typecheck`, then build the shell and playground.
Use the shell's `build:preview` and `build:reference` scripts for the separate
sample entries.
