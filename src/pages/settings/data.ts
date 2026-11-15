import type { AuthenticatedUser } from '../../middleware/auth.ts'
import type { Avatar } from '../../avatar.ts'
import type { ApiToken, OwnedBot } from '../../routes/state/bots.ts'

// Settings (/settings) and account deletion (/settings/delete): the data the pages are
// rendered from. The route fetches it once; it goes out as JSON as is, as HTML through
// settings.html.ts and as Markdown through settings.md.ts (see src/negotiate.ts).

// `activeSessions`: how many browsers and devices the viewer is logged in on. `hideBots`:
// the "Hide bots" setting. `bots`: how many bots they own (managed on /settings/bots).
export type SettingsData = {
  viewer: AuthenticatedUser
  activeSessions: number
  hideBots: boolean
  bots: number
}

// /settings/bots: the viewer's bots, and the form to make one.
export type BotsData = { viewer: AuthenticatedUser; bots: OwnedBot[]; maxBots: number }

// /settings/bots/:username: one bot, for its owners. `newToken`: only in the response that
// minted it, the one time the token is shown.
export type BotData = {
  viewer: AuthenticatedUser
  bot: OwnedBot
  avatar: Avatar
  bio: string
  tokens: ApiToken[]
  maxTokens: number
  newToken?: ApiToken & { token: string }
}

// /settings/delete, the account deletion confirmation.
export type DeleteAccountData = { viewer: AuthenticatedUser; inviteOnly: boolean }

// What deleting an account does: on the confirmation page, in both views.
export const accountDeletionEffects = (inviteOnly: boolean) => [
  `Your profile, avatar, location, follows (both ways), likes, reblurts, sessions, ${inviteOnly ? 'invite codes ' : ''}and reports are deleted.`,
  'Your blurts, replies and quotes are deleted: their text is removed, and nothing shows they were yours. One that someone replied to stays as an empty placeholder, with no text and no author, so their replies still read.',
  'Your username is retired: nobody can sign up with it again, so nobody can pass for you.',
  'Your bots are deleted the same way, except those someone else owns too.',
  "You're logged out everywhere. It can't be undone; nightly backups still hold the account for up to 30 days.",
]
