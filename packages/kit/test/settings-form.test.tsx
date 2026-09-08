// packages/kit/test/settings-form.test.tsx
import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import {
  SettingsForm,
  type SettingFieldDescriptor,
} from "../src/components/settings-form"

const fields: SettingFieldDescriptor[] = [
  { key: "min_length", label: "Minimum length", type: "number", value: 8, section: "Policy" },
  { key: "require_special", label: "Require a symbol", type: "boolean", value: true, section: "Policy" },
  {
    key: "algorithm",
    label: "Hash algorithm",
    type: "select",
    value: "argon2id",
    options: [
      { label: "argon2id", value: "argon2id" },
      { label: "bcrypt", value: "bcrypt" },
    ],
    section: "Policy",
  },
]

describe("SettingsForm", () => {
  it("renders an empty state when the namespace has no fields", () => {
    render(<SettingsForm fields={[]} onSave={() => {}} emptyMessage="Nothing to configure." />)
    expect(screen.getByRole("status").textContent).toContain("Nothing to configure.")
  })

  it("labels every control and shows the current value", () => {
    render(<SettingsForm fields={fields} onSave={() => {}} />)
    expect((screen.getByLabelText("Minimum length") as HTMLInputElement).value).toBe("8")
    expect((screen.getByLabelText("Hash algorithm") as HTMLSelectElement).value).toBe("argon2id")
  })

  it("groups fields under their section heading", () => {
    render(<SettingsForm fields={fields} onSave={() => {}} />)
    expect(screen.getByRole("heading", { name: "Policy" })).toBeTruthy()
  })

  it("keeps save disabled until something actually changes", () => {
    render(<SettingsForm fields={fields} onSave={() => {}} />)
    const save = screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText("Minimum length"), { target: { value: "12" } })
    expect(save.disabled).toBe(false)
  })

  it("submits only the keys that changed, with numbers as numbers", () => {
    const onSave = vi.fn()
    render(<SettingsForm fields={fields} onSave={onSave} />)
    fireEvent.change(screen.getByLabelText("Minimum length"), { target: { value: "12" } })
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
    expect(onSave).toHaveBeenCalledWith({ min_length: 12 })
  })

  it("disables an enforced field and says it is enforced", () => {
    const onSave = vi.fn()
    render(
      <SettingsForm
        fields={[{ key: "mfa_required", label: "Require MFA", type: "boolean", value: true, enforced: true }]}
        onSave={onSave}
      />,
    )
    const control = screen.getByRole("switch", { name: "Require MFA" })
    expect(control.getAttribute("aria-disabled")).toBe("true")
    expect(screen.getByText("enforced")).toBeTruthy()

    // aria-disabled is a claim; this proves the control actually ignores input.
    // An enforced setting is set at a higher scope, so a click here must not
    // produce a draft change and must leave Save disabled.
    fireEvent.click(control)
    expect(
      (screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(onSave).not.toHaveBeenCalled()
  })

  it("masks a secret field so a shoulder-surfer does not read the value", () => {
    render(
      <SettingsForm
        fields={[{ key: "api_secret", label: "API secret", type: "secret", value: "hunter2" }]}
        onSave={() => {}}
      />,
    )
    expect(screen.getByLabelText("API secret").getAttribute("type")).toBe("password")
  })

  it("reverts every edit when reset is pressed", () => {
    render(<SettingsForm fields={fields} onSave={() => {}} />)
    fireEvent.change(screen.getByLabelText("Minimum length"), { target: { value: "12" } })
    fireEvent.click(screen.getByRole("button", { name: "Reset" }))
    expect((screen.getByLabelText("Minimum length") as HTMLInputElement).value).toBe("8")
  })

  it("refuses to save a numeric field cleared to blank rather than writing 0", () => {
    const onSave = vi.fn()
    render(<SettingsForm fields={fields} onSave={onSave} />)
    fireEvent.change(screen.getByLabelText("Minimum length"), { target: { value: "" } })

    const save = screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    expect(screen.getByRole("alert").textContent).toContain("Enter a number")

    fireEvent.click(save)
    expect(onSave).not.toHaveBeenCalled()
  })

  it("re-enables save once a blanked numeric field is filled in again", () => {
    render(<SettingsForm fields={fields} onSave={() => {}} />)
    const input = screen.getByLabelText("Minimum length")
    fireEvent.change(input, { target: { value: "" } })
    fireEvent.change(input, { target: { value: "12" } })
    expect(
      (screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled,
    ).toBe(false)
  })
})
