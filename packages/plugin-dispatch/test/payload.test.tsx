import { expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { PayloadView } from "../src/payload"
vi.mock("../src/json-view", () => ({
  default: ({ text, label }: { text: string; label: string }) => (
    <pre aria-label={label}>{text}</pre>
  ),
}))
it("renders original JSON lexemes instead of reserializing rounded numbers", async () => {
  const text = '{"id":9007199254740993,"price":1.2300}'
  render(
    <PayloadView
      label="Payload"
      value={{
        kind: "json",
        json: { id: 9007199254740992, price: 1.23 },
        jsonText: text,
      }}
    />
  )
  expect((await screen.findByLabelText("Payload")).textContent).toBe(text)
})
it("qualifies legacy JSON without raw text", () => {
  render(
    <PayloadView
      label="Payload"
      value={{ kind: "json", json: { id: 9007199254740992 } }}
    />
  )
  expect(screen.getByText(/Original JSON text is unavailable/)).toBeTruthy()
  expect(screen.queryByText(/9007199254740992/)).toBeNull()
})
it.each(["gob", "binary"] as const)("labels %s without decoding it", (kind) => {
  render(<PayloadView label="Data" value={{ kind, bytes: 42 }} />)
  expect(screen.getByText(/42 bytes/)).toBeTruthy()
  expect(screen.getByText(/Not viewable as JSON/)).toBeTruthy()
})
