import { act, render, renderHook, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import {
  NavigationProvider,
  PluginLink,
  mountPath,
} from "@forge-go/dashboard-plugin"
import type {
  NavigateOptions,
  PluginLinkProps,
} from "@forge-go/dashboard-plugin"
import keysmithPlugin from "../src/index"
import {
  KEYSMITH_MOUNT,
  rotationsForKey,
  usageForKey,
  useKeyIdParam,
  useSetKeyIdParam,
} from "../src/key-filter"

afterEach(() => {
  window.history.replaceState(null, "", "/")
})

describe("the links that carry a key", () => {
  it("start at the plugin's real mount point", () => {
    expect(`${KEYSMITH_MOUNT}/rotations`).toBe(
      mountPath(keysmithPlugin, "/rotations")
    )
    expect(`${KEYSMITH_MOUNT}/usage`).toBe(mountPath(keysmithPlugin, "/usage"))
  })

  it("name the key in the query and nothing else", () => {
    expect(rotationsForKey("akey_billing")).toBe(
      "/@keysmith/rotations?keyId=akey_billing"
    )
    expect(usageForKey("akey_billing")).toBe(
      "/@keysmith/usage?keyId=akey_billing"
    )
  })

  it("pass through the host's resolver untouched, so its carried search is not tacked on", () => {
    // The host appends the current search to every scope-relative path. On a
    // page already at ?keyId=akey_other, "/usage?keyId=akey_billing" would
    // come out with two query strings.
    const nav = {
      Link: ({ to, children }: PluginLinkProps) => <a href={to}>{children}</a>,
      navigate: () => {},
      resolve: (to: string) => `/@keysmith${to}?keyId=akey_other`,
    }
    render(
      <NavigationProvider value={nav}>
        <PluginLink to={usageForKey("akey_billing")}>Open usage</PluginLink>
      </NavigationProvider>
    )
    expect(
      screen.getByRole("link", { name: "Open usage" }).getAttribute("href")
    ).toBe("/@keysmith/usage?keyId=akey_billing")
  })

  it("encode an id with characters that mean something in a URL", () => {
    const href = usageForKey("a&b=c?d#e")
    expect(
      new URLSearchParams(href.slice(href.indexOf("?"))).get("keyId")
    ).toBe("a&b=c?d#e")
  })
})

describe("useKeyIdParam", () => {
  it("reads keyId from the address, and is empty without one", () => {
    window.history.replaceState(null, "", "/@keysmith/usage?keyId=akey_billing")
    expect(renderHook(() => useKeyIdParam()).result.current).toBe(
      "akey_billing"
    )

    window.history.replaceState(null, "", "/@keysmith/usage")
    expect(renderHook(() => useKeyIdParam()).result.current).toBe("")
  })

  it("treats a blank keyId as none", () => {
    window.history.replaceState(null, "", "/@keysmith/usage?keyId=%20%20")
    expect(renderHook(() => useKeyIdParam()).result.current).toBe("")
  })

  it("follows the browser's back and forward", () => {
    window.history.replaceState(null, "", "/@keysmith/usage")
    const { result } = renderHook(() => useKeyIdParam())
    expect(result.current).toBe("")

    act(() => {
      window.history.replaceState(null, "", "/@keysmith/usage?keyId=akey_other")
      window.dispatchEvent(new PopStateEvent("popstate"))
    })
    expect(result.current).toBe("akey_other")
  })
})

/**
 * useSetKeyIdParam under a router that records where it was sent, and how,
 * and, like react-router, writes the address as it goes.
 */
function setterUnder(path: "/rotations" | "/usage") {
  const sent: string[] = []
  const options: (NavigateOptions | undefined)[] = []
  const nav = {
    Link: ({ to, children }: PluginLinkProps) => <a href={to}>{children}</a>,
    navigate: (to: string, opts?: NavigateOptions) => {
      sent.push(to)
      options.push(opts)
      if (opts?.replace) window.history.replaceState(null, "", to)
      else window.history.pushState(null, "", to)
    },
    resolve: (to: string) => `/@keysmith${to}`,
  }
  const { result } = renderHook(
    () => ({ set: useSetKeyIdParam(path), keyId: useKeyIdParam() }),
    {
      wrapper: ({ children }) => (
        <NavigationProvider value={nav}>{children}</NavigationProvider>
      ),
    }
  )
  return { result, sent, options }
}

describe("useSetKeyIdParam", () => {
  it("goes through the router to the absolute page, so the host sees the new key", () => {
    window.history.replaceState(null, "", "/@keysmith/usage")
    const { result, sent } = setterUnder("/usage")
    act(() => result.current.set("akey_partner"))
    expect(sent).toEqual(["/@keysmith/usage?keyId=akey_partner"])
    expect(result.current.keyId).toBe("akey_partner")
  })

  it("replaces the entry, so Back leaves the page instead of stepping through keys", () => {
    window.history.replaceState(null, "", "/@keysmith/usage")
    const length = window.history.length
    const { result, sent, options } = setterUnder("/usage")
    act(() => result.current.set("akey_partner"))
    act(() => result.current.set("akey_billing"))
    act(() => result.current.set(""))
    expect(sent).toEqual([
      "/@keysmith/usage?keyId=akey_partner",
      "/@keysmith/usage?keyId=akey_billing",
      "/@keysmith/usage",
    ])
    expect(options).toEqual([
      { replace: true },
      { replace: true },
      { replace: true },
    ])
    expect(window.history.length).toBe(length)
  })

  it("leaves every other query parameter where it was", () => {
    window.history.replaceState(
      null,
      "",
      "/@keysmith/rotations?env=prod&keyId=akey_a"
    )
    const { result, sent } = setterUnder("/rotations")
    act(() => result.current.set("akey_b"))
    const search = new URLSearchParams(sent[0]!.slice(sent[0]!.indexOf("?")))
    expect(search.get("env")).toBe("prod")
    expect(search.get("keyId")).toBe("akey_b")
  })

  it("drops keyId entirely for every key, not keyId=", () => {
    window.history.replaceState(
      null,
      "",
      "/@keysmith/rotations?env=prod&keyId=akey_a"
    )
    const first = setterUnder("/rotations")
    act(() => first.result.current.set(""))
    expect(first.sent).toEqual(["/@keysmith/rotations?env=prod"])

    window.history.replaceState(null, "", "/@keysmith/usage?keyId=akey_a")
    const second = setterUnder("/usage")
    act(() => second.result.current.set(""))
    expect(second.sent).toEqual(["/@keysmith/usage"])
    expect(second.result.current.keyId).toBe("")
  })
})
