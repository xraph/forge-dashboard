import type { ReactNode } from "react"
import { useQuery } from "@forge-go/dashboard-plugin"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { TetherBoundary } from "./components/boundary"
import type { SessionInfo } from "./types"

/**
 * Who the dashboard user is to Tether. An operator reaches every tenant; a
 * tenant user reaches the one tenant their session names, and the server
 * refuses the rest. The answer does not change during a session, so every
 * page shares the one cached read.
 */
export function useSession() {
  return useQuery<SessionInfo>("session.info")
}

/**
 * Renders `children` once `session.info` has answered. Until then, and when
 * it fails (a user with no tenant is PERMISSION_DENIED), it draws the page's
 * own header over the boundary, so the refusal has a page around it.
 */
export function SessionGate({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: (session: SessionInfo) => ReactNode
}) {
  const session = useSession()
  if (session.data) return <>{children(session.data)}</>

  return (
    <section className="flex min-w-0 flex-col gap-4">
      <PageHeader title={title} description={description} />
      <TetherBoundary title={title} query={session} skeletonRows={3}>
        {() => null}
      </TetherBoundary>
    </section>
  )
}
