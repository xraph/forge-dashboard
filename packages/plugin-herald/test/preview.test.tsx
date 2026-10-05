import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { ContractError, PluginProvider } from "@forge-go/dashboard-plugin"
import type { ScopedClient } from "@forge-go/dashboard-plugin"
import { countSms } from "../src/components/preview/sms"
import { buildSrcdoc } from "../src/components/preview/srcdoc"
import { DiagnosticsList, RenderedPreview } from "../src/components/preview/rendered-preview"
import { useRenderPreview } from "../src/components/preview/use-render-preview"
import type { PreviewResult, TemplatesRenderRequest } from "../src/wire"
import "./harness"

function result(over: Partial<Record<"subject" | "html" | "text" | "title", string>> = {}): PreviewResult {
  return {
    fields: (["subject", "html", "text", "title"] as const).map((field) => ({ field, output: over[field] ?? "", rendered: (over[field] ?? "") !== "" })),
    diagnostics: [],
  }
}

describe("countSms", () => {
  it("counts GSM-7 in 160s, then 153s once split", () => {
    expect(countSms("a".repeat(160))).toEqual({ encoding: "GSM-7", units: 160, segments: 1, perSegment: 160 })
    expect(countSms("a".repeat(161))).toEqual({ encoding: "GSM-7", units: 161, segments: 2, perSegment: 153 })
  })

  it("counts an extension character as two and keeps accented basics in GSM-7", () => {
    expect(countSms("€").units).toBe(2)
    expect(countSms("é").encoding).toBe("GSM-7")
  })

  it("switches to UCS-2 for anything outside the alphabet, in 70s then 67s", () => {
    expect(countSms("ł".repeat(70))).toEqual({ encoding: "UCS-2", units: 70, segments: 1, perSegment: 70 })
    expect(countSms("ł".repeat(71))).toEqual({ encoding: "UCS-2", units: 71, segments: 2, perSegment: 67 })
    expect(countSms("👋").units).toBe(2)
  })

  it("never splits a two-unit item across segments", () => {
    // 152 + 2 fills 154 > 153, so the euro moves to the second segment.
    expect(countSms("a".repeat(152) + "€" + "a".repeat(152))).toEqual({ encoding: "GSM-7", units: 306, segments: 3, perSegment: 153 })
    // 66 + 2 fills 68 > 67, so the surrogate pair moves to the second segment.
    expect(countSms("ł".repeat(66) + "👋" + "ł".repeat(66))).toEqual({ encoding: "UCS-2", units: 134, segments: 3, perSegment: 67 })
  })

  it("packs exact multiples without a spare segment", () => {
    expect(countSms("a".repeat(306)).segments).toBe(2)
    expect(countSms("a".repeat(307)).segments).toBe(3)
    expect(countSms("ł".repeat(134)).segments).toBe(2)
    expect(countSms("ł".repeat(135)).segments).toBe(3)
    expect(countSms("a".repeat(158) + "€").segments).toBe(1)
    expect(countSms("a".repeat(159) + "€").segments).toBe(2)
    expect(countSms("€".repeat(80)).segments).toBe(1)
    expect(countSms("€".repeat(81)).segments).toBe(2)
  })

  it("is zero segments for nothing", () => {
    expect(countSms("").segments).toBe(0)
  })
})

describe("buildSrcdoc", () => {
  it("opens with a CSP that blocks scripts and remote images", () => {
    const doc = buildSrcdoc('<img src="https://tracker.test/p.gif">', false)
    const csp = doc.indexOf("Content-Security-Policy")
    expect(csp).toBeGreaterThan(-1)
    expect(csp).toBeLessThan(doc.indexOf("<body>"))
    expect(doc).toContain("default-src 'none'")
    expect(doc).toContain("img-src data:;")
    expect(doc).not.toMatch(/script-src/)
  })

  it("lets remote images in only when asked", () => {
    expect(buildSrcdoc("", true)).toContain("img-src data: https: http:;")
  })
})

describe("RenderedPreview", () => {
  it("renders email HTML in an empty sandbox with the CSP, and loads remote images only on request", () => {
    render(<RenderedPreview channel="email" result={result({ subject: "Hi Ada", html: "<p>Hello</p>", text: "Hello" })} from={{ email: "no-reply@example.com", name: "Example" }} stale={false} />)
    const frame = screen.getByTitle("Rendered email") as HTMLIFrameElement
    expect(frame.getAttribute("sandbox")).toBe("")
    expect(frame.getAttribute("srcdoc")).toContain("img-src data:;")
    expect(screen.getByText("Hi Ada")).toBeTruthy()
    expect(screen.getByText(/no-reply@example.com/)).toBeTruthy()
    fireEvent.click(screen.getByRole("switch", { name: "Load remote images" }))
    expect(frame.getAttribute("srcdoc")).toContain("img-src data: https: http:;")
    expect(frame.getAttribute("sandbox")).toBe("")
  })

  it("counts SMS segments under the text", () => {
    render(<RenderedPreview channel="sms" result={result({ text: "a".repeat(161) })} stale={false} />)
    expect(screen.getByText("2 segments, GSM-7, 161 units (up to 153 per segment)")).toBeTruthy()
  })

  it("marks an out-of-date preview instead of passing it off as current", () => {
    render(<RenderedPreview channel="sms" result={result({ text: "old" })} stale />)
    expect(screen.getByRole("status").textContent).toMatch(/Out of date/)
  })

  it("keeps the out-of-date note mounted and empty while current, so it is announced when it appears", () => {
    const { container, rerender } = render(<RenderedPreview channel="sms" result={result({ text: "old" })} stale={false} />)
    const note = container.querySelector('p[role="status"]')
    expect(note).not.toBeNull()
    expect(note!.textContent).toBe("")
    rerender(<RenderedPreview channel="sms" result={result({ text: "old" })} stale />)
    expect(container.querySelector('p[role="status"]')).toBe(note)
    expect(note!.textContent).toMatch(/Out of date/)
  })

  it("lists problems with their field and position", () => {
    render(<DiagnosticsList diagnostics={[{ field: "html", line: 12, column: 5, severity: "error", kind: "parse", message: 'function "nosuch" not defined' }, { field: "", line: 0, column: 0, severity: "warning", kind: "unprovided", message: '"code" has no sample value' }]} />)
    expect(screen.getByText(/html 12:5/)).toBeTruthy()
    expect(screen.getByText(/function "nosuch" not defined/)).toBeTruthy()
    expect(screen.getByText(/"code" has no sample value/)).toBeTruthy()
  })
})

describe("useRenderPreview", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }))
  afterEach(() => vi.useRealTimers())

  function Probe({ request }: { request: TemplatesRenderRequest | null }) {
    const preview = useRenderPreview(request)
    const text = preview.result?.fields.find((f) => f.field === "text")?.output ?? "none"
    return (
      <p>
        {text}|{preview.stale ? "stale" : "fresh"}
      </p>
    )
  }

  it("renders 400ms after the last change, keeping the old output marked stale meanwhile", async () => {
    const calls: unknown[] = []
    const client = {
      extension: "herald",
      query: async (_intent: string, params?: Record<string, unknown>) => {
        calls.push(params)
        return result({ text: String((params?.content as { text: string }).text) })
      },
      command: async () => undefined,
    } as unknown as ScopedClient
    const req = (text: string): TemplatesRenderRequest => ({ content: { subject: "", html: "", text, title: "" }, data: {} })
    const view = render(
      <PluginProvider client={client}>
        <Probe request={req("one")} />
      </PluginProvider>
    )
    await act(async () => {
      vi.advanceTimersByTime(400)
    })
    await waitFor(() => expect(screen.getByText("one|fresh")).toBeTruthy())
    view.rerender(
      <PluginProvider client={client}>
        <Probe request={req("two")} />
      </PluginProvider>
    )
    expect(screen.getByText("one|stale")).toBeTruthy()
    await act(async () => {
      vi.advanceTimersByTime(399)
    })
    expect(calls).toHaveLength(1)
    await act(async () => {
      vi.advanceTimersByTime(1)
    })
    await waitFor(() => expect(screen.getByText("two|fresh")).toBeTruthy())
  })
})

describe("buildSrcdoc with hostile markup", () => {
  const parse = (doc: string) => new DOMParser().parseFromString(doc, "text/html")

  it("keeps the CSP first even when the template closes the head and opens its own", () => {
    const doc = buildSrcdoc('</head><meta http-equiv="Content-Security-Policy" content="default-src *"><script>alert(1)</script>', false)
    expect(doc.startsWith('<!doctype html><html><head><meta http-equiv="Content-Security-Policy"')).toBe(true)
    const first = parse(doc).head.firstElementChild
    expect(first?.tagName).toBe("META")
    expect(first?.getAttribute("content")).toContain("default-src 'none'")
  })

  it("drops link elements, which the CSP does not cover (preconnect, dns-prefetch)", () => {
    const doc = buildSrcdoc(
      '<link rel="preconnect" href="https://tracker.test"><link rel="dns-prefetch" href="//tracker.test"><link rel="stylesheet" href="https://tracker.test/a.css"><p>Hi</p>',
      false
    )
    expect(doc).not.toMatch(/<link/i)
    expect(doc).not.toContain("tracker.test")
    expect(parse(doc).body.textContent).toContain("Hi")
  })

  it("keeps a head-level style block", () => {
    const doc = buildSrcdoc("<html><head><style>p { color: red }</style></head><body><p>Hi</p></body></html>", false)
    expect(doc).toContain("p { color: red }")
    expect(doc).toContain("<p>Hi</p>")
    expect(parse(doc).head.firstElementChild?.tagName).toBe("META")
  })
})

describe("RenderedPreview never injects markup into the dashboard", () => {
  it("shows hostile output as text in every non-email channel and only in an iframe attribute for email", () => {
    const hostile = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script>'
    const { container, rerender } = render(<RenderedPreview channel="sms" result={result({ text: hostile })} stale={false} />)
    expect(container.querySelector("img, script")).toBeNull()
    rerender(<RenderedPreview channel="push" result={result({ title: hostile, text: hostile })} stale={false} />)
    expect(container.querySelector("img, script")).toBeNull()
    rerender(<RenderedPreview channel="email" result={result({ subject: hostile, html: hostile, text: hostile })} stale={false} />)
    expect(container.querySelector("img, script")).toBeNull()
    expect(container.querySelectorAll("iframe")).toHaveLength(1)
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined()
  })
})

describe("useRenderPreview ordering and failure", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }))
  afterEach(() => vi.useRealTimers())

  function Probe({ request }: { request: TemplatesRenderRequest | null }) {
    const preview = useRenderPreview(request, 50)
    const text = preview.result?.fields.find((f) => f.field === "text")?.output ?? "none"
    return (
      <p>
        {text}|{preview.stale ? "stale" : "fresh"}|{preview.error?.message ?? "ok"}
      </p>
    )
  }
  const req = (text: string): TemplatesRenderRequest => ({ content: { subject: "", html: "", text, title: "" }, data: {} })

  it("drops an older answer that arrives after a newer request was sent", async () => {
    const pending: Record<string, (r: PreviewResult) => void> = {}
    const client = {
      extension: "herald",
      query: (_i: string, params?: Record<string, unknown>) => new Promise<PreviewResult>((resolve) => (pending[(params?.content as { text: string }).text] = resolve)),
      command: async () => undefined,
    } as unknown as ScopedClient
    const view = render(
      <PluginProvider client={client}>
        <Probe request={req("one")} />
      </PluginProvider>
    )
    await waitFor(() => expect(pending.one).toBeTruthy())
    view.rerender(
      <PluginProvider client={client}>
        <Probe request={req("two")} />
      </PluginProvider>
    )
    await act(async () => {
      vi.advanceTimersByTime(50)
    })
    await waitFor(() => expect(pending.two).toBeTruthy())
    await act(async () => {
      pending.two(result({ text: "two" }))
    })
    await waitFor(() => expect(screen.getByText("two|fresh|ok")).toBeTruthy())
    await act(async () => {
      pending.one(result({ text: "one" }))
    })
    expect(screen.getByText("two|fresh|ok")).toBeTruthy()
  })

  it("keeps the last result and reports the error when a render fails", async () => {
    let fail = false
    const client = {
      extension: "herald",
      query: async (_i: string, params?: Record<string, unknown>) => {
        if (fail) throw new ContractError("INVALID", "template does not parse")
        return result({ text: String((params?.content as { text: string }).text) })
      },
      command: async () => undefined,
    } as unknown as ScopedClient
    const view = render(
      <PluginProvider client={client}>
        <Probe request={req("one")} />
      </PluginProvider>
    )
    await waitFor(() => expect(screen.getByText("one|fresh|ok")).toBeTruthy())
    fail = true
    view.rerender(
      <PluginProvider client={client}>
        <Probe request={req("two")} />
      </PluginProvider>
    )
    await act(async () => {
      vi.advanceTimersByTime(50)
    })
    await waitFor(() => expect(screen.getByText("one|stale|template does not parse")).toBeTruthy())
  })

  it("shows nothing once the request goes back to null", async () => {
    const client = {
      extension: "herald",
      query: async () => result({ text: "one" }),
      command: async () => undefined,
    } as unknown as ScopedClient
    const view = render(
      <PluginProvider client={client}>
        <Probe request={req("one")} />
      </PluginProvider>
    )
    await waitFor(() => expect(screen.getByText("one|fresh|ok")).toBeTruthy())
    view.rerender(
      <PluginProvider client={client}>
        <Probe request={null} />
      </PluginProvider>
    )
    expect(screen.getByText("none|fresh|ok")).toBeTruthy()
  })
})
