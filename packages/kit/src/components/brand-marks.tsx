import type { SVGProps } from "react"

/** The Forge mark from forge/assets/logo.svg, using the surrounding text color. */
export function ForgeMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 559 552" fill="none" aria-hidden="true" {...props}>
      <path d="M134 0H559V125H134V0Z" fill="currentColor" />
      <path d="M134 218H425V343H134V218Z" fill="currentColor" />
      <path d="M432 342.304V218H558.551L432 342.304Z" fill="currentColor" />
      <path d="M0 551.304V136H127V427L0 551.304Z" fill="currentColor" />
      <path d="M127 125H0.342773L127 0.137726V125Z" fill="currentColor" />
    </svg>
  )
}

/** Authsome's shield and lock mark from its docs ThemedLogo component. */
export function AuthsomeMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" {...props}>
      <rect x="2" y="2" width="28" height="28" rx="6" fill="#6366f1" />
      <path
        d="M16 7L9 10V15C9 19.42 11.87 23.53 16 25C20.13 23.53 23 19.42 23 15V10L16 7Z"
        fill="#fff"
        fillOpacity=".9"
      />
      <rect x="13" y="15" width="6" height="5" rx="1" fill="#6366f1" />
      <path
        d="M14 15V13C14 11.9 14.9 11 16 11C17.1 11 18 11.9 18 13V15"
        stroke="#6366f1"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="16" cy="17.5" r=".8" fill="#fff" />
    </svg>
  )
}
