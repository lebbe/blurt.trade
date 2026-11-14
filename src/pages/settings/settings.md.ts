import { accountDeletionEffects, type DeleteAccountData, type SettingsData } from './data.ts'
import { home, javascriptSetting } from '../shared/blurts.md.ts'
import { code, link, type Markdown, md } from '../shared/markdown.ts'
import { plural } from '../../ui/text.ts'

// Settings (/settings) and account deletion (/settings/delete) as Markdown: the same data
// as the HTML, for text/markdown and text/plain clients (curl, LLMs, terminals). Forms are
// described instead of rendered.

export function settingsMarkdown({ viewer, activeSessions }: SettingsData): Markdown {
  return md`
    # Settings: ${viewer.username}

    ${home}

    ## Sessions

    You're logged in on ${plural(activeSessions, 'browser or device', 'browsers or devices')}.

    Send ${code('POST /api/logout-everywhere')} to log out everywhere, this client included.
    Other devices are logged out within 5 minutes.

    ## JavaScript

    ${javascriptSetting('settings')}

    ## Delete account

    Deletes your profile and your blurts for good: see ${link('Delete my account', '/settings/delete')}.
  `
}

export function deleteAccountMarkdown({ viewer, inviteOnly }: DeleteAccountData): Markdown {
  return md`
    # Delete account: ${viewer.username}

    ${link('Back to settings', '/settings')}

    ${accountDeletionEffects(inviteOnly).map((effect) => md`- ${effect}`)}

    Send ${code('POST /settings/delete')} as a form or as JSON with your ${code('password')} to confirm.
  `
}
