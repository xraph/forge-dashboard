import { describe, expect, it } from "vitest"
import { act, fireEvent, screen, waitFor } from "@testing-library/react"
import { renderPage, stubClient } from "./harness"
import { setActiveStore, useActiveStore, withStore } from "../src/store"
import { StorePicker } from "../src/components/store-picker"

const MULTI = {
  mode: "multi",
  stores: [
    { name: "primary", driver: "local", isDefault: true },
    { name: "archive", driver: "s3", isDefault: false },
  ],
}

function Probe() {
  const store = useActiveStore()
  return (
    <div>
      <StorePicker />
      <output aria-label="active store">{store === "" ? "(default)" : store}</output>
    </div>
  )
}

describe("withStore", () => {
  it("leaves store out for the default and adds it otherwise", () => {
    expect(withStore("", { bucket: "b" })).toEqual({ bucket: "b" })
    expect("store" in withStore("", {})).toBe(false)
    expect(withStore("archive", { bucket: "b" })).toEqual({ bucket: "b", store: "archive" })
  })
})

describe("StorePicker", () => {
  it("renders nothing for a single store", async () => {
    renderPage(Probe, stubClient({ "stores.list": { mode: "single", stores: [{ name: "default", driver: "mem", isDefault: true }] } }))
    await screen.findByText("(default)")
    expect(screen.queryByLabelText("Store")).toBeNull()
  })

  it("lists every store and switches the active one", async () => {
    renderPage(Probe, stubClient({ "stores.list": MULTI }))
    const select = (await screen.findByLabelText("Store")) as HTMLSelectElement
    expect(select.value).toBe("primary")
    fireEvent.change(select, { target: { value: "archive" } })
    expect(screen.getByLabelText("active store").textContent).toBe("archive")
    fireEvent.change(select, { target: { value: "primary" } })
    // Choosing the default stores "", so queries leave store out.
    expect(screen.getByLabelText("active store").textContent).toBe("(default)")
  })

  it("falls back to the default when the remembered store is gone", async () => {
    act(() => setActiveStore("retired"))
    renderPage(Probe, stubClient({ "stores.list": MULTI }))
    await waitFor(() => expect(screen.getByLabelText("active store").textContent).toBe("(default)"))
  })
})
