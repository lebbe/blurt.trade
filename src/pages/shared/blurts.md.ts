import { pageContext } from '../../page-context.ts'
import { code, link, type Markdown, md, raw } from './markdown.ts'
import type { Blurt, QuotedBlurt } from '../../routes/state/blurts.ts'
import type { Viewer } from '../../ui/context.ts'
import { plural } from '../../ui/text.ts'
import { blurtUrl, parentUrl } from '../../ui/urls.ts'

// Markdown pieces more than one page uses: blurts, the viewer line, the way back home.

export const home = link('Back to blurt.trade', '/')

export function viewerLine(viewer: Viewer): Markdown {
  return viewer
    ? md`Logged in as ${link(viewer.username, `/${viewer.username}/`)} · ${link('Near you', '/near')} · ${link('Settings', '/settings')}`
    : md`${link('Log in', '/login')} or ${link('create a profile', '/signup')} to blurt.`
}

// The blurt a quote quotes, as a blockquote under its text.
function quotedMarkdown(quoted: QuotedBlurt): Markdown {
  return quoted.deleted
    ? md`
> _Content is deleted._
      `
    : md`> **${quoted.username}** (${link(quoted.createdAt, blurtUrl(quoted))}): ${quoted.text}`
}

// `replies` are quoted inline (the feed); the thread link covers the rest. `inThread`: see
// BlurtCard.
export function blurtMarkdown(blurt: Blurt, replies: Blurt[] = [], inThread = false): Markdown {
  const parent = !inThread && parentUrl(blurt)
  return md`
    ### ${blurt.username ?? 'Deleted'}

    ${blurt.reblurtedBy && md`Reblurted by ${link(blurt.reblurtedBy, `/${blurt.reblurtedBy}/`)}`}

    ${parent && md`Replying to ${link(blurt.parentUsername ?? 'a deleted blurt', parent)}`}

    ${link(blurt.createdAt, blurtUrl(blurt))} · ${plural(blurt.replyCount, 'reply', 'replies')}${!blurt.deleted && ` · ${likesText(blurt)} · ${reblurtsText(blurt)}`}

    ${blurt.deleted ? raw('_This blurt was deleted._') : blurt.text}

    ${blurt.picture && raw(`![Picture](/pictures/${blurt.id}.svg)`)}

    ${blurt.quoted && quotedMarkdown(blurt.quoted)}

    ${replies.map((reply) =>
      reply.deleted
        ? md`
> _This blurt was deleted._
          `
        : md`> **${reply.username}**: ${reply.text}`,
    )}
  `
}

function likesText(blurt: Blurt): string {
  return `${plural(blurt.likeCount, 'like')}${blurt.viewerLikes ? ' (you like it)' : ''}`
}

function reblurtsText(blurt: Blurt): string {
  return `${plural(blurt.reblurtCount, 'reblurt')}${blurt.viewerReblurted ? ' (you reblurted it)' : ''}`
}

export function blurtList(blurts: Blurt[], inThread = false): Markdown {
  return md`${blurts.length > 0 ? blurts.map((blurt) => blurtMarkdown(blurt, [], inThread)) : 'Nothing here yet.'}`
}

// "Use JavaScript" (src/javascript.ts), on /about for everyone and on /settings for
// logged-in users, like the HTML pages. Off, pages carry no script at all.
export function javascriptSetting(where: 'about' | 'settings'): Markdown {
  const { viewer, javascript } = pageContext()
  const state = javascript ? 'on' : 'off'
  const flip = javascript ? 'off' : 'on'
  if (viewer && where === 'about') {
    return md`Everything works without JavaScript. The site's JavaScript is optional, and comes only from blurt.trade itself. It is ${state} for your account: turn it ${flip} in ${link('Settings', '/settings#javascript')}.`
  }
  return md`
    Everything works without JavaScript: every page is plain HTML and every button is an ordinary form. A little JavaScript, only from blurt.trade itself, can make some things smoother. It is optional: turned off, not a single script is sent.

    JavaScript is **${state}** ${viewer ? 'for your account, on every device' : 'in this browser'}. Send ${code('POST /api/javascript')} as a form or as JSON with ${code(`javascript=${flip}`)} to turn it ${flip}.
  `
}
