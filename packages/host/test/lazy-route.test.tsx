import { describe, expect, it } from "vitest"
import { lazy, Suspense } from "react"
import { render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter, Route, Routes, useParams } from "react-router"

/**
 * A plugin page delivered as its own chunk.
 *
 * This is the whole reason the host wraps every page in Suspense. Without it
 * `element: lazy(() => import("./pages/editor"))` throws the moment the chunk
 * is still in flight, so every page had to be a static import and the shell
 * was one eager bundle. That is fine until a plugin wants a code editor or a
 * graph canvas, at which point everyone pays for it on first paint whether
 * they open that page or not.
 */
function RouteParamsLike({
  page: Page,
}: {
  page: React.ComponentType<{ params: Record<string, string | undefined> }>
}) {
  const params = useParams()
  return (
    <Suspense fallback={<p role="status">Loading…</p>}>
      <Page params={params} />
    </Suspense>
  )
}

describe("a lazily loaded plugin page", () => {
  it("shows a fallback, then the page, without throwing", async () => {
    let resolvePage: (m: {
      default: React.ComponentType<{
        params: Record<string, string | undefined>
      }>
    }) => void = () => {}
    const pending = new Promise<{
      default: React.ComponentType<{
        params: Record<string, string | undefined>
      }>
    }>((r) => {
      resolvePage = r
    })
    const LazyPage = lazy(() => pending)

    render(
      <MemoryRouter initialEntries={["/policies/p1"]}>
        <Routes>
          <Route
            path="/policies/:id"
            element={<RouteParamsLike page={LazyPage} />}
          />
        </Routes>
      </MemoryRouter>
    )

    // The chunk has not arrived. Before Suspense existed above the page this
    // was an exception, not a spinner.
    expect(screen.getByRole("status")).toBeTruthy()

    resolvePage({
      default: ({ params }) => <p>policy {params.id}</p>,
    })

    // And the page still gets its route params once it lands, which is the
    // part a naive Suspense placement loses.
    await waitFor(() => expect(screen.getByText("policy p1")).toBeTruthy())
    expect(screen.queryByRole("status")).toBeNull()
  })

  it("lets a page that does not suspend render synchronously", () => {
    // Suspense is transparent when nothing suspends, so wrapping every page
    // costs the ordinary ones nothing. Worth pinning: if this ever starts
    // deferring, every page in the dashboard gains a flash of spinner.
    const Plain = ({
      params,
    }: {
      params: Record<string, string | undefined>
    }) => <p>plain {params.id}</p>
    render(
      <MemoryRouter initialEntries={["/policies/p2"]}>
        <Routes>
          <Route
            path="/policies/:id"
            element={<RouteParamsLike page={Plain} />}
          />
        </Routes>
      </MemoryRouter>
    )
    expect(screen.getByText("plain p2")).toBeTruthy()
    expect(screen.queryByRole("status")).toBeNull()
  })
})
