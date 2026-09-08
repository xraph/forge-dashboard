# Kit blocks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the nine shared UI blocks the authsome and streaming plugins need, so no plugin invents its own empty state, table, or error card.

**Architecture:** Every block is a first-party component in `packages/kit/src/components/`, composing vendored shadcn primitives that already live there. Blocks are presentational: they take props and render. No block imports from `@forge-go/dashboard-plugin`, so kit never learns a contract shape and stays independently testable.

**Tech Stack:** React 19, TypeScript, Tailwind v4, Base UI via vendored shadcn components, vitest + @testing-library/react, jsdom.

**Spec:** `docs/superpowers/specs/2026-09-08-dashboard-plugin-platform-design.md` (section 4, "Kit blocks")

## Global Constraints

- New files only. Never hand-edit a vendored component in `packages/kit/src/components/`; compose it instead. `components.json` governs those files.
- Import `cn` from `@forge-go/dashboard-kit/lib/utils`, which is the first-party convention. Vendored files import from `"cn"`; do not copy that.
- Import sibling components through the package alias (`@forge-go/dashboard-kit/components/card`), matching `section-cards.tsx`, not through relative paths.
- No block imports from `@forge-go/dashboard-plugin`. A block that needs a query result takes a structurally typed prop it declares itself.
- Read `BASELINE.md` before adding any dependency. These blocks add none.
- Tests live in `packages/kit/test/<block>.test.tsx` and run with `pnpm --filter @forge-go/dashboard-kit test`.
- `window.matchMedia` is not implemented in jsdom. Any test rendering a block inside `SidebarProvider` needs the stub used at the top of `packages/kit/test/site-header.test.tsx`. None of these blocks need it unless stated.
- Every interactive element gets an accessible name. Tests query by role and name, never by class.

---

### Task 1: EmptyState

**Files:**
- Create: `packages/kit/src/components/empty-state.tsx`
- Test: `packages/kit/test/empty-state.test.tsx`

**Interfaces:**
- Consumes: the vendored `Empty`, `EmptyHeader`, `EmptyMedia`, `EmptyTitle`, `EmptyDescription`, `EmptyContent` from `packages/kit/src/components/empty.tsx`.
- Produces: `EmptyState`, and `EmptyStateProps { title: string; description?: string; icon?: ReactNode; action?: ReactNode; className?: string }`.

- [ ] **Step 1: Write the failing test**

```tsx
// packages/kit/test/empty-state.test.tsx
import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { EmptyState } from "../src/components/empty-state"

describe("EmptyState", () => {
  it("announces itself as a status so a screen reader hears the empty result", () => {
    render(<EmptyState title="No users yet." />)
    expect(screen.getByRole("status")).toBeTruthy()
    expect(screen.getByText("No users yet.")).toBeTruthy()
  })

  it("renders a description when given one and omits it otherwise", () => {
    const { rerender } = render(<EmptyState title="No users yet." />)
    expect(screen.queryByText("Invite somebody to get started.")).toBeNull()

    rerender(
      <EmptyState title="No users yet." description="Invite somebody to get started." />,
    )
    expect(screen.getByText("Invite somebody to get started.")).toBeTruthy()
  })

  it("renders the action it is handed", () => {
    render(<EmptyState title="No users yet." action={<button>Invite</button>} />)
    expect(screen.getByRole("button", { name: "Invite" })).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @forge-go/dashboard-kit test empty-state`
Expected: FAIL, cannot resolve `../src/components/empty-state`.

- [ ] **Step 3: Write the implementation**

```tsx
// packages/kit/src/components/empty-state.tsx
import type { ReactNode } from "react"
import { cn } from "@forge-go/dashboard-kit/lib/utils"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@forge-go/dashboard-kit/components/empty"

export interface EmptyStateProps {
  /** What is missing, as a sentence. "No users yet." */
  title: string
  /** Optional second line telling the reader what to do about it. */
  description?: string
  icon?: ReactNode
  /** Usually the button that creates the first one. */
  action?: ReactNode
  className?: string
}

/**
 * What a list renders when a read succeeded and returned nothing.
 *
 * `role="status"` and not a bare div: an empty result is information, and a
 * screen reader that hears silence cannot tell it apart from a list that is
 * still loading.
 */
export function EmptyState({
  title,
  description,
  icon,
  action,
  className,
}: EmptyStateProps) {
  return (
    <Empty role="status" className={cn("border", className)}>
      <EmptyHeader>
        {icon && <EmptyMedia variant="icon">{icon}</EmptyMedia>}
        <EmptyTitle>{title}</EmptyTitle>
        {description && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
      {action && <EmptyContent>{action}</EmptyContent>}
    </Empty>
  )
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @forge-go/dashboard-kit test empty-state`
Expected: PASS, three tests.

- [ ] **Step 5: Commit**

```bash
git add packages/kit/src/components/empty-state.tsx packages/kit/test/empty-state.test.tsx
git commit -m "feat(kit): add EmptyState block"
```

---

### Task 2: PageHeader

**Files:**
- Create: `packages/kit/src/components/page-header.tsx`
- Test: `packages/kit/test/page-header.test.tsx`

**Interfaces:**
- Produces: `PageHeader`, and `PageHeaderProps { title: string; description?: string; actions?: ReactNode; className?: string }`. The title renders as an `<h1>`.

- [ ] **Step 1: Write the failing test**

```tsx
// packages/kit/test/page-header.test.tsx
import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { PageHeader } from "../src/components/page-header"

describe("PageHeader", () => {
  it("renders the title as the page's level-one heading", () => {
    render(<PageHeader title="Users" />)
    const heading = screen.getByRole("heading", { level: 1, name: "Users" })
    expect(heading).toBeTruthy()
  })

  it("renders a description when given one", () => {
    render(<PageHeader title="Users" description="Everyone who can sign in." />)
    expect(screen.getByText("Everyone who can sign in.")).toBeTruthy()
  })

  it("renders actions alongside the title", () => {
    render(<PageHeader title="Users" actions={<button>New user</button>} />)
    expect(screen.getByRole("button", { name: "New user" })).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @forge-go/dashboard-kit test page-header`
Expected: FAIL, cannot resolve `../src/components/page-header`.

- [ ] **Step 3: Write the implementation**

```tsx
// packages/kit/src/components/page-header.tsx
import type { ReactNode } from "react"
import { cn } from "@forge-go/dashboard-kit/lib/utils"

export interface PageHeaderProps {
  title: string
  description?: string
  /** Buttons for this page as a whole. Row actions belong in the table. */
  actions?: ReactNode
  className?: string
}

/**
 * The top of every plugin page.
 *
 * An `<h1>` and not an `<h2>`: the host's SiteHeader shows the page name in
 * chrome, not in a heading, so each page owns the document's single level-one
 * heading and the heading order stays legal.
 */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-start justify-between gap-2",
        className,
      )}
    >
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-medium">{title}</h1>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @forge-go/dashboard-kit test page-header`
Expected: PASS, three tests.

- [ ] **Step 5: Commit**

```bash
git add packages/kit/src/components/page-header.tsx packages/kit/test/page-header.test.tsx
git commit -m "feat(kit): add PageHeader block"
```

---

### Task 3: StatGrid

**Files:**
- Create: `packages/kit/src/components/stat-grid.tsx`
- Test: `packages/kit/test/stat-grid.test.tsx`

**Interfaces:**
- Produces: `StatGrid`, `Stat`, `StatItem { label: string; value: string | number; hint?: string }`, `StatGridProps { items: StatItem[]; className?: string }`.

This replaces the `Stat` helper copied into `packages/plugin-core/src/index.tsx` and `packages/plugin-streaming/src/pages/overview.tsx`. Both use the same container-query grid, which only works inside the host's `@container/main` element.

- [ ] **Step 1: Write the failing test**

```tsx
// packages/kit/test/stat-grid.test.tsx
import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { StatGrid } from "../src/components/stat-grid"

describe("StatGrid", () => {
  it("renders one card per item, label and value both visible", () => {
    render(
      <StatGrid
        items={[
          { label: "Connections", value: 12 },
          { label: "Rooms", value: 3 },
        ]}
      />,
    )
    expect(screen.getByText("Connections")).toBeTruthy()
    expect(screen.getByText("12")).toBeTruthy()
    expect(screen.getByText("Rooms")).toBeTruthy()
    expect(screen.getByText("3")).toBeTruthy()
  })

  it("renders a zero rather than treating it as missing", () => {
    render(<StatGrid items={[{ label: "Rooms", value: 0 }]} />)
    expect(screen.getByText("0")).toBeTruthy()
  })

  it("renders a hint when given one", () => {
    render(<StatGrid items={[{ label: "Uptime", value: "3h 2m", hint: "since restart" }]} />)
    expect(screen.getByText("since restart")).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @forge-go/dashboard-kit test stat-grid`
Expected: FAIL, cannot resolve `../src/components/stat-grid`.

- [ ] **Step 3: Write the implementation**

```tsx
// packages/kit/src/components/stat-grid.tsx
import { cn } from "@forge-go/dashboard-kit/lib/utils"
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@forge-go/dashboard-kit/components/card"

export interface StatItem {
  label: string
  /** Formatted by the caller. This block does no unit or date formatting. */
  value: string | number
  hint?: string
}

export function Stat({ label, value, hint }: StatItem) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
        {hint && <CardDescription className="text-xs">{hint}</CardDescription>}
      </CardHeader>
    </Card>
  )
}

export interface StatGridProps {
  items: StatItem[]
  className?: string
}

/**
 * The counter row every overview page opens with.
 *
 * The `@xl/main` and `@5xl/main` variants are container queries scoped to a
 * container named `main`, which the host declares on its content wrapper.
 * Render this outside that wrapper and the cards stack in one column at every
 * width. That is a layout bug, not a crash, so nothing warns about it.
 */
export function StatGrid({ items, className }: StatGridProps) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-4 @xl/main:grid-cols-2 @5xl/main:grid-cols-4",
        className,
      )}
    >
      {items.map((item) => (
        <Stat key={item.label} {...item} />
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @forge-go/dashboard-kit test stat-grid`
Expected: PASS, three tests.

- [ ] **Step 5: Commit**

```bash
git add packages/kit/src/components/stat-grid.tsx packages/kit/test/stat-grid.test.tsx
git commit -m "feat(kit): add StatGrid block"
```

---

### Task 4: DetailLayout and DescriptionList

**Files:**
- Create: `packages/kit/src/components/detail-layout.tsx`
- Test: `packages/kit/test/detail-layout.test.tsx`

**Interfaces:**
- Produces: `DetailLayout`, `DetailLayoutProps { main: ReactNode; aside?: ReactNode; className?: string }`, `DescriptionList`, `DescriptionListProps { items: DescriptionItem[]; className?: string }`, `DescriptionItem { term: string; value: ReactNode }`.

Six detail pages want this shape: user, session, device, role, organization, room. `DescriptionList` replaces the hand-rolled `<dl className="grid grid-cols-[auto_1fr]">` in `packages/plugin-authsome/src/pages/users.tsx`.

- [ ] **Step 1: Write the failing test**

```tsx
// packages/kit/test/detail-layout.test.tsx
import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { DescriptionList, DetailLayout } from "../src/components/detail-layout"

describe("DescriptionList", () => {
  it("pairs each term with its value in a real definition list", () => {
    const { container } = render(
      <DescriptionList
        items={[
          { term: "Email", value: "ada@example.com" },
          { term: "Status", value: "active" },
        ]}
      />,
    )
    expect(container.querySelector("dl")).toBeTruthy()
    expect(container.querySelectorAll("dt")).toHaveLength(2)
    expect(container.querySelectorAll("dd")).toHaveLength(2)
    expect(screen.getByText("Email")).toBeTruthy()
    expect(screen.getByText("ada@example.com")).toBeTruthy()
  })

  it("renders a node value, not just a string", () => {
    render(
      <DescriptionList items={[{ term: "Status", value: <span>banned</span> }]} />,
    )
    expect(screen.getByText("banned")).toBeTruthy()
  })
})

describe("DetailLayout", () => {
  it("renders main content on its own when there is no aside", () => {
    render(<DetailLayout main={<p>main pane</p>} />)
    expect(screen.getByText("main pane")).toBeTruthy()
    expect(screen.queryByRole("complementary")).toBeNull()
  })

  it("renders the aside as a complementary landmark when given one", () => {
    render(<DetailLayout main={<p>main pane</p>} aside={<p>side pane</p>} />)
    expect(screen.getByRole("complementary")).toBeTruthy()
    expect(screen.getByText("side pane")).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @forge-go/dashboard-kit test detail-layout`
Expected: FAIL, cannot resolve `../src/components/detail-layout`.

- [ ] **Step 3: Write the implementation**

```tsx
// packages/kit/src/components/detail-layout.tsx
import type { ReactNode } from "react"
import { cn } from "@forge-go/dashboard-kit/lib/utils"

export interface DescriptionItem {
  term: string
  /** A node, not a string, so a value can be a Badge or a copy button. */
  value: ReactNode
}

export interface DescriptionListProps {
  items: DescriptionItem[]
  className?: string
}

/**
 * The field list every detail pane opens with.
 *
 * A real `<dl>` with `<dt>`/`<dd>` pairs and not a two-column grid of divs.
 * The pairing is the content, and a screen reader announces it only when the
 * elements say so.
 */
export function DescriptionList({ items, className }: DescriptionListProps) {
  return (
    <dl
      className={cn(
        "grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm",
        className,
      )}
    >
      {items.map((item) => (
        <div key={item.term} className="contents">
          <dt className="text-muted-foreground">{item.term}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

export interface DetailLayoutProps {
  main: ReactNode
  /** Secondary panes: related sessions, devices, sub-plugin sections. */
  aside?: ReactNode
  className?: string
}

/**
 * Two columns on a wide screen, stacked on a narrow one.
 *
 * The aside is a `<aside>` so it lands in the accessibility tree as a
 * complementary landmark, which is what lets somebody skip past a user's
 * device list to get back to the user.
 */
export function DetailLayout({ main, aside, className }: DetailLayoutProps) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-4 @3xl/main:grid-cols-[2fr_1fr]",
        className,
      )}
    >
      <div className="flex flex-col gap-4">{main}</div>
      {aside && <aside className="flex flex-col gap-4">{aside}</aside>}
    </div>
  )
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @forge-go/dashboard-kit test detail-layout`
Expected: PASS, four tests.

- [ ] **Step 5: Commit**

```bash
git add packages/kit/src/components/detail-layout.tsx packages/kit/test/detail-layout.test.tsx
git commit -m "feat(kit): add DetailLayout and DescriptionList blocks"
```

---

### Task 5: ConfirmDialog

**Files:**
- Create: `packages/kit/src/components/confirm-dialog.tsx`
- Test: `packages/kit/test/confirm-dialog.test.tsx`

**Interfaces:**
- Consumes: the vendored `AlertDialog`, `AlertDialogContent`, `AlertDialogHeader`, `AlertDialogTitle`, `AlertDialogDescription`, `AlertDialogFooter`, `AlertDialogAction`, `AlertDialogCancel` from `packages/kit/src/components/alert-dialog.tsx`.
- Produces: `ConfirmDialog`, `ConfirmDialogProps { open: boolean; onOpenChange: (open: boolean) => void; title: string; description?: ReactNode; confirmLabel?: string; cancelLabel?: string; destructive?: boolean; pending?: boolean; onConfirm: () => void }`.

Controlled, with no trigger of its own. Callers already hold "which row is the user acting on", and a dialog that owned its own open state would need that value threaded in anyway.

- [ ] **Step 1: Write the failing test**

```tsx
// packages/kit/test/confirm-dialog.test.tsx
import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { ConfirmDialog } from "../src/components/confirm-dialog"

describe("ConfirmDialog", () => {
  it("renders nothing while closed", () => {
    render(
      <ConfirmDialog
        open={false}
        onOpenChange={() => {}}
        title="Ban ada@example.com?"
        onConfirm={() => {}}
      />,
    )
    expect(screen.queryByText("Ban ada@example.com?")).toBeNull()
  })

  it("shows the title and description when open", () => {
    render(
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        title="Ban ada@example.com?"
        description="They will be signed out of every session."
        onConfirm={() => {}}
      />,
    )
    expect(screen.getByText("Ban ada@example.com?")).toBeTruthy()
    expect(screen.getByText("They will be signed out of every session.")).toBeTruthy()
  })

  it("calls onConfirm when the confirm button is pressed", () => {
    const onConfirm = vi.fn()
    render(
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        title="Ban ada@example.com?"
        confirmLabel="Ban"
        onConfirm={onConfirm}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Ban" }))
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it("disables confirm and says so while a command is in flight", () => {
    render(
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        title="Ban ada@example.com?"
        confirmLabel="Ban"
        pending
        onConfirm={() => {}}
      />,
    )
    const confirm = screen.getByRole("button", { name: "Working…" })
    expect((confirm as HTMLButtonElement).disabled).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @forge-go/dashboard-kit test confirm-dialog`
Expected: FAIL, cannot resolve `../src/components/confirm-dialog`.

- [ ] **Step 3: Write the implementation**

```tsx
// packages/kit/src/components/confirm-dialog.tsx
import type { ReactNode } from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@forge-go/dashboard-kit/components/alert-dialog"

export interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Names the exact thing about to happen. "Ban ada@example.com?" */
  title: string
  /** What it costs. Consequences the operator cannot undo belong here. */
  description?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** Paints the confirm button as destructive. Default true. */
  destructive?: boolean
  /** The command is in flight. Disables confirm and swaps its label. */
  pending?: boolean
  onConfirm: () => void
}

/**
 * The step between clicking Delete and the row disappearing.
 *
 * Controlled, and with no trigger of its own. Every caller already knows which
 * row is being acted on, and a self-triggering dialog would need that value
 * passed in anyway.
 *
 * The confirm button stays enabled after `onConfirm` fires unless the caller
 * sets `pending`, because this block cannot know whether the command it
 * triggered is asynchronous.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = true,
  pending = false,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && (
            <AlertDialogDescription>{description}</AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            variant={destructive ? "destructive" : "default"}
            disabled={pending}
            onClick={onConfirm}
          >
            {pending ? "Working…" : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @forge-go/dashboard-kit test confirm-dialog`
Expected: PASS, four tests.

If `AlertDialogAction` rejects the `variant` prop, check its signature in `packages/kit/src/components/alert-dialog.tsx:142`. It wraps the kit `Button`, so it takes that button's variants. If the prop is named differently there, use whatever that file uses and do not add a prop to the vendored file.

- [ ] **Step 5: Commit**

```bash
git add packages/kit/src/components/confirm-dialog.tsx packages/kit/test/confirm-dialog.test.tsx
git commit -m "feat(kit): add ConfirmDialog block"
```

---

### Task 6: FilterBar

**Files:**
- Create: `packages/kit/src/components/filter-bar.tsx`
- Test: `packages/kit/test/filter-bar.test.tsx`

**Interfaces:**
- Consumes: `Input` from `packages/kit/src/components/input.tsx`, `NativeSelect` and `NativeSelectOption` from `packages/kit/src/components/native-select.tsx`.
- Produces: `FilterBar`, `FilterBarProps { search?: SearchConfig; filters?: FilterConfig[]; actions?: ReactNode; className?: string }`, `SearchConfig { value: string; onChange: (value: string) => void; placeholder?: string; label?: string }`, `FilterConfig { id: string; label: string; value: string; options: FilterOption[]; onChange: (value: string) => void }`, `FilterOption { label: string; value: string }`.

Fully controlled. It holds no state, debounces nothing, and issues no query. The page owns all three.

`NativeSelect` and not the Base UI `Select`: a real `<select>` needs no portal, so it is queryable by the `combobox` role and drivable with `fireEvent.change` in jsdom without any test scaffolding.

- [ ] **Step 1: Write the failing test**

```tsx
// packages/kit/test/filter-bar.test.tsx
import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { FilterBar } from "../src/components/filter-bar"

describe("FilterBar", () => {
  it("reports every keystroke in the search box", () => {
    const onChange = vi.fn()
    render(
      <FilterBar search={{ value: "", onChange, label: "Search users" }} />,
    )
    fireEvent.change(screen.getByRole("searchbox", { name: "Search users" }), {
      target: { value: "ada" },
    })
    expect(onChange).toHaveBeenCalledWith("ada")
  })

  it("renders a labelled select per filter and reports the chosen value", () => {
    const onChange = vi.fn()
    render(
      <FilterBar
        filters={[
          {
            id: "status",
            label: "Status",
            value: "all",
            onChange,
            options: [
              { label: "All", value: "all" },
              { label: "Banned", value: "banned" },
            ],
          },
        ]}
      />,
    )
    const select = screen.getByRole("combobox", { name: "Status" })
    fireEvent.change(select, { target: { value: "banned" } })
    expect(onChange).toHaveBeenCalledWith("banned")
  })

  it("renders nothing at all when it has no search, no filters and no actions", () => {
    const { container } = render(<FilterBar />)
    expect(container.firstChild).toBeNull()
  })

  it("renders actions", () => {
    render(<FilterBar actions={<button>Export</button>} />)
    expect(screen.getByRole("button", { name: "Export" })).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @forge-go/dashboard-kit test filter-bar`
Expected: FAIL, cannot resolve `../src/components/filter-bar`.

- [ ] **Step 3: Write the implementation**

```tsx
// packages/kit/src/components/filter-bar.tsx
import { useId, type ReactNode } from "react"
import { cn } from "@forge-go/dashboard-kit/lib/utils"
import { Input } from "@forge-go/dashboard-kit/components/input"
import {
  NativeSelect,
  NativeSelectOption,
} from "@forge-go/dashboard-kit/components/native-select"

export interface SearchConfig {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  /** The accessible name. Defaults to "Search". */
  label?: string
}

export interface FilterOption {
  label: string
  value: string
}

export interface FilterConfig {
  id: string
  label: string
  value: string
  options: FilterOption[]
  onChange: (value: string) => void
}

export interface FilterBarProps {
  search?: SearchConfig
  filters?: FilterConfig[]
  actions?: ReactNode
  className?: string
}

function Filter({ filter }: { filter: FilterConfig }) {
  const id = useId()
  return (
    <div className="flex items-center gap-1.5">
      <label htmlFor={id} className="text-xs text-muted-foreground">
        {filter.label}
      </label>
      <NativeSelect
        id={id}
        value={filter.value}
        onChange={(event) => filter.onChange(event.target.value)}
      >
        {filter.options.map((option) => (
          <NativeSelectOption key={option.value} value={option.value}>
            {option.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  )
}

/**
 * Search and filters above a list.
 *
 * Fully controlled and stateless. It does not debounce, does not remember a
 * previous value, and never issues a query. A page that wants debouncing owns
 * it, because the right delay depends on what the query costs, which this
 * block cannot know.
 *
 * Renders `null` when it has nothing to show, so a page can hand it optional
 * config without guarding, and without leaving an empty toolbar row behind.
 */
export function FilterBar({
  search,
  filters = [],
  actions,
  className,
}: FilterBarProps) {
  if (!search && filters.length === 0 && !actions) return null

  return (
    <div className={cn("flex flex-wrap items-center gap-3", className)}>
      {search && (
        <Input
          type="search"
          aria-label={search.label ?? "Search"}
          placeholder={search.placeholder}
          value={search.value}
          onChange={(event) => search.onChange(event.target.value)}
          className="h-8 w-56"
        />
      )}
      {filters.map((filter) => (
        <Filter key={filter.id} filter={filter} />
      ))}
      {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
    </div>
  )
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @forge-go/dashboard-kit test filter-bar`
Expected: PASS, four tests.

If the search input does not resolve as `role="searchbox"`, confirm `Input` forwards `type` to the underlying `<input>`. It does at `packages/kit/src/components/input.tsx`, which spreads props. If a wrapper swallows it, query by `role="textbox"` and update the test rather than changing the vendored input.

- [ ] **Step 5: Commit**

```bash
git add packages/kit/src/components/filter-bar.tsx packages/kit/test/filter-bar.test.tsx
git commit -m "feat(kit): add FilterBar block"
```

---

### Task 7: QueryBoundary and formatTimestamp

**Files:**
- Create: `packages/kit/src/components/query-boundary.tsx`
- Create: `packages/kit/src/lib/format.ts`
- Test: `packages/kit/test/query-boundary.test.tsx`
- Test: `packages/kit/test/format.test.ts`

**Interfaces:**
- Consumes: `Skeleton`, `Card`/`CardHeader`/`CardTitle`/`CardDescription`/`CardContent`, `Button`, `EmptyState` from Task 1.
- Produces:
  - `QueryBoundary<T>`, `QueryBoundaryProps<T> { title: string; query: QueryLike<T>; skeletonRows?: number; empty?: ReactNode; children: (data: T) => ReactNode }`
  - `QueryLike<T> { data?: T; error?: { code: string; message: string }; loading: boolean; refetch: () => void }`
  - `CommandAlert`, `CommandAlertProps { error?: { code: string; message: string }; title: string }`
  - `formatTimestamp(value: string | undefined): string` from `lib/format`

This replaces the two copies of `query-view.tsx` in `packages/plugin-authsome/src/components/` and `packages/plugin-streaming/src/components/`. Those files stay for now; the plugin plans delete them.

`QueryLike` is declared here rather than imported. Kit must not depend on `@forge-go/dashboard-plugin`, and the plugin package's `QueryState<T>` is structurally identical, so it satisfies this type without either package knowing about the other.

- [ ] **Step 1: Write the failing test for formatTimestamp**

```ts
// packages/kit/test/format.test.ts
import { describe, expect, it } from "vitest"
import { formatTimestamp } from "../src/lib/format"

describe("formatTimestamp", () => {
  it("prints an en dash for the empty string authsome sends for 'never happened'", () => {
    expect(formatTimestamp("")).toBe("–")
  })

  it("prints an en dash for undefined", () => {
    expect(formatTimestamp(undefined)).toBe("–")
  })

  it("formats a valid RFC 3339 timestamp", () => {
    const out = formatTimestamp("2026-09-08T10:30:00Z")
    expect(out).not.toBe("–")
    expect(out).toContain("2026")
  })

  it("prints an unparseable value exactly as it arrived, never 'Invalid Date'", () => {
    expect(formatTimestamp("not a date")).toBe("not a date")
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @forge-go/dashboard-kit test format`
Expected: FAIL, cannot resolve `../src/lib/format`.

- [ ] **Step 3: Write formatTimestamp**

```ts
// packages/kit/src/lib/format.ts

/**
 * A timestamp the contract sends as RFC 3339.
 *
 * Two failure modes, both deliberate. An unparseable value prints as it
 * arrived rather than as "Invalid Date", because the string the server sent is
 * the only useful thing to see when this goes wrong. An empty string prints as
 * an en dash rather than as the epoch: authsome sends "" for "never happened",
 * such as `banExpiresAt` on a user who is not banned, and 1 January 1970 is a
 * wrong answer dressed as a right one.
 *
 * Streaming's types marshal from Go `time.Time` and are never empty; authsome's
 * are strings and often are. One formatter handles both.
 */
export function formatTimestamp(value: string | undefined): string {
  if (!value) return "–"
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString()
}
```

- [ ] **Step 4: Run it**

Run: `pnpm --filter @forge-go/dashboard-kit test format`
Expected: PASS, four tests.

- [ ] **Step 5: Write the failing test for QueryBoundary**

```tsx
// packages/kit/test/query-boundary.test.tsx
import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { CommandAlert, QueryBoundary } from "../src/components/query-boundary"

const settled = { loading: false, refetch: () => {} }

describe("QueryBoundary", () => {
  it("announces a busy status while loading and renders no children", () => {
    render(
      <QueryBoundary title="Users" query={{ loading: true, refetch: () => {} }}>
        {() => <p>never</p>}
      </QueryBoundary>,
    )
    expect(screen.getByRole("status", { name: "Loading Users" })).toBeTruthy()
    expect(screen.queryByText("never")).toBeNull()
  })

  it("shows the error code alongside the message, and retries on demand", () => {
    const refetch = vi.fn()
    render(
      <QueryBoundary
        title="Users"
        query={{ loading: false, refetch, error: { code: "PERMISSION_DENIED", message: "nope" } }}
      >
        {() => <p>never</p>}
      </QueryBoundary>,
    )
    expect(screen.getByRole("alert").textContent).toContain("PERMISSION_DENIED")
    expect(screen.getByRole("alert").textContent).toContain("nope")
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(refetch).toHaveBeenCalledOnce()
  })

  it("says so visibly when a read settles with no error and no data", () => {
    render(
      <QueryBoundary title="Users" query={settled}>
        {() => <p>never</p>}
      </QueryBoundary>,
    )
    expect(screen.getByRole("status").textContent).toContain("Users returned no data.")
  })

  it("renders children with the data once it arrives", () => {
    render(
      <QueryBoundary title="Users" query={{ ...settled, data: { total: 2 } }}>
        {(data) => <p>{data.total} users</p>}
      </QueryBoundary>,
    )
    expect(screen.getByText("2 users")).toBeTruthy()
  })
})

describe("CommandAlert", () => {
  it("renders nothing when there is no error", () => {
    const { container } = render(<CommandAlert title="Ban failed" />)
    expect(container.firstChild).toBeNull()
  })

  it("leads with the server's sentence and follows with the code", () => {
    render(
      <CommandAlert
        title="Ban failed"
        error={{ code: "BAD_REQUEST", message: "user is already banned" }}
      />,
    )
    const alert = screen.getByRole("alert")
    expect(alert.textContent).toContain("user is already banned")
    expect(alert.textContent).toContain("BAD_REQUEST")
  })
})
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm --filter @forge-go/dashboard-kit test query-boundary`
Expected: FAIL, cannot resolve `../src/components/query-boundary`.

- [ ] **Step 7: Write QueryBoundary**

```tsx
// packages/kit/src/components/query-boundary.tsx
import type { ReactNode } from "react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@forge-go/dashboard-kit/components/card"
import { Skeleton } from "@forge-go/dashboard-kit/components/skeleton"
import { Button } from "@forge-go/dashboard-kit/components/button"

/**
 * The shape of a read, structurally.
 *
 * Declared here rather than imported from `@forge-go/dashboard-plugin`,
 * because kit does not depend on the plugin package and must not learn a
 * contract shape. The plugin package's `QueryState<T>` satisfies this without
 * either side importing the other.
 */
export interface QueryLike<T> {
  data?: T
  error?: { code: string; message: string }
  loading: boolean
  refetch: () => void
}

export interface QueryBoundaryProps<T> {
  /** Names the thing being loaded. Used in the busy label and the error card. */
  title: string
  query: QueryLike<T>
  skeletonRows?: number
  /** Rendered in place of children when the caller decides the data is empty. */
  empty?: ReactNode
  children: (data: T) => ReactNode
}

/**
 * The four states every read can be in: loading, failed, settled with nothing,
 * settled with data.
 *
 * Every page routes its read through here so none of them can invent its own
 * idea of what loading looks like, and so none of them can render a blank
 * pane. A page drawing nothing while a request is in flight is
 * indistinguishable from a page that is broken.
 *
 * The fourth state, settled with no error and no data, is unreachable through
 * a contract that answers the envelope correctly. It renders a visible message
 * anyway instead of `null`, for the same reason: if it ever happens, it should
 * say so.
 */
export function QueryBoundary<T>({
  title,
  query,
  skeletonRows = 3,
  empty,
  children,
}: QueryBoundaryProps<T>) {
  if (query.loading) {
    return (
      <div
        role="status"
        aria-busy="true"
        aria-label={`Loading ${title}`}
        className="flex flex-col gap-2"
      >
        {Array.from({ length: skeletonRows }, (_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    )
  }

  if (query.error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{title} unavailable</CardTitle>
          {/*
            The code travels with the message on purpose. NOT_FOUND against a
            read means the intent name is wrong; PERMISSION_DENIED means the
            signed-in operator may not read it; TRANSPORT means the request
            never reached the contract layer. Those want different people
            looking at them, and the message alone does not separate them.
          */}
          <CardDescription role="alert">
            {query.error.code}: {query.error.message}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" size="sm" onClick={query.refetch}>
            Retry
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (query.data === undefined) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {title} returned no data.
      </p>
    )
  }

  return <>{empty ?? children(query.data)}</>
}

export interface CommandAlertProps {
  error?: { code: string; message: string }
  /** What was being attempted. "Ban failed". */
  title: string
}

/**
 * How a failed write is shown to whoever triggered it.
 *
 * The message leads and the code follows in smaller type, which is the
 * opposite weighting to the error card above and is deliberate. A failed read
 * is usually somebody's bug. A failed write is usually the server telling the
 * operator something true about what they just tried: "invalid email or
 * password", "user is already banned". That sentence is the useful part, and
 * burying it behind an error code turns a wrong password into a crash.
 *
 * Renders nothing when there is no error, so callers drop it in
 * unconditionally.
 */
export function CommandAlert({ error, title }: CommandAlertProps) {
  if (!error) return null

  return (
    <div
      role="alert"
      className="flex flex-col gap-0.5 rounded-md border border-destructive/50 px-3 py-2 text-sm text-destructive"
    >
      <span className="font-medium">{title}</span>
      <span>{error.message}</span>
      <span className="font-mono text-xs opacity-70">{error.code}</span>
    </div>
  )
}
```

- [ ] **Step 8: Run the tests**

Run: `pnpm --filter @forge-go/dashboard-kit test query-boundary`
Expected: PASS, six tests.

- [ ] **Step 9: Commit**

```bash
git add packages/kit/src/components/query-boundary.tsx packages/kit/src/lib/format.ts packages/kit/test/query-boundary.test.tsx packages/kit/test/format.test.ts
git commit -m "feat(kit): add QueryBoundary, CommandAlert and formatTimestamp"
```

---

### Task 8: ResourceTable

**Files:**
- Create: `packages/kit/src/components/resource-table.tsx`
- Test: `packages/kit/test/resource-table.test.tsx`

**Interfaces:**
- Consumes: `Table`, `TableHeader`, `TableBody`, `TableHead`, `TableRow`, `TableCell`, `TableCaption` from `packages/kit/src/components/table.tsx`; `Button`; `EmptyState` from Task 1.
- Produces:
  - `ResourceTable<Row>`, `ResourceTableProps<Row>`
  - `Column<Row> { id: string; header: string; cell: (row: Row) => ReactNode; sortable?: boolean; align?: "start" | "end"; className?: string }`
  - `SortState { columnId: string; direction: "asc" | "desc" }`
  - `PaginationState { page: number; pageSize: number; total: number }`

Full prop list:

```ts
export interface ResourceTableProps<Row> {
  columns: Column<Row>[]
  rows: Row[]
  /** Stable identity per row. Never an array index. */
  rowKey: (row: Row) => string
  caption?: string
  emptyMessage: string
  emptyAction?: ReactNode
  /** Right-aligned per-row controls. Omit for a read-only table. */
  rowActions?: (row: Row) => ReactNode
  sort?: SortState
  onSortChange?: (sort: SortState) => void
  pagination?: PaginationState
  onPageChange?: (page: number) => void
}
```

**Deliberate narrowing from the spec.** The spec says this block carries "its own loading, empty and error states". It carries empty only. Loading and error belong to `QueryBoundary` from Task 7, which every page already wraps its read in, and two components owning the same two states means two ways for a page to disagree with itself about whether it is loading. Empty stays here because emptiness is a property of the rows, which is the thing this block is handed.

Sorting and pagination are controlled and this block sorts nothing. The server owns ordering and paging; a table that re-sorted the page it was given would silently sort one page of a ten-page result and look correct doing it.

- [ ] **Step 1: Write the failing test**

```tsx
// packages/kit/test/resource-table.test.tsx
import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { ResourceTable, type Column } from "../src/components/resource-table"

interface User {
  id: string
  email: string
  createdAt: string
}

const columns: Column<User>[] = [
  { id: "email", header: "Email", cell: (u) => u.email, sortable: true },
  { id: "createdAt", header: "Created", cell: (u) => u.createdAt },
]

const rows: User[] = [
  { id: "u1", email: "ada@example.com", createdAt: "2026-01-01" },
  { id: "u2", email: "grace@example.com", createdAt: "2026-02-01" },
]

function renderTable(props: Partial<React.ComponentProps<typeof ResourceTable<User>>> = {}) {
  return render(
    <ResourceTable<User>
      columns={columns}
      rows={rows}
      rowKey={(u) => u.id}
      emptyMessage="No users yet."
      {...props}
    />,
  )
}

describe("ResourceTable", () => {
  it("renders one row per record with every column's cell", () => {
    renderTable()
    expect(screen.getByText("ada@example.com")).toBeTruthy()
    expect(screen.getByText("grace@example.com")).toBeTruthy()
    expect(screen.getByText("2026-02-01")).toBeTruthy()
  })

  it("shows the empty state instead of a table body when there are no rows", () => {
    renderTable({ rows: [] })
    expect(screen.getByRole("status").textContent).toContain("No users yet.")
    expect(screen.queryByRole("table")).toBeNull()
  })

  it("makes only sortable headers pressable", () => {
    renderTable()
    expect(screen.getByRole("button", { name: /Email/ })).toBeTruthy()
    expect(screen.queryByRole("button", { name: /Created/ })).toBeNull()
  })

  it("asks for ascending on a fresh column and flips direction on the sorted one", () => {
    const onSortChange = vi.fn()
    const { rerender } = renderTable({ onSortChange })
    fireEvent.click(screen.getByRole("button", { name: /Email/ }))
    expect(onSortChange).toHaveBeenCalledWith({ columnId: "email", direction: "asc" })

    rerender(
      <ResourceTable<User>
        columns={columns}
        rows={rows}
        rowKey={(u) => u.id}
        emptyMessage="No users yet."
        sort={{ columnId: "email", direction: "asc" }}
        onSortChange={onSortChange}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: /Email/ }))
    expect(onSortChange).toHaveBeenLastCalledWith({ columnId: "email", direction: "desc" })
  })

  it("tells assistive tech which column is sorted and which way", () => {
    renderTable({ sort: { columnId: "email", direction: "desc" }, onSortChange: () => {} })
    const header = screen.getByRole("columnheader", { name: /Email/ })
    expect(header.getAttribute("aria-sort")).toBe("descending")
  })

  it("renders row actions when given them", () => {
    renderTable({ rowActions: (u) => <button>Ban {u.email}</button> })
    expect(screen.getByRole("button", { name: "Ban ada@example.com" })).toBeTruthy()
  })

  it("does not sort the rows it was handed", () => {
    renderTable({ sort: { columnId: "email", direction: "desc" }, onSortChange: () => {} })
    const cells = screen.getAllByRole("cell").map((c) => c.textContent)
    expect(cells.indexOf("ada@example.com")).toBeLessThan(cells.indexOf("grace@example.com"))
  })

  it("disables previous on the first page and next on the last", () => {
    const onPageChange = vi.fn()
    renderTable({ pagination: { page: 1, pageSize: 2, total: 4 }, onPageChange })
    expect((screen.getByRole("button", { name: "Previous page" }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "Next page" }))
    expect(onPageChange).toHaveBeenCalledWith(2)
  })

  it("renders no pagination controls when there is only one page", () => {
    renderTable({ pagination: { page: 1, pageSize: 10, total: 2 }, onPageChange: () => {} })
    expect(screen.queryByRole("button", { name: "Next page" })).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @forge-go/dashboard-kit test resource-table`
Expected: FAIL, cannot resolve `../src/components/resource-table`.

- [ ] **Step 3: Write the implementation**

```tsx
// packages/kit/src/components/resource-table.tsx
import type { ReactNode } from "react"
import { cn } from "@forge-go/dashboard-kit/lib/utils"
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@forge-go/dashboard-kit/components/table"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { EmptyState } from "@forge-go/dashboard-kit/components/empty-state"

export interface Column<Row> {
  id: string
  header: string
  cell: (row: Row) => ReactNode
  /** Renders the header as a button that reports sort intent. */
  sortable?: boolean
  align?: "start" | "end"
  className?: string
}

export interface SortState {
  columnId: string
  direction: "asc" | "desc"
}

export interface PaginationState {
  /** One-based, matching what an operator reads. */
  page: number
  pageSize: number
  total: number
}

export interface ResourceTableProps<Row> {
  columns: Column<Row>[]
  rows: Row[]
  /** Stable identity per row. Never an array index: rows reorder. */
  rowKey: (row: Row) => string
  caption?: string
  emptyMessage: string
  emptyAction?: ReactNode
  rowActions?: (row: Row) => ReactNode
  sort?: SortState
  onSortChange?: (sort: SortState) => void
  pagination?: PaginationState
  onPageChange?: (page: number) => void
}

const ARIA_SORT = { asc: "ascending", desc: "descending" } as const

/**
 * A list of records with sorting, row actions and pagination.
 *
 * It sorts nothing and pages nothing. Both are controlled, because the server
 * owns ordering and paging: a table that re-sorted the array it was handed
 * would sort one page of a ten-page result and look entirely correct doing it,
 * which is the worst way for this to be wrong.
 *
 * Loading and error are not here either. `QueryBoundary` owns those, and every
 * page already wraps its read in one. Empty is here because emptiness is a
 * property of the rows, and the rows are what this block is handed.
 */
export function ResourceTable<Row>({
  columns,
  rows,
  rowKey,
  caption,
  emptyMessage,
  emptyAction,
  rowActions,
  sort,
  onSortChange,
  pagination,
  onPageChange,
}: ResourceTableProps<Row>) {
  if (rows.length === 0) {
    return <EmptyState title={emptyMessage} action={emptyAction} />
  }

  // Clicking the column already sorted flips it. Clicking any other column
  // starts that one ascending, which is what somebody scanning a list expects
  // rather than inheriting the previous column's direction.
  function requestSort(columnId: string) {
    if (!onSortChange) return
    const direction =
      sort?.columnId === columnId && sort.direction === "asc" ? "desc" : "asc"
    onSortChange({ columnId, direction })
  }

  const pageCount = pagination
    ? Math.max(1, Math.ceil(pagination.total / pagination.pageSize))
    : 1

  return (
    <div className="flex flex-col gap-3">
      {/*
        Horizontal scroll lives on a wrapper, not on the page. A wide table
        must not make the whole dashboard scroll sideways.
      */}
      <div className="w-full overflow-x-auto">
        <Table>
          {caption && <TableCaption>{caption}</TableCaption>}
          <TableHeader>
            <TableRow>
              {columns.map((column) => (
                <TableHead
                  key={column.id}
                  aria-sort={
                    sort?.columnId === column.id
                      ? ARIA_SORT[sort.direction]
                      : undefined
                  }
                  className={cn(
                    column.align === "end" && "text-right",
                    column.className,
                  )}
                >
                  {column.sortable && onSortChange ? (
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => requestSort(column.id)}
                    >
                      {column.header}
                      {sort?.columnId === column.id
                        ? sort.direction === "asc"
                          ? " ↑"
                          : " ↓"
                        : ""}
                    </Button>
                  ) : (
                    column.header
                  )}
                </TableHead>
              ))}
              {rowActions && <TableHead className="text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={rowKey(row)}>
                {columns.map((column) => (
                  <TableCell
                    key={column.id}
                    className={cn(
                      column.align === "end" && "text-right",
                      column.className,
                    )}
                  >
                    {column.cell(row)}
                  </TableCell>
                ))}
                {rowActions && (
                  <TableCell className="flex justify-end gap-2">
                    {rowActions(row)}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/*
        No controls for a single page. A disabled Previous next to a disabled
        Next on a three-row table is furniture.
      */}
      {pagination && onPageChange && pageCount > 1 && (
        <nav
          aria-label="Pagination"
          className="flex items-center justify-between gap-2 text-sm text-muted-foreground"
        >
          <span>
            Page {pagination.page} of {pageCount}, {pagination.total} total
          </span>
          <span className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              aria-label="Previous page"
              disabled={pagination.page <= 1}
              onClick={() => onPageChange(pagination.page - 1)}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              aria-label="Next page"
              disabled={pagination.page >= pageCount}
              onClick={() => onPageChange(pagination.page + 1)}
            >
              Next
            </Button>
          </span>
        </nav>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @forge-go/dashboard-kit test resource-table`
Expected: PASS, nine tests.

If `getByRole("columnheader")` does not match, confirm `TableHead` renders a `<th>`. It does at `packages/kit/src/components/table.tsx`. If a test fails on the sort arrow being part of the accessible name, that is why the name queries use a regex rather than an exact string.

- [ ] **Step 5: Commit**

```bash
git add packages/kit/src/components/resource-table.tsx packages/kit/test/resource-table.test.tsx
git commit -m "feat(kit): add ResourceTable block"
```

---

### Task 9: SettingsForm

**Files:**
- Create: `packages/kit/src/components/settings-form.tsx`
- Test: `packages/kit/test/settings-form.test.tsx`

**Interfaces:**
- Consumes: `Input`, `Switch`, `NativeSelect`/`NativeSelectOption`, `Button`, `Badge`, `Label`, `EmptyState` from Task 1.
- Produces:
  - `SettingsForm`, `SettingsFormProps { fields: SettingFieldDescriptor[]; onSave: (changed: Record<string, unknown>) => void; saving?: boolean; emptyMessage?: string }`
  - `SettingFieldDescriptor { key, label, description?, type, value, options?, placeholder?, helpText?, section?, enforced?, readOnly?, required?, min?, max? }`
  - `SettingFieldType = "string" | "number" | "boolean" | "select" | "secret"`

Kit owns this descriptor type. The authsome plugin maps the contract's `SettingField` onto it, which is what keeps kit ignorant of the contract. Eighteen settings-only sub-plugins render through this one component, so it is the highest-leverage block in the plan.

`onSave` receives only changed keys. The contract's `settings.update` writes one key at a time, and an unchanged key resent is an override written where none existed, which changes the meaning of `isOverridden` on the next read.

- [ ] **Step 1: Write the failing test**

```tsx
// packages/kit/test/settings-form.test.tsx
import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import {
  SettingsForm,
  type SettingFieldDescriptor,
} from "../src/components/settings-form"

const fields: SettingFieldDescriptor[] = [
  { key: "min_length", label: "Minimum length", type: "number", value: 8, section: "Policy" },
  { key: "require_special", label: "Require a symbol", type: "boolean", value: true, section: "Policy" },
  {
    key: "algorithm",
    label: "Hash algorithm",
    type: "select",
    value: "argon2id",
    options: [
      { label: "argon2id", value: "argon2id" },
      { label: "bcrypt", value: "bcrypt" },
    ],
    section: "Policy",
  },
]

describe("SettingsForm", () => {
  it("renders an empty state when the namespace has no fields", () => {
    render(<SettingsForm fields={[]} onSave={() => {}} emptyMessage="Nothing to configure." />)
    expect(screen.getByRole("status").textContent).toContain("Nothing to configure.")
  })

  it("labels every control and shows the current value", () => {
    render(<SettingsForm fields={fields} onSave={() => {}} />)
    expect((screen.getByLabelText("Minimum length") as HTMLInputElement).value).toBe("8")
    expect((screen.getByLabelText("Hash algorithm") as HTMLSelectElement).value).toBe("argon2id")
  })

  it("groups fields under their section heading", () => {
    render(<SettingsForm fields={fields} onSave={() => {}} />)
    expect(screen.getByRole("heading", { name: "Policy" })).toBeTruthy()
  })

  it("keeps save disabled until something actually changes", () => {
    render(<SettingsForm fields={fields} onSave={() => {}} />)
    const save = screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText("Minimum length"), { target: { value: "12" } })
    expect(save.disabled).toBe(false)
  })

  it("submits only the keys that changed, with numbers as numbers", () => {
    const onSave = vi.fn()
    render(<SettingsForm fields={fields} onSave={onSave} />)
    fireEvent.change(screen.getByLabelText("Minimum length"), { target: { value: "12" } })
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
    expect(onSave).toHaveBeenCalledWith({ min_length: 12 })
  })

  it("disables an enforced field and says it is enforced", () => {
    render(
      <SettingsForm
        fields={[{ key: "mfa_required", label: "Require MFA", type: "boolean", value: true, enforced: true }]}
        onSave={() => {}}
      />,
    )
    expect((screen.getByLabelText("Require MFA") as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByText("enforced")).toBeTruthy()
  })

  it("masks a secret field so a shoulder-surfer does not read the value", () => {
    render(
      <SettingsForm
        fields={[{ key: "api_secret", label: "API secret", type: "secret", value: "hunter2" }]}
        onSave={() => {}}
      />,
    )
    expect(screen.getByLabelText("API secret").getAttribute("type")).toBe("password")
  })

  it("reverts every edit when reset is pressed", () => {
    render(<SettingsForm fields={fields} onSave={() => {}} />)
    fireEvent.change(screen.getByLabelText("Minimum length"), { target: { value: "12" } })
    fireEvent.click(screen.getByRole("button", { name: "Reset" }))
    expect((screen.getByLabelText("Minimum length") as HTMLInputElement).value).toBe("8")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @forge-go/dashboard-kit test settings-form`
Expected: FAIL, cannot resolve `../src/components/settings-form`.

- [ ] **Step 3: Write the implementation**

```tsx
// packages/kit/src/components/settings-form.tsx
import { useMemo, useState } from "react"
import { cn } from "@forge-go/dashboard-kit/lib/utils"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { Switch } from "@forge-go/dashboard-kit/components/switch"
import {
  NativeSelect,
  NativeSelectOption,
} from "@forge-go/dashboard-kit/components/native-select"
import { EmptyState } from "@forge-go/dashboard-kit/components/empty-state"

export type SettingFieldType =
  | "string"
  | "number"
  | "boolean"
  | "select"
  | "secret"

export interface SettingFieldDescriptor {
  key: string
  label: string
  description?: string
  type: SettingFieldType
  value: unknown
  options?: { label: string; value: string }[]
  placeholder?: string
  helpText?: string
  /** Groups fields under a heading. Ungrouped fields render first. */
  section?: string
  /** Set at a higher scope and not overridable here. Renders disabled. */
  enforced?: boolean
  readOnly?: boolean
  required?: boolean
  min?: number
  max?: number
}

export interface SettingsFormProps {
  fields: SettingFieldDescriptor[]
  /** Receives only the keys whose value differs from what was rendered. */
  onSave: (changed: Record<string, unknown>) => void
  saving?: boolean
  emptyMessage?: string
}

const UNGROUPED = " ungrouped"

function toFormValue(field: SettingFieldDescriptor): string | boolean {
  if (field.type === "boolean") return Boolean(field.value)
  return field.value === undefined || field.value === null
    ? ""
    : String(field.value)
}

/**
 * Renders one namespace of settings.
 *
 * The descriptor type is kit's own. Authsome's `SettingField` maps onto it in
 * the plugin, which is what keeps this component ignorant of any contract and
 * lets all eighteen settings-only sub-plugins share one renderer.
 *
 * Only changed keys reach `onSave`. `settings.update` writes one key at a
 * time, and resending an unchanged key writes an override where none existed,
 * which flips `isOverridden` on the next read and quietly detaches the value
 * from the default it was inheriting.
 */
export function SettingsForm({
  fields,
  onSave,
  saving = false,
  emptyMessage = "This namespace has no settings.",
}: SettingsFormProps) {
  const initial = useMemo(() => {
    const out: Record<string, string | boolean> = {}
    for (const field of fields) out[field.key] = toFormValue(field)
    return out
  }, [fields])

  const [draft, setDraft] = useState(initial)

  // Keys whose draft value differs from what the server last told us.
  const changedKeys = Object.keys(draft).filter(
    (key) => draft[key] !== initial[key],
  )

  const sections = useMemo(() => {
    const grouped = new Map<string, SettingFieldDescriptor[]>()
    for (const field of fields) {
      const name = field.section ?? UNGROUPED
      const bucket = grouped.get(name)
      if (bucket) bucket.push(field)
      else grouped.set(name, [field])
    }
    return [...grouped.entries()]
  }, [fields])

  if (fields.length === 0) return <EmptyState title={emptyMessage} />

  function submit() {
    const changed: Record<string, unknown> = {}
    for (const key of changedKeys) {
      const field = fields.find((f) => f.key === key)
      const raw = draft[key]
      // Numbers go back as numbers. The Go side unmarshals into a typed
      // setting, and "12" against an int field is a type error at the server,
      // surfaced to the operator as a validation failure they cannot act on.
      changed[key] =
        field?.type === "number" && typeof raw === "string" ? Number(raw) : raw
    }
    onSave(changed)
  }

  return (
    <div className="flex flex-col gap-6">
      {sections.map(([section, sectionFields]) => (
        <section key={section} className="flex flex-col gap-4">
          {section !== UNGROUPED && (
            <h2 className="text-sm font-medium">{section}</h2>
          )}
          {sectionFields.map((field) => (
            <Field
              key={field.key}
              field={field}
              value={draft[field.key]}
              onChange={(value) =>
                setDraft((prev) => ({ ...prev, [field.key]: value }))
              }
            />
          ))}
        </section>
      ))}

      <div className="flex items-center gap-2">
        <Button onClick={submit} disabled={saving || changedKeys.length === 0}>
          {saving ? "Saving" : "Save changes"}
        </Button>
        <Button
          variant="ghost"
          onClick={() => setDraft(initial)}
          disabled={saving || changedKeys.length === 0}
        >
          Reset
        </Button>
      </div>
    </div>
  )
}

function Field({
  field,
  value,
  onChange,
}: {
  field: SettingFieldDescriptor
  value: string | boolean
  onChange: (value: string | boolean) => void
}) {
  const disabled = Boolean(field.enforced || field.readOnly)
  const controlId = `setting-${field.key}`

  return (
    <div className={cn("flex flex-col gap-1.5", disabled && "opacity-70")}>
      <div className="flex items-center gap-2">
        <Label htmlFor={controlId}>{field.label}</Label>
        {field.enforced && <Badge variant="secondary">enforced</Badge>}
        {field.readOnly && !field.enforced && (
          <Badge variant="outline">read only</Badge>
        )}
      </div>

      {field.description && (
        <p className="text-xs text-muted-foreground">{field.description}</p>
      )}

      {field.type === "boolean" ? (
        <Switch
          id={controlId}
          checked={Boolean(value)}
          disabled={disabled}
          onCheckedChange={(checked: boolean) => onChange(checked)}
        />
      ) : field.type === "select" ? (
        <NativeSelect
          id={controlId}
          value={String(value)}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        >
          {(field.options ?? []).map((option) => (
            <NativeSelectOption key={option.value} value={option.value}>
              {option.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      ) : (
        <Input
          id={controlId}
          type={
            field.type === "number"
              ? "number"
              : field.type === "secret"
                ? "password"
                : "text"
          }
          value={String(value)}
          disabled={disabled}
          required={field.required}
          min={field.min}
          max={field.max}
          placeholder={field.placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      )}

      {field.helpText && (
        <p className="text-xs text-muted-foreground">{field.helpText}</p>
      )}
    </div>
  )
}
```

Note on `UNGROUPED`: it is a sentinel key for the "no section" bucket, and it uses a character no real section name can contain so a namespace that genuinely has a section called "ungrouped" does not collide with it.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @forge-go/dashboard-kit test settings-form`
Expected: PASS, eight tests.

Two things commonly need adjusting here, and neither is a reason to edit a vendored file. If `Switch` does not render an `<input>` that `getByLabelText` can find, check whether Base UI's switch wants `aria-labelledby` rather than a `htmlFor` pairing; wire it that way and keep the test querying by label text. If its change handler is not called `onCheckedChange`, confirm the real name against `packages/kit/src/components/switch.tsx`.

- [ ] **Step 5: Commit**

```bash
git add packages/kit/src/components/settings-form.tsx packages/kit/test/settings-form.test.tsx
git commit -m "feat(kit): add SettingsForm block"
```

---

### Task 10: Verify the kit still builds and nothing regressed

**Files:**
- Modify: none expected

The nine blocks are additive, but `pnpm typecheck` covers files the per-block test runs do not, and the eager bundle budget in `BASELINE.md` is a claim worth re-checking after adding nine components.

- [ ] **Step 1: Run the full kit test suite**

Run: `pnpm --filter @forge-go/dashboard-kit test`
Expected: PASS. The pre-existing suites (`app-sidebar`, `scope-switcher`, `nav-tree`, `nav-user`, `site-header`, `icons`, `smoke`) all still pass.

- [ ] **Step 2: Typecheck and lint**

Run: `pnpm --filter @forge-go/dashboard-kit typecheck && pnpm --filter @forge-go/dashboard-kit lint`
Expected: no errors. A `Column<Row>` generic that fails to infer at a call site shows up here rather than in a test.

- [ ] **Step 3: Confirm no new dependency was added**

Run: `git diff --stat packages/kit/package.json`
Expected: no output. Every block composes what is already vendored. If this shows a change, stop and re-read `BASELINE.md` before going further.

- [ ] **Step 4: Commit if anything needed fixing**

```bash
git add -A packages/kit
git commit -m "chore(kit): typecheck and lint fixes for the new blocks"
```

---

## Self-review

**Spec coverage.** Section 4 of the platform spec lists nine blocks. `empty-state` is Task 1, `page-header` Task 2, `stat-grid` Task 3, `detail-layout` and `description-list` Task 4, `confirm-dialog` Task 5, `filter-bar` Task 6, `query-boundary` Task 7, `resource-table` Task 8, `settings-form` Task 9. All nine covered. `formatTimestamp` is not in that list but the streaming spec's timestamp section requires it, and it ships in Task 7 alongside the block that replaces its current home.

**One deliberate deviation, recorded in Task 8.** The spec gives `resource-table` its own loading and error states. It gets empty only, because `QueryBoundary` owns loading and error, and two owners of one state is how a page ends up disagreeing with itself about whether it is loading.

**Type consistency.** `Column<Row>`, `SortState` and `PaginationState` are defined in Task 8 and used only there. `SettingFieldDescriptor` is defined in Task 9 and consumed by the authsome plans. `QueryLike<T>` is defined in Task 7 and structurally satisfied by the plugin package's `QueryState<T>`, which carries `data?`, `error?`, `loading` and `refetch`. `EmptyState` from Task 1 is consumed by Tasks 8 and 9, and both pass the `title` prop it declares.

**No placeholders.** Every step carries the code it needs. Where a vendored component's prop name might differ from what is written here, the step names the file to check and says not to edit it.
