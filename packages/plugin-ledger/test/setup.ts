// jsdom has no ResizeObserver, and Recharts' ResponsiveContainer asks for one
// on mount. A no-op is enough: chart tests assert on the table view and the
// labels, never on SVG geometry, which jsdom cannot lay out anyway.
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (!("ResizeObserver" in globalThis)) {
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = NoopResizeObserver
}
