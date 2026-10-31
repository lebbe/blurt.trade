import test from 'node:test'
import assert from 'node:assert/strict'
import { db } from '../src/db.ts'
import {
  createSession,
  json,
  multipart,
  request,
  samplePng,
  sendJson,
  stylesheet,
} from './helpers.ts'

function upload(content: Buffer) {
  return multipart({}, { name: 'picture', filename: 'me.png', type: 'image/png', content })
}

async function uploadAs(cookie: string, content = samplePng()) {
  const { body, headers } = upload(content)
  return request('POST', '/api/profile-picture', body, { ...headers, cookie })
}

async function storedPicture() {
  const { rows } = await db().query<{
    user_id: number
    picture: Buffer | null
    picture_version: number
    picture_cut: number
  }>('SELECT user_id, picture, picture_version, picture_cut FROM user_profiles')
  return rows[0]
}

test('an uploaded profile picture replaces the cartoon, as two halves that talk', async () => {
  const cookie = await createSession('Lars')
  const response = await uploadAs(cookie)
  assert.equal(response.statusCode, 303)
  assert.equal(response.location, '/Lars/edit#picture')

  const stored = await storedPicture()
  assert.ok(stored.picture && stored.picture.length < 65536)
  assert.equal(stored.picture_version, 1)
  assert.equal(stored.picture_cut, 65)
  const base = `/profile-pictures/${stored.user_id}-1-65`

  // Cropped square, at 640: the halves split at 65 % (416 px), the top 8 px longer.
  const top = await request('GET', `${base}-top.svg`)
  assert.equal(top.statusCode, 200)
  assert.match(top.contentType ?? '', /^image\/svg\+xml/)
  assert.equal(top.headers['cache-control'], 'public, max-age=31536000, immutable')
  assert.match(top.body, /^<svg [^>]*viewBox="0 0 640 424" width="640" height="424">/)
  const jaw = await request('GET', `${base}-jaw.svg`)
  assert.match(jaw.body, /^<svg [^>]*viewBox="0 416 640 224" width="640" height="224">/)
  const edit = await request('GET', `${base}-edit.svg`)
  assert.match(edit.body, /viewBox="0 0 640 640"/)
  assert.match(edit.body, /<path d="M0 416H640"/)
  for (const svg of [top.body, jaw.body, edit.body]) {
    assert.doesNotMatch(svg, /<script|href|<image|<foreignObject/i)
  }

  // Shown instead of the cartoon: two plain <img>s, no inline style, no script.
  const profile = await request('GET', '/Lars/')
  assert.match(
    profile.body,
    new RegExp(
      `<span class="avatar avatar-large avatar-photo" role="img" aria-label="Lars's avatar"><span class="avatar-mouth"><img class="avatar-top" src="${base}-top.svg" width="640" height="424"[^>]*/><img class="avatar-jaw" src="${base}-jaw.svg" width="640" height="224"`,
    ),
  )
  assert.doesNotMatch(profile.body, /style="/)

  // The edit page: the whole picture to click.
  const editPage = await request('GET', '/Lars/edit', '', { cookie })
  assert.match(
    editPage.body,
    new RegExp(`<input type="image" name="cut" src="${base}-edit.svg" width="240" height="240"`),
  )

  // In blurts, and in JSON.
  await request('POST', '/api/blurts', 'text=Hello', { cookie })
  const feed = await request('GET', '/everyone')
  assert.ok(feed.body.includes(`src="${base}-top.svg"`))
  const data = JSON.parse((await request('GET', '/Lars/', '', json)).body)
  assert.deepEqual(data.profile.avatar.photo, { user: stored.user_id, version: 1, cut: 65 })
  const markdown = await request('GET', '/Lars/', '', { accept: 'text/markdown' })
  assert.ok(markdown.body.includes(`${base}-top.svg`))
})

test('clicking the picture sets where it is cut; a new upload gets new URLs', async () => {
  const cookie = await createSession('Lars')
  await uploadAs(cookie)
  const { user_id: user } = await storedPicture()

  const click = await request('POST', '/api/profile-picture/cut', 'cut.x=100&cut.y=96', { cookie })
  assert.equal(click.statusCode, 303)
  assert.equal(click.location, '/Lars/edit#picture')
  assert.equal((await storedPicture()).picture_cut, 40)
  const top = await request('GET', `/profile-pictures/${user}-1-40-top.svg`)
  assert.match(top.body, /viewBox="0 0 640 264"/)

  // Near the edges it is pulled in, so there is always a top and a jaw.
  await request('POST', '/api/profile-picture/cut', 'cut.x=5&cut.y=1', { cookie })
  assert.equal((await storedPicture()).picture_cut, 5)
  await request('POST', '/api/profile-picture/cut', 'cut.x=5&cut.y=239', { cookie })
  assert.equal((await storedPicture()).picture_cut, 95)

  const viaJson = await sendJson('/api/profile-picture/cut', { cut: 30 }, { cookie })
  assert.equal(viaJson.statusCode, 200)
  assert.deepEqual(JSON.parse(viaJson.body).avatar.photo, { user, version: 1, cut: 30 })

  // A new upload: a new version, the old URLs are gone. The cut stays.
  await uploadAs(cookie, samplePng(300, 500))
  assert.equal((await storedPicture()).picture_version, 2)
  assert.equal((await request('GET', `/profile-pictures/${user}-1-30-top.svg`)).statusCode, 404)
  assert.equal((await request('GET', `/profile-pictures/${user}-2-30-top.svg`)).statusCode, 200)
})

test('a bad cut is a form error and changes nothing', async () => {
  const cookie = await createSession('Lars')
  await uploadAs(cookie)
  for (const [body, message] of [
    ['cut.x=0&cut.y=0', /Click the picture where the mouth is/],
    ['cut.x=10&cut.y=240', /outside the picture/],
    ['cut.x=10&cut.y=1.5', /outside the picture/],
    ['cut=4', /whole number from 5 to 95/],
    ['cut=abc', /whole number from 5 to 95/],
  ] as const) {
    const response = await request('POST', '/api/profile-picture/cut', body, { cookie })
    assert.equal(response.statusCode, 400, body)
    assert.match(response.body, message, body)
  }
  assert.equal((await storedPicture()).picture_cut, 65)
  const viaJson = await sendJson('/api/profile-picture/cut', { cut: 96 }, { cookie })
  assert.equal(viaJson.statusCode, 400)
  assert.equal(JSON.parse(viaJson.body).errors[0].field, 'cut')
})

test('a file that is no picture, or none at all, is a form error', async () => {
  const cookie = await createSession('Lars')
  const response = await uploadAs(cookie, Buffer.from('not an image'))
  assert.equal(response.statusCode, 400)
  assert.match(response.body, /Could not read the picture/)
  const { body, headers } = multipart({})
  const none = await request('POST', '/api/profile-picture', body, { ...headers, cookie })
  assert.equal(none.statusCode, 400)
  assert.match(none.body, /Choose a picture to upload/)
  assert.equal((await storedPicture()).picture, null)
  assert.equal((await request('POST', '/api/profile-picture', body, headers)).statusCode, 401)
})

test('removing the profile picture brings the cartoon back', async () => {
  const cookie = await createSession('Lars')
  await uploadAs(cookie)
  const { user_id: user } = await storedPicture()
  const { body, headers } = multipart({ remove: '1' })
  const response = await request('POST', '/api/profile-picture', body, { ...headers, cookie })
  assert.equal(response.statusCode, 303)
  assert.equal((await storedPicture()).picture, null)
  assert.equal((await request('GET', `/profile-pictures/${user}-1-65-top.svg`)).statusCode, 404)
  const profile = await request('GET', '/Lars/')
  assert.doesNotMatch(profile.body, /avatar-photo/)
  assert.match(profile.body, /<svg class="avatar avatar-large"/)
  const data = JSON.parse((await request('GET', '/Lars/', '', json)).body)
  assert.equal(data.profile.avatar.photo, undefined)
})

test('profile picture paths are strict, and a deleted account has none', async () => {
  const cookie = await createSession('Lars')
  await uploadAs(cookie)
  const { user_id: user } = await storedPicture()
  for (const path of [
    `${user}-1-65-mouth.svg`,
    `${user}-1-4-top.svg`,
    `${user}-1-96-top.svg`,
    `${user}-1-65-top.png`,
    `x-1-65-top.svg`,
    `${user}-1-65-top.svg.svg`,
  ]) {
    assert.equal((await request('GET', `/profile-pictures/${path}`)).statusCode, 404, path)
  }
  await request('POST', '/settings/delete', 'password=correct-horse', { cookie })
  await db().query('UPDATE users SET deleted_at = now()')
  assert.equal((await request('GET', `/profile-pictures/${user}-1-65-top.svg`)).statusCode, 404)
})

test('the photo halves talk with the same keyframes as the cartoon', () => {
  assert.match(stylesheet, /\.avatar-photo \.avatar-top \{[^}]*transform-origin: 86% 100%/)
  assert.match(stylesheet, /\.avatar-photo \.avatar-jaw \{[^}]*margin-top: -1\.25%/)
  assert.match(stylesheet, /\.avatar:hover \.avatar-top,/)
})

test('with a profile picture the cartoon settings give way to the picture panel', async () => {
  const cookie = await createSession('Lars')
  const before = await request('GET', '/Lars/edit', '', { cookie })
  assert.match(before.body, /action="\/api\/avatar"/)
  assert.match(before.body, /href="#avatar"/)

  await uploadAs(cookie)
  const after = await request('GET', '/Lars/edit', '', { cookie })
  assert.doesNotMatch(after.body, /action="\/api\/avatar"/)
  assert.doesNotMatch(after.body, /href="#avatar"/)
  assert.match(
    after.body,
    /<span id="avatar"><\/span><section class="panel" aria-label="Profile picture"/,
  )
  assert.match(after.body, /<input type="image" name="cut"/)
  const markdown = await request('GET', '/Lars/edit', '', { cookie, accept: 'text/markdown' })
  assert.doesNotMatch(markdown.body, /## Avatar/)
  assert.match(markdown.body, /## Profile picture/)
})

test('share cards show the profile picture, and change with it', async () => {
  const cookie = await createSession('Lars')
  await request('POST', '/api/blurts', 'text=Look+at+me', { cookie })
  const { rows } = await db().query('SELECT id FROM blurts')
  const cardOf = async () => {
    const page = await request('GET', `/Lars/${rows[0].id}`)
    return /<meta property="og:image" content="https:\/\/blurt\.trade(\/og\/[^"]+)"/.exec(
      page.body,
    )![1]
  }
  const cartoon = await cardOf()
  await uploadAs(cookie)
  const photo = await cardOf()
  assert.notEqual(photo, cartoon)
  const [cartoonPng, photoPng] = [await request('GET', cartoon), await request('GET', photo)]
  assert.equal(photoPng.statusCode, 200)
  assert.equal(photoPng.contentType, 'image/png')
  assert.notDeepEqual(photoPng.bodyBytes, cartoonPng.bodyBytes)

  // A new cut is a new card.
  await sendJson('/api/profile-picture/cut', { cut: 40 }, { cookie })
  const recut = await cardOf()
  assert.notEqual(recut, photo)
  assert.equal((await request('GET', recut)).statusCode, 200)
})
