import test from 'node:test'
import assert from 'node:assert/strict'
import { db } from '../src/db.ts'
import { getUserProfileByUsername } from '../src/routes/state.ts'
import { renderProfilePage } from '../src/templates/index.ts'
import { createSession, json, request } from './helpers.ts'

test('shows only one user feed and profile data on profile route', async () => {
  const larsCookie = await createSession('Lars')
  const adaCookie = await createSession('Ada')

  await request('POST', '/api/blurts', 'text=Lars+post', { cookie: larsCookie })
  await request('POST', '/api/blurts', 'text=Ada+post', { cookie: adaCookie })

  const response = await request('GET', '/Lars/', '', { cookie: larsCookie })

  assert.equal(response.statusCode, 200)
  assert.match(response.body, /<h1>Lars<\/h1>/)
  assert.match(response.body, /Lars post/)
  assert.doesNotMatch(response.body, /Ada post/)
  assert.match(response.body, /href="\/Lars\/edit"/)
  assert.match(response.body, /Homepage/)
  assert.match(response.body, /LinkedIn/)
})

test('hides edit button when viewing someone else profile', async () => {
  await createSession('Lars')
  const adaCookie = await createSession('Ada')

  const response = await request('GET', '/Lars/', '', { cookie: adaCookie })

  assert.equal(response.statusCode, 200)
  assert.doesNotMatch(response.body, /href="\/Lars\/edit"/)
})

test('validates and updates profile fields for the owner', async () => {
  const larsCookie = await createSession('Lars')

  const invalid = await request('POST', '/Lars/edit', 'homepage=not-a-url&bio=hello', {
    cookie: larsCookie,
  })

  assert.equal(invalid.statusCode, 400)
  assert.match(invalid.body, /Homepage must be a full URL starting with https:\/\/ or http:\/\//)

  const valid = await request(
    'POST',
    '/Lars/edit',
    'homepage=https%3A%2F%2Fexample.com&x=%40lars&instagram=&tiktok=&youtube=&github=https%3A%2F%2Fgithub.com%2Flars&linkedin=&bio=hello+there',
    {
      cookie: larsCookie,
    },
  )

  assert.equal(valid.statusCode, 303)
  assert.equal(valid.location, '/Lars/')
  const profile = await getUserProfileByUsername('Lars')
  assert.equal(profile?.homepage, 'https://example.com')
  assert.equal(profile?.x, '@lars')
  assert.equal(profile?.github, 'https://github.com/lars')
  assert.equal(profile?.bio, 'hello there')
})

test('forbids profile edits from non-owners', async () => {
  await createSession('Lars')
  const adaCookie = await createSession('Ada')

  const response = await request('POST', '/Lars/edit', 'bio=ada+was+here', {
    cookie: adaCookie,
  })

  assert.equal(response.statusCode, 403)
  assert.equal((await getUserProfileByUsername('Lars'))?.bio, '')
})

test('re-renders the edit form with the submitted values on validation errors', async () => {
  const larsCookie = await createSession('Lars')

  const response = await request('POST', '/Lars/edit', 'homepage=example.com&bio=keep+me', {
    cookie: larsCookie,
  })

  assert.equal(response.statusCode, 400)
  assert.match(response.body, /Edit profile: Lars/)
  assert.match(response.body, /value="example\.com"/)
  assert.match(response.body, /keep me/)
  assert.equal((await getUserProfileByUsername('Lars'))?.bio, '')
})

test('never stores or renders a non-http(s) link as a href', async () => {
  await createSession('Lars')
  await assert.rejects(
    db().query(`UPDATE user_profiles SET homepage = 'javascript:alert(1)'`),
    /user_profiles_homepage_web_url/,
  )
  await assert.rejects(
    db().query(`UPDATE user_profiles SET github = 'javascript:alert(1)'`),
    /user_profiles_github_valid/,
  )

  // The templates don't trust the database either.
  const data = JSON.parse((await request('GET', '/Lars/', '', json)).body)
  for (const homepage of ['javascript:alert(1)', ' http://example.com', 'http:example.com']) {
    const page = renderProfilePage({ ...data, profile: { ...data.profile, homepage } })
    assert.doesNotMatch(page, /href="(javascript:|http:example| http)/, homepage)
    assert.ok(page.includes(homepage.trim()), homepage)
  }
})
