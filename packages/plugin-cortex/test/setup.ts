import { afterEach } from "vitest"
import { cleanup } from "@testing-library/react"
import { queryStore } from "@forge-go/dashboard-plugin"
afterEach(() => {
  cleanup()
  queryStore.clear()
})
