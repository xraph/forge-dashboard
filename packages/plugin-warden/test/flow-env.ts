/**
 * What React Flow needs from the browser and jsdom does not have.
 *
 * Kept here, beside the tests that mount a canvas, and not in the shared
 * `../test-support/jsdom-setup.ts` that every plugin's vitest config loads:
 * only the plugins that draw a graph pay for it. A test file imports this for
 * its side effect.
 *
 * React Flow watches the container and each node through a ResizeObserver and
 * reads the container's transform through DOMMatrixReadOnly. Neither measures
 * anything real here: the nodes carry their size already, so a stub that never
 * reports is enough.
 */
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

class DOMMatrixReadOnlyStub {
  m22: number
  constructor(transform?: string) {
    const scale = transform?.match(/scale\(([0-9.]+)/)?.[1]
    this.m22 = scale ? Number(scale) : 1
  }
}

globalThis.ResizeObserver =
  ResizeObserverStub as unknown as typeof ResizeObserver
globalThis.DOMMatrixReadOnly =
  DOMMatrixReadOnlyStub as unknown as typeof DOMMatrixReadOnly
