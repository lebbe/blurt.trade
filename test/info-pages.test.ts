import test from 'node:test'
import assert from 'node:assert/strict'
import { db } from '../src/db.ts'
import { blurtIdByText, createSession, json, request } from './helpers.ts'

test('every page links to about, terms and privacy in its footer, without JS', async () => {
  const cookie = await createSession('Lars')
  await request('POST', '/api/blurts', 'text=Original+blurt', { cookie })
  const id = await blurtIdByText('Original blurt')
  const pages = ['/', '/everyone', '/Lars/', `/Lars/${id}`, '/Lars/edit', '/near', '/settings']
  const anonymousPages = ['/login', '/createUser', '/waitlist', '/about', '/terms', '/privacy']
  const footer = /<footer>[^]*href="\/about"[^]*href="\/terms"[^]*href="\/privacy"[^]*<\/footer>/
  for (const path of [...pages, ...anonymousPages]) {
    const response = await request('GET', path, '', pages.includes(path) ? { cookie } : {})
    assert.equal(response.statusCode, 200, path)
    assert.match(response.body, footer, path)
  }
  for (const path of ['/about', '/terms', '/privacy']) {
    const response = await request('GET', path)
    assert.match(response.contentType ?? '', /^text\/html/, path)
    assert.doesNotMatch(response.body, /<script/, path)
  }
})

test('about, terms and privacy come as JSON and Markdown too', async (t) => {
  t.after(() => {
    delete process.env.CONTACT_EMAIL
    delete process.env.CONTACT_REPO_URL
  })
  process.env.CONTACT_EMAIL = 'owner@example.com'
  process.env.CONTACT_REPO_URL = 'https://github.com/example/blurt.trade'

  for (const path of ['/about', '/terms', '/privacy']) {
    const response = await request('GET', path, '', json)
    assert.equal(response.statusCode, 200, path)
    assert.deepEqual(
      JSON.parse(response.body),
      {
        viewer: null,
        contact: {
          email: 'owner@example.com',
          issuesUrl: 'https://github.com/example/blurt.trade/issues',
          securityUrl: 'https://github.com/example/blurt.trade/security/advisories/new',
        },
      },
      path,
    )
  }

  const markdown: [string, RegExp][] = [
    ['/about', /^# About blurt\.trade\n[^]*\*\*GitHub issues are public\*\*/],
    ['/terms', /^# Terms\n[^]*no password reset/],
    ['/privacy', /^# Privacy\n[^]*## What is stored[^]*## Cookies/],
  ]
  for (const [path, expected] of markdown) {
    const response = await request('GET', path, '', { accept: 'text/markdown' })
    assert.equal(response.statusCode, 200, path)
    assert.match(response.body, expected, path)
  }
})

test('the contact page says where not to post sensitive things', async (t) => {
  t.after(() => {
    delete process.env.CONTACT_EMAIL
    delete process.env.CONTACT_REPO_URL
  })
  const none = await request('GET', '/about')
  assert.match(none.body, /No contact address has been set up yet/)

  process.env.CONTACT_EMAIL = 'owner@example.com'
  process.env.CONTACT_REPO_URL = 'https://github.com/example/blurt.trade'
  const about = await request('GET', '/about')
  assert.match(about.body, /href="https:\/\/github\.com\/example\/blurt\.trade\/issues"/)
  assert.match(about.body, /GitHub issues are public/)
  assert.match(about.body, /security\/advisories\/new">Report a vulnerability/)
  assert.match(about.body, /Report button/)
  assert.match(about.body, /href="mailto:owner@example\.com"/)

  // A malformed value is a startup error in production; the page just leaves it out.
  process.env.CONTACT_REPO_URL = 'javascript:alert(1)'
  assert.doesNotMatch((await request('GET', '/about')).body, /javascript:/)
})

test('sign-up and the privacy page say a lost password cannot be recovered', async () => {
  for (const path of ['/createUser', '/privacy', '/terms']) {
    const { body } = await request('GET', path)
    assert.match(body, /no password reset/, path)
  }
  const markdown = await request('GET', '/createUser', '', { accept: 'text/markdown' })
  assert.match(markdown.body, /no password reset/)
})

test('the login page says there is no password reset and links to /privacy', async () => {
  const { body } = await request('GET', '/login')
  assert.match(
    body,
    /Forgot your password\? There(&#39;|')s no password reset, see <a href="\/privacy">/,
  )
  const markdown = await request('GET', '/login', '', { accept: 'text/markdown' })
  assert.match(
    markdown.body,
    /Forgot your password\? There's no password reset, see \[Privacy\]\(<\/privacy>\)/,
  )
})

// The privacy page (/privacy) lists what is stored. If this fails, a migration added or
// removed a column: update the page in src/templates/index.ts and pages.md.ts, then this.
test('the privacy page is in step with the database columns', async () => {
  const { rows } = await db().query<{ table_name: string; columns: string }>(
    `SELECT table_name, string_agg(column_name, ' ' ORDER BY column_name) AS columns
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name NOT IN ('pgmigrations', 'spatial_ref_sys')
       AND table_name NOT IN (SELECT viewname FROM pg_views WHERE schemaname = 'public')
     GROUP BY table_name ORDER BY table_name`,
  )
  assert.deepEqual(Object.fromEntries(rows.map((row) => [row.table_name, row.columns])), {
    blurt_stats: 'blurt_id like_count reblurt_count',
    blurts:
      'created_at deleted_at embedding id parent_id reblurt_of_id reblurt_of_user_id text user_id',
    follows: 'created_at followed_user_id user_id',
    likes: 'blurt_id created_at user_id',
    invite_codes: 'code created_at expires_at used_at used_by_user_id user_id',
    reports: 'blurt_id created_at dismissed_at reason user_id',
    retired_usernames: 'username',
    sessions: 'created_at current_generation id last_used_at revoked_at user_id',
    signup_counter: 'current_count hard_limit id soft_limit',
    user_profiles:
      'avatar bio card_color github homepage instagram linkedin locale location theme tiktok timezone updated_at user_id x youtube',
    users: 'created_at deleted_at id is_admin password_hash username',
    waitlist: 'created_at id status username',
  })
})
