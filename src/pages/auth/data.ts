import type { SignupState, WaitlistEntry } from '../../routes/state/signup.ts'
import type { Viewer } from '../../ui/context.ts'

// Logging in and signing up: /login, /signup and /waitlist: the data the pages are rendered
// from. The route fetches it once; it goes out as JSON as is, as HTML through auth.html.ts
// and as Markdown through auth.md.ts (see src/negotiate.ts).

// Login has no data of its own.
export type FormPageData = { viewer: Viewer }

// `signup` says whether the sign-up form is open, needs an invite code, or is full.
// `inviteCode` fills in the form's invite code (from ?invite= or the submitted form).
export type SignupPageData = { viewer: Viewer; signup: SignupState; inviteCode: string | null }

// `waiting`: how many are on the waitlist. `username` is the one looked up with
// ?username=, and `entry` its waitlist entry (null if it has none).
export type WaitlistData = {
  viewer: Viewer
  signup: SignupState
  waiting: number
  username: string | null
  entry: WaitlistEntry | null
}

// Said at sign-up, in the terms and on the privacy page: no email means no reset.
export const noPasswordReset =
  "Keep your password safe, e.g. in a password manager. We don't take an email address, " +
  "so there's no password reset: a lost password can't be recovered, and neither can the " +
  'account.'

// On the login page, followed by a link to /privacy.
export const forgotPassword = "Forgot your password? There's no password reset, see"
