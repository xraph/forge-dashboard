import { expect } from "vitest"

const SKIP = new Set(["return", "alternate", "stateNode", "_owner", "_store", "_debugOwner", "_debugStack", "_debugTask", "_debugInfo", "ref"])

/**
 * Does `needle` appear in any string reachable from `root`, without following
 * fiber links?
 *
 * Iterative, with no depth cap. A hook list is a linked list (hook.next), so
 * hook N sits N levels down: any cap smaller than a form's hook count leaves
 * its later state unchecked. Every object is expanded exactly once, so
 * nothing is skipped because it was first met by a path that gave up early,
 * and cycles end.
 */
function reaches(root: unknown, needle: string, seen: WeakSet<object>): boolean {
  const stack: unknown[] = [root]
  while (stack.length > 0) {
    const value = stack.pop()
    if (typeof value === "string") {
      if (value.includes(needle)) return true
      continue
    }
    if (value === null || typeof value !== "object" || value instanceof Node || seen.has(value)) continue
    seen.add(value)
    if (value instanceof Map) stack.push(...value.keys(), ...value.values())
    else if (value instanceof Set) stack.push(...value)
    else for (const [k, v] of Object.entries(value)) if (!SKIP.has(k)) stack.push(v)
  }
  return false
}

/**
 * Walks the mounted React tree and asserts `needle` is in no component's
 * props or hook state. The DOM check cannot see React state; this can.
 */
export function expectNotInReactState(container: HTMLElement, needle: string) {
  const key = Object.keys(container).find((k) => k.startsWith("__reactContainer$"))
  expect(key, "React root fiber not found").toBeTruthy()
  type Fiber = { child: Fiber | null; sibling: Fiber | null; memoizedState: unknown; memoizedProps: unknown; stateNode: unknown }
  // The container's fiber may be the alternate, with no children: the live tree hangs off the FiberRoot.
  const hostRoot = (container as unknown as Record<string, Fiber>)[key!]
  const root = (hostRoot.stateNode as { current: Fiber }).current
  const seen = new WeakSet<object>()
  let visited = 0
  const walk = (fiber: Fiber | null) => {
    for (let f = fiber; f; f = f.sibling) {
      visited++
      expect(reaches(f.memoizedProps, needle, seen), "needle found in a component's props").toBe(false)
      expect(reaches(f.memoizedState, needle, seen), "needle found in a component's state").toBe(false)
      walk(f.child)
    }
  }
  walk(root)
  expect(visited, "the walk must reach the components, not just the root").toBeGreaterThan(1)
}
