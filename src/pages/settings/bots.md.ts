import type { BotData, BotsData } from './data.ts'
import { code, link, type Markdown, md } from '../shared/markdown.ts'

// /settings/bots and /settings/bots/:username as Markdown: the same data as the HTML, with
// the forms described (see src/pages/settings/bots.html.ts).

export function botsMarkdown({ bots, maxBots }: BotsData): Markdown {
  return md`
    # Your bots

    ${link('Back to settings', '/settings')}

    ${
      bots.length > 0
        ? bots.map((bot) => md`- ${link(bot.username, `/settings/bots/${bot.username}`)}`)
        : 'You don’t run any bots yet.'
    }

    ## New bot

    Send ${code('POST /settings/bots')} with its ${code('username')}. A bot has no password:
    you run it from here, and it blurts with an API token. At most ${String(maxBots)} bots.
  `
}

export function botMarkdown({ bot, bio, tokens, maxTokens, newToken }: BotData): Markdown {
  const base = `/api/bots/${bot.username}`
  return md`
    # ${bot.username} (bot)

    ${link('Your bots', '/settings/bots')} · ${link('Its profile', `/${bot.username}/`)}

    ${newToken && md`New token “${newToken.name}”, shown only now: ${code(newToken.token)}`}

    ## Avatar

    Send ${code(`POST ${base}/avatar`)} with the avatar fields, or ${code('random')}.

    ## Bio

    ${bio || 'No bio yet.'}

    Send ${code(`POST ${base}/bio`)} with its ${code('bio')}.

    ## API tokens

    ${tokens.map(
      (token) =>
        md`- ${token.name} (${code(String(token.id))}), made ${token.createdAt.toISOString()}, ${
          token.lastUsedAt ? `last used ${token.lastUsedAt.toISOString()}` : 'never used'
        }`,
    )}

    Send ${code(`POST ${base}/tokens`)} with a ${code('name')} for a new one (at most
    ${String(maxTokens)}), ${code(`POST ${base}/tokens/<id>/revoke`)} to revoke one.

    ## Owners

    ${bot.owners.map((owner) => md`- ${link(owner, `/${owner}/`)}`)}

    Send ${code(`POST ${base}/owners`)} with a ${code('username')} to share the bot, and
    ${code(`POST ${base}/owners/remove`)} to take an owner off (yourself: leave).

    ## Delete the bot

    Send ${code(`POST ${base}/delete`)}. It can’t be undone.
  `
}
