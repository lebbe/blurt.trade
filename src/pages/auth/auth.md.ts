import {
  forgotPassword,
  type FormPageData,
  noPasswordReset,
  type SignupPageData,
  type WaitlistData,
} from './data.ts'
import { home } from '../shared/blurts.md.ts'
import { code, link, type Markdown, type MarkdownValue, md } from '../shared/markdown.ts'
import type { Viewer } from '../../ui/context.ts'
import { plural } from '../../ui/text.ts'

// Logging in and signing up: /login, /signup and /waitlist as Markdown: the same data as
// the HTML, for text/markdown and text/plain clients (curl, LLMs, terminals). Forms are
// described instead of rendered.

function formMarkdown(
  title: string,
  path: string,
  fields: Markdown,
  viewer: Viewer,
  note?: MarkdownValue,
): Markdown {
  return md`
    # ${title}

    ${home}

    Send ${code(`POST ${path}`)} as a form or as JSON with ${fields}.

    ${note}

    ${viewer && md`You are already logged in as ${viewer.username}.`}
  `
}

export function loginMarkdown({ viewer }: FormPageData): Markdown {
  return formMarkdown(
    'Log in',
    '/login',
    md`${code('username')}, ${code('password')} and, optionally, ${code('remember')} (${code('1')} to stay logged in; otherwise the login ends when the browser closes, or after a day unused)`,
    viewer,
    md`${forgotPassword} ${link('Privacy', '/privacy')}.`,
  )
}

const usernameRules = md`${code('username')} (letters, numbers and ${code('_')})`

export function createUserMarkdown({ viewer, signup, inviteCode }: SignupPageData): Markdown {
  const invite = md`${code('inviteCode')}${inviteCode && md` (yours: ${code(inviteCode)})`}`
  if (signup === 'invite') {
    return md`
      # Create a profile

      ${home}

      blurt.trade is invite-only right now. You need an invite code from someone who's already
      here to sign up.

      Send ${code('POST /signup')} as a form or as JSON with ${usernameRules}, ${code('password')} (at least 8 characters) and ${invite}.

      ${noPasswordReset}

      ${viewer && md`You are already logged in as ${viewer.username}.`}
    `
  }
  if (signup === 'waitlist') {
    return md`
      # Create a profile

      ${home}

      Sign-up is full right now. Join the ${link('waitlist', '/waitlist')} instead.
    `
  }
  return formMarkdown(
    'Create a profile',
    '/signup',
    md`${usernameRules}, ${code('password')} (at least 8 characters) and, optionally, ${code('remember')} (${code('1')} to stay logged in; otherwise the login ends when the browser closes, or after a day unused)`,
    viewer,
    noPasswordReset,
  )
}

export function waitlistMarkdown({ signup, waiting, username, entry }: WaitlistData): Markdown {
  const status = entry
    ? entry.status === 'joined'
      ? md`${link(entry.username, `/${entry.username}/`)} has signed up.`
      : md`${entry.username} is on the waitlist.`
    : username && md`${username} isn't on the waitlist.`
  const opening =
    signup === 'open'
      ? md`Sign-up is open again: ${link('create your profile', '/signup')}.`
      : signup === 'invite'
        ? md`Sign-up has reopened, with an invite code: ${link('sign up', '/signup')}.`
        : md`
Sign-up is full. When it opens again, this page will say so.
          `
  return md`
    # Waitlist

    ${home}

    ${status}

    ${opening}

    ${plural(waiting, 'person', 'people')} waiting.

    ${signup === 'waitlist' && md`Send ${code('POST /waitlist')} as a form or as JSON with ${usernameRules}. No email: check back at ${code('/waitlist?username=<username>')}.`}
  `
}
