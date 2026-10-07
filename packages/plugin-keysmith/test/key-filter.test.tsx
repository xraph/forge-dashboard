import { act, render, renderHook, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import {
  NavigationProvider,
  PluginLink,
  mountPath,
} from "@forge-go/dashboard-plugin"
import type { PluginLinkProps } from "@forge-go/dashboard-plugin"
import keysmithPlugin from "../src/index"
import {
  KEYSMITH_MOUNT,
  replaceKeyIdParam,
  rotationsForKey,
  usageForKey,
  useKeyIdParam,
} from "../src/key-filter"

afterEach(() => {
  window.history.replaceState(null, "", "/")
})

describe("the links that carry a key", () => {
  it("start at the plugin's real mount point", () => {
    expect(`${KEYSMITH_MOUNT}/rotations`).toBe(mountPath(keysmithPlugin, "/rotations"))
    expect(`${KEYSMITH_MOUNT}/usage`).toBe(mountPath(keysmithPlugin, "/usage"))
  })

  it("name the key in the query and nothing else", () => {
    expect(rotationsForKey("akey_billing")).toBe("/@keysmith/rotations?keyId=akey_billing")
    expect(usageForKey("akey_billing")).toBe("/@keysmith/usage?keyId=akey_billing")
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
      </NavigationProvider>,
    )
    expect(screen.getByRole("link", { name: "Open usage" }).getAttribute("href")).toBe(
      "/@keysmith/usage?keyId=akey_billing",
    )
  })

  it("encode an id with characters that mean something in a URL", () => {
    const href = usageForKey("a&b=c?d#e")
    expect(new URLSearchParams(href.slice(href.indexOf("?"))).get("keyId")).toBe("a&b=c?d#e")
  })
})

describe("useKeyIdParam", () => {
  it("reads keyId from the address, and is empty without one", () => {
    window.history.replaceState(null, "", "/@keysmith/usage?keyId=akey_billing")
    expect(renderHook(() => useKeyIdParam()).result.current).toBe("akey_billing")

    window.history.replaceState(null, "", "/@keysmith/usage")
    expect(renderHook(() => useKeyIdParam()).result.current).toBe("")
  })

  it("treats a blank keyId as none", () => {
    window.history.replaceState(null, "", "/@keysmith/usage?keyId=%20%20")
    expect(renderHook(() => useKeyIdParam()).result.current).toBe("")
  })

  it("follows a replace and the browser's back and forward", () => {
    window.history.replaceState(null, "", "/@keysmith/usage")
    const { result } = renderHook(() => useKeyIdParam())
    expect(result.current).toBe("")

    act(() => replaceKeyIdParam("akey_partner"))
    expect(result.current).toBe("akey_partner")

    act(() => {
      window.history.replaceState(null, "", "/@keysmith/usage?keyId=akey_other")
      window.dispatchEvent(new PopStateEvent("popstate"))
    })
    expect(result.current).toBe("akey_other")
  })
})

describe("replaceKeyIdParam", () => {
  it("replaces the entry rather than adding one, and keeps the router's state", () => {
    window.history.replaceState({ idx: 3, key: "k" }, "", "/@keysmith/usage")
    const length = window.history.length
    replaceKeyIdParam("akey_partner")
    expect(window.location.pathname).toBe("/@keysmith/usage")
    expect(window.location.search).toBe("?keyId=akey_partner")
    expect(window.history.length).toBe(length)
    expect(window.history.state).toEqual({ idx: 3, key: "k" })
  })

  it("leaves every other query parameter where it was", () => {
    window.history.replaceState(null, "", "/@keysmith/usage?env=prod#top")
    replaceKeyIdParam("akey_partner")
    const search = new URLSearchParams(window.location.search)
    expect(search.get("env")).toBe("prod")
    expect(search.get("keyId")).toBe("akey_partner")
    expect(window.location.hash).toBe("#top")
  })

  it("drops keyId entirely for every key, not keyId=", () => {
    window.history.replaceState(null, "", "/@keysmith/usage?env=prod&keyId=akey_partner")
    replaceKeyIdParam("")
    expect(window.location.search).toBe("?env=prod")

    window.history.replaceState(null, "", "/@keysmith/usage?keyId=akey_partner")
    replaceKeyIdParam("")
    expect(window.location.search).toBe("")
    expect(window.location.href.endsWith("/@keysmith/usage")).toBe(true)
  })
})
