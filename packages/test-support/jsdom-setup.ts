/**
 * Shared vitest setup for every jsdom package in this repo.
 *
 * Wired in by relative path from packages/kit, apps/shell and apps/playground.
 * It deliberately has no package.json: pnpm's `packages/*` workspace glob skips
 * directories without one, so this costs no workspace entry, no dependency edge
 * and no lockfile change. packages/kit's tsconfig includes it, so it is still
 * typechecked.
 *
 * Opening any base-ui popup (DropdownMenu, Select, Popover, ...) under jsdom
 * used to stall the event loop for tens of seconds — a `setTimeout(…, 500)`
 * scheduled right after the click was measured taking 232,592ms. The cause is
 * a mutual recursion between two of our dev dependencies, not anything in this
 * package, and not floating-ui's positioning math:
 *
 *   1. floating-ui probes for the top layer by selector, in `isTopLayer`:
 *        try { if (el.matches(':popover-open')) return true } catch {}
 *        try { return el.matches(':modal') } catch { return false }
 *      It runs on every `computePosition`, for several elements each time.
 *
 *   2. jsdom implements `Element.prototype.matches` by delegating to nwsapi.
 *
 *   3. nwsapi resolves `:modal`/`:popover-open`/`:fullscreen` through its
 *      `matchesNative` helper, which is written on the assumption that a real
 *      native matcher sits behind it ("use the native selector state when it
 *      is available"). Under jsdom there is no native matcher — nwsapi *is*
 *      `Element.prototype.matches` — so `matchesNative` re-enters nwsapi and
 *      recurses until V8 throws RangeError. nwsapi swallows that in a
 *      try/catch and returns false.
 *
 * So every probe costs a full stack-overflow unwind. Measured on one bare
 * menu open, tallied by selector:
 *
 *     149.07s   n=34   matches(':modal')
 *       0.17s   n=34   matches(':popover-open')
 *
 * `:modal` is the whole bill. `:popover-open` is cheap only by luck — nwsapi
 * checks `hasAttribute('popover')` first and short-circuits before it can
 * recurse. `:modal` has no such guard, and it recurses twice: once for
 * `:modal` itself, then again through `isFullscreen`. We still intercept all
 * four top-layer pseudo-classes, because which of them happen to have a cheap
 * guard today is an nwsapi implementation detail, not a contract.
 *
 * Answering these four pseudo-classes directly is not a shortcut that fakes a
 * result — jsdom 25 ships no top layer whatsoever (no `dialog.showModal`, no
 * popover attribute, no Fullscreen API), so `false` is the correct answer for
 * every element and every one of these selectors. We only compare whole
 * selector strings, which is the exact shape floating-ui passes; a compound
 * selector that merely contains one of these still goes to nwsapi unchanged.
 *
 * With this in place the same repro drops from 232,592ms to 542ms.
 */
const NO_TOP_LAYER_IN_JSDOM = new Set([
  ":popover-open",
  ":modal",
  ":fullscreen",
  ":picture-in-picture",
])

const nwsapiMatches = Element.prototype.matches

// Cast rather than annotate: the DOM lib types `matches` as a set of overloads
// whose tag-name forms are type predicates (`this is HTMLElementTagNameMap[K]`),
// which a plain `(selectors: string) => boolean` cannot satisfy. The runtime
// contract is the one that matters here, and it is unchanged.
Element.prototype.matches = function matches(this: Element, selectors: string) {
  if (NO_TOP_LAYER_IN_JSDOM.has(selectors)) {
    return false
  }
  return nwsapiMatches.call(this, selectors)
} as typeof Element.prototype.matches
