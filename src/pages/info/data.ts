import type { Contact } from '../../config.ts'
import type { Viewer } from '../../ui/context.ts'

// The fixed pages: /about, /terms and /privacy: the data the pages are rendered from. The
// route fetches it once; it goes out as JSON as is, as HTML through info.html.ts and as
// Markdown through info.md.ts (see src/negotiate.ts).

// /about, /terms and /privacy: fixed text, plus how to reach whoever runs the site.
// `inviteOnly`: sign-up needs an invite code, so the texts may talk about them.
export type InfoPageData = { viewer: Viewer; contact: Contact; inviteOnly: boolean }
