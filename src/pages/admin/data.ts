import type { AuthenticatedUser } from '../../middleware/auth.ts'
import type { ReportedBlurt } from '../../routes/state/moderation.ts'
import type { SignupLimits } from '../../routes/state/signup.ts'

// The admin pages: /admin and /admin/reports: the data the pages are rendered from. The
// route fetches it once; it goes out as JSON as is, as HTML through admin.html.ts and as
// Markdown through admin.md.ts (see src/negotiate.ts).

// /admin: forms for the admin APIs. `minted` is set after minting invite codes.
export type AdminToolsData = {
  viewer: AuthenticatedUser
  limits: SignupLimits
  minted?: { username: string; codes: string[] }
}

// /admin/reports: blurts with open reports, the one waiting longest first.
export type AdminReportsData = { viewer: AuthenticatedUser; reports: ReportedBlurt[] }
