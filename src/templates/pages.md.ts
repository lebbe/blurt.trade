import type { Blurt, UserProfile } from '../routes/state.ts'
import {
  blurtUrl,
  feedPath,
  isWebUrl,
  moreRepliesUrl,
  olderBlurtsUrl,
  plural,
  type BlurtPageData,
  type FeedData,
  type FormPageData,
  type ProfileEditData,
  type ProfilePageData,
  type SettingsData,
  type Viewer,
} from './index.ts'
import { code, join, link, md, raw, type Markdown } from './markdown.ts'

// The Markdown representation of each page: the same data as the HTML, for text/markdown
// and text/plain clients (curl, LLMs, terminals). Forms are described instead of rendered.

const home = link('Back to blurt.trade', '/')

function viewerLine(viewer: Viewer): Markdown {
  return viewer
    ? md`Logged in as ${link(viewer.username, `/${viewer.username}/`)} · ${link('Settings', '/settings')}`
    : md`${link('Log in', '/login')} or ${link('create a profile', '/createUser')} to blurt.`
}

// `replies` are quoted inline (the feed); the thread link covers the rest.
function blurtMarkdown(blurt: Blurt, replies: Blurt[] = []): Markdown {
  return md`
    ### ${blurt.username}

    ${link(blurt.createdAt, blurtUrl(blurt))} · ${plural(blurt.replyCount, 'reply', 'replies')}

    ${blurt.text}

    ${replies.map((reply) => md`> **${reply.username}**: ${reply.text}`)}
  `
}

function blurtList(blurts: Blurt[]): Markdown {
  return md`${blurts.length > 0 ? blurts.map((blurt) => blurtMarkdown(blurt)) : 'Nothing here yet.'}`
}

export function feedMarkdown(data: FeedData): Markdown {
  const { viewer, feed, hasFollowingFeed, followedBlurts, blurts, next } = data
  return md`
    # blurt.trade

    Say the thing. Regret it later.

    ${viewerLine(viewer)}

    ${
      hasFollowingFeed &&
      (feed === 'following'
        ? md`Following · ${link('Everyone', '/everyone')}`
        : md`${link('Following', '/')} · Everyone`)
    }

    ${
      followedBlurts.length > 0 &&
      md`
        ## From people you follow

        ${followedBlurts.map((blurt) => blurtMarkdown(blurt, blurt.replies))}
      `
    }

    ## ${feed === 'following' ? 'Following' : 'Feed'}

    ${
      blurts.length > 0
        ? blurts.map((blurt) => blurtMarkdown(blurt, blurt.replies))
        : feed === 'following'
          ? 'Nobody you follow has blurted yet.'
          : 'Nothing has been blurted yet.'
    }

    ${next && link('Older blurts', olderBlurtsUrl(feedPath(data), next))}
  `
}

export function blurtPageMarkdown({
  blurt,
  parent,
  replies,
  next,
  related,
}: BlurtPageData): Markdown {
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

    ${next && link('More replies', moreRepliesUrl(blurt, next))}

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

export function profilePageMarkdown({
  viewer,
  profile,
  follows,
  blurts,
  next,
}: ProfilePageData): Markdown {
  const fields = profileFields.map(
    ([key, label]) => md`- ${label}: ${profileValue(String(profile[key]))}`,
  )
  const action = follows.viewerFollows ? '/api/unfollow' : '/api/follow'
  return md`
    # ${profile.username}

    ${home}

    ${plural(follows.followerCount, 'follower')} · ${follows.followingCount} following

    ${
      viewer &&
      viewer.id !== profile.userId &&
      md`${follows.viewerFollows ? 'You follow them. Unfollow' : 'Follow'} with ${code(`POST ${action}`)} and ${code('username')}.`
    }

    ## Profile

    ${join(fields, '\n')}

    ${viewer?.id === profile.userId && link('Edit profile', `/${profile.username}/edit`)}

    ## Blurts

    ${blurtList(blurts)}

    ${next && link('Older blurts', olderBlurtsUrl(`/${profile.username}/`, next))}
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

export function settingsMarkdown({ viewer, activeSessions }: SettingsData): Markdown {
  return md`
    # Settings: ${viewer.username}

    ${home}

    ## Sessions

    You're logged in on ${plural(activeSessions, 'browser or device', 'browsers or devices')}.

    Send ${code('POST /api/logout-everywhere')} to log out everywhere, this client included.
    Other devices are logged out within 5 minutes.
  `
}
