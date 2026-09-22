import type { AuthScreens } from "../routes"
import { ForgotPasswordScreen } from "./forgot-password"
import { ResetPasswordScreen } from "./reset-password"
import { SetupScreen } from "./setup"
import { SignInScreen } from "./sign-in"
import { SignUpScreen } from "./sign-up"

/** The screens a dashboard gets when the host app overrides nothing. */
export const defaultAuthScreens: Required<AuthScreens> = {
  signIn: SignInScreen,
  forgotPassword: ForgotPasswordScreen,
  resetPassword: ResetPasswordScreen,
  signUp: SignUpScreen,
  setup: SetupScreen,
}

export { DeniedScreen } from "./denied"
