import { expect } from "vitest"

const SKIP = new Set(["return", "alternate", "stateNode", "_owner", "_store", "_debugOwner", "_debugStack", "_debugTask", "_debugInfo", "ref"])

/** Does `needle` appear in any string reachable from `value`, without following fiber links? */
function reaches(value: unknown, needle: string, seen: WeakSet<object>, depth: number): boolean {
  if (typeof value === "string") return value.includes(needle)
  if (value === null || typeof value !== "object" || depth > 12) return false
  if (value instanceof Node || seen.has(value)) return false
  seen.add(value)
  const children = value instanceof Map ? [...value.keys(), ...value.values()] : value instanceof Set ? [...value] : Object.entries(value).filter(([k]) => !SKIP.has(k)).map(([, v]) => v)
  return children.some((c) => reaches(c, needle, seen, depth + 1))
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
      expect(reaches(f.memoizedProps, needle, seen, 0), "needle found in a component's props").toBe(false)
      expect(reaches(f.memoizedState, needle, seen, 0), "needle found in a component's state").toBe(false)
      walk(f.child)
    }
  }
  walk(root)
  expect(visited, "the walk must reach the components, not just the root").toBeGreaterThan(3)
}
