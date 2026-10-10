import type { Blurt, UserProfile } from '../routes/state.ts'
import {
  blurtUrl,
  isWebUrl,
  plural,
  type BlurtPageData,
  type FeedData,
  type FormPageData,
  type ProfileEditData,
  type ProfilePageData,
  type Viewer,
} from './index.ts'
import { code, join, link, md, raw, type Markdown } from './markdown.ts'

// The Markdown representation of each page: the same data as the HTML, for text/markdown
// and text/plain clients (curl, LLMs, terminals). Forms are described instead of rendered.

const home = link('Back to blurt.trade', '/')

function viewerLine(viewer: Viewer): Markdown {
  return viewer
    ? md`Logged in as ${link(viewer.username, `/${viewer.username}/`)}.`
    : md`${link('Log in', '/login')} or ${link('create a profile', '/createUser')} to blurt.`
}

// `replies` are quoted inline (the feed); the thread link covers the rest.
function blurtMarkdown(blurt: Blurt, replies: Blurt[] = []): Markdown {
  return md`
    ### ${blurt.username}

    ${link(blurt.createdAt, blurtUrl(blurt))} · ${plural(blurt.replyCount, 'repl')}

    ${blurt.text}

    ${replies.map((reply) => md`> **${reply.username}**: ${reply.text}`)}
  `
}

function blurtList(blurts: Blurt[]): Markdown {
  return md`${blurts.length > 0 ? blurts.map((blurt) => blurtMarkdown(blurt)) : 'Nothing here yet.'}`
}

export function feedMarkdown({ viewer, blurts }: FeedData): Markdown {
  return md`
    # blurt.trade

    Say the thing. Regret it later.

    ${viewerLine(viewer)}

    ## Feed

    ${
      blurts.length > 0
        ? blurts.map((blurt) => blurtMarkdown(blurt, blurt.replies))
        : 'Nothing has been blurted yet.'
    }
  `
}

export function blurtPageMarkdown({ blurt, parent, replies, related }: BlurtPageData): Markdown {
  return md`
    # ${blurt.username}

    ${home}

    ${
      parent &&
      md`
        ## In reply to

        ${blurtMarkdown(parent)}
      `
    }

    ${blurtMarkdown(blurt)}

    ## Replies

    ${blurtList(replies)}

    ## Related blurts

    ${blurtList(related)}
  `
}

function profileValue(value: string): Markdown {
  return md`${value === '' ? raw('_Not set_') : isWebUrl(value) ? link(value, value) : value}`
}

const profileFields: [keyof UserProfile, string][] = [
  ['homepage', 'Homepage'],
  ['x', 'X'],
  ['instagram', 'Instagram'],
  ['tiktok', 'TikTok'],
  ['youtube', 'YouTube'],
  ['github', 'GitHub'],
  ['linkedin', 'LinkedIn'],
  ['bio', 'Bio'],
]

export function profilePageMarkdown({ viewer, profile, blurts }: ProfilePageData): Markdown {
  const fields = profileFields.map(
    ([key, label]) => md`- ${label}: ${profileValue(String(profile[key]))}`,
  )
  return md`
    # ${profile.username}

    ${home}

    ## Profile

    ${join(fields, '\n')}

    ${viewer?.id === profile.userId && link('Edit profile', `/${profile.username}/edit`)}

    ## Blurts

    ${blurtList(blurts)}
  `
}

export function profileEditMarkdown({ profile }: ProfileEditData): Markdown {
  const fields = profileFields.map(
    ([key, label]) => md`- ${code(key)} (${label}): ${profileValue(String(profile[key]))}`,
  )
  return md`
    # Edit profile: ${profile.username}

    ${link('Back to profile', `/${profile.username}/`)}

    Send ${code(`POST /${profile.username}/edit`)} as a form or as JSON. Fields left out are
    cleared. Current values:

    ${join(fields, '\n')}
  `
}

function formMarkdown(title: string, path: string, fields: Markdown, viewer: Viewer): Markdown {
  return md`
    # ${title}

    ${home}

    Send ${code(`POST ${path}`)} as a form or as JSON with ${fields}.

    ${viewer && md`You are already logged in as ${viewer.username}.`}
  `
}

export function loginMarkdown({ viewer }: FormPageData): Markdown {
  return formMarkdown('Log in', '/login', md`${code('username')} and ${code('password')}`, viewer)
}

export function createUserMarkdown({ viewer }: FormPageData): Markdown {
  return formMarkdown(
    'Create a profile',
    '/createUser',
    md`${code('username')} (letters, numbers and ${code('_')}) and ${code('password')} (at least 8 characters)`,
    viewer,
  )
}
