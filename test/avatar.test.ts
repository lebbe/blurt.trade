import test from 'node:test'
import assert from 'node:assert/strict'
import { db } from '../src/db.ts'
import { getUserProfileByUsername } from '../src/routes/state.ts'
import { h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import {
  type Avatar,
  avatarPalettes,
  eyeTypes,
  hairTypes,
  headWidths,
  randomAvatar,
  toothTypes,
} from '../src/avatar.ts'
import { AvatarSvg } from '../src/templates/avatar.ts'
import { createSession, json, request, sendJson, stylesheet } from './helpers.ts'

const avatarForm = {
  headWidth: 'broad',
  skin: '#123abc',
  hairType: 'mohawk',
  hairColor: '#ff0000',
  eyeType: 'angry',
  eyeColor: '#fefefe',
  pupilColor: '#00ff00',
  toothType: 'buck',
  toothColor: '#eeeeee',
}

function formBody(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString()
}

// Every <svg> on a page: only the elements and attributes the avatar template draws with.
function assertSafeSvgs(body: string): void {
  for (const [svg] of body.matchAll(/<svg[^]*?<\/svg>/g)) {
    assert.doesNotMatch(svg, /<script|<foreignObject|<use|<image|href|url\(|\son\w+=/i)
  }
}

test('new users get a random avatar from the palettes', async () => {
  await createSession('Lars')
  await createSession('Ada')
  for (const username of ['Lars', 'Ada']) {
    const avatar = (await getUserProfileByUsername(username))?.avatar
    assert.ok(avatar)
    assert.ok(avatarPalettes.skin.includes(avatar.skin), username)
    assert.ok(avatarPalettes.hairColor.includes(avatar.hairColor), username)
    assert.ok(avatarPalettes.eyeColor.includes(avatar.eyeColor), username)
    assert.ok(avatarPalettes.pupilColor.includes(avatar.pupilColor), username)
    assert.ok(avatarPalettes.toothColor.includes(avatar.toothColor), username)
    assert.ok(hairTypes.includes(avatar.hairType), username)
    assert.ok(eyeTypes.includes(avatar.eyeType), username)
    assert.ok(toothTypes.includes(avatar.toothType), username)
    assert.ok(headWidths.includes(avatar.headWidth), username)
  }

  const avatars = new Set(Array.from({ length: 50 }, () => JSON.stringify(randomAvatar())))
  assert.ok(avatars.size > 40, 'random avatars differ')
})

test("blurts show the blurter's avatar, on alternating sides, talking on hover", async () => {
  const cookie = await createSession('Lars')
  await request('POST', '/api/avatar', formBody(avatarForm), { cookie })
  await request('POST', '/api/blurts', 'text=First', { cookie })
  await request('POST', '/api/blurts', 'text=Second', { cookie })

  const feed = await request('GET', '/')
  const cards = [
    ...feed.body.matchAll(
      /<article class="blurt" id="blurt-\d+"><svg class="avatar avatar-small"/g,
    ),
  ]
  assert.equal(cards.length, 2)
  assert.match(feed.body, /<svg [^>]*aria-hidden="true"[^>]*>/)
  assert.match(feed.body, /fill="#123abc"/)
  // Sides and the talking are pure CSS, in the linked stylesheet: no JS needed.
  assert.match(stylesheet, /\.blurt:nth-of-type\(even\) \{\s*flex-direction: row-reverse;/)
  assert.match(stylesheet, /\.avatar:hover \.avatar-top,/)
  assert.match(stylesheet, /@keyframes avatar-talk/)
  assert.match(stylesheet, /@keyframes avatar-jaw/)
  assert.equal((feed.body.match(/class="avatar-top"/g) ?? []).length, 4) // 2 per avatar
  assert.equal((feed.body.match(/class="avatar-jaw"/g) ?? []).length, 4) // 2 per avatar
  // A broad head: stretched sideways, in a bigger box.
  assert.match(feed.body, /<g transform="translate\(50 0\) scale\(1\.15 1\) translate\(-50 0\)">/)
  assert.match(feed.body, /viewBox="-1\.6 -1\.6 103\.2 103\.2"/)
  assert.doesNotMatch(feed.body, /viewBox="0 0 100 100"/)
  assertSafeSvgs(feed.body)

  const data = JSON.parse((await request('GET', '/', '', json)).body)
  assert.deepEqual(data.blurts[0].avatar, avatarForm)

  const profile = await request('GET', '/Lars/')
  assert.match(
    profile.body,
    /<svg class="avatar avatar-large"[^>]*role="img" aria-label="Lars's avatar"/,
  )
  const profileData = JSON.parse((await request('GET', '/Lars/', '', json)).body)
  assert.deepEqual(profileData.profile.avatar, avatarForm)
  assert.match(
    (await request('GET', '/Lars/', '', { accept: 'text/markdown' })).body,
    /- Avatar: broad head, skin #123abc, mohawk #ff0000 hair, angry #fefefe eyes with #00ff00 pupils, buck tooth \(#eeeeee\)/,
  )
})

test('edits the avatar with colour pickers and selects, without JS', async () => {
  const cookie = await createSession('Lars')
  const edit = await request('GET', '/Lars/edit', '', { cookie })
  assert.match(edit.body, /<form method="post" action="\/api\/avatar"/)
  for (const name of ['skin', 'hairColor', 'eyeColor', 'pupilColor', 'toothColor']) {
    assert.match(edit.body, new RegExp(`<input type="color" name="${name}" value="#[0-9a-f]{6}"`))
  }
  for (const name of ['headWidth', 'hairType', 'eyeType', 'toothType']) {
    assert.match(edit.body, new RegExp(`<select name="${name}">`))
  }
  assert.match(edit.body, /<button type="submit" name="random" value="1" formnovalidate>Random</)

  const saved = await request('POST', '/api/avatar', formBody({ ...avatarForm, skin: '#ABCDEF' }), {
    cookie,
  })
  assert.equal(saved.statusCode, 303)
  assert.equal(saved.location, '/Lars/edit')
  assert.deepEqual((await getUserProfileByUsername('Lars'))?.avatar, {
    ...avatarForm,
    skin: '#abcdef',
  })
  const after = await request('GET', '/Lars/edit', '', { cookie })
  assert.match(after.body, /<input type="color" name="skin" value="#abcdef"/)
  assert.match(after.body, /<option value="mohawk" selected>Mohawk<\/option>/)

  // The Random button: the form's fields come along, but `random` wins.
  const random = await request('POST', '/api/avatar', formBody({ ...avatarForm, random: '1' }), {
    cookie,
  })
  assert.equal(random.statusCode, 303)
  assert.equal(random.location, '/Lars/edit')
  const randomized = (await getUserProfileByUsername('Lars'))?.avatar
  assert.ok(randomized && avatarPalettes.skin.includes(randomized.skin))

  const viaJson = await sendJson('/api/avatar', { random: true }, { cookie })
  assert.equal(viaJson.statusCode, 200)
  const stored = (await getUserProfileByUsername('Lars'))?.avatar
  assert.deepEqual(JSON.parse(viaJson.body).avatar, stored)

  const setJson = await sendJson('/api/avatar', avatarForm, { cookie })
  assert.equal(setJson.statusCode, 200)
  assert.deepEqual(JSON.parse(setJson.body), { avatar: avatarForm })

  const anonymous = await sendJson('/api/avatar', avatarForm)
  assert.equal(anonymous.statusCode, 401)
})

test('rejects avatar values that are not colours or known types', async () => {
  const cookie = await createSession('Lars')
  const before = (await getUserProfileByUsername('Lars'))?.avatar

  const cases: [Record<string, string>, string][] = [
    [{ skin: '"><script>alert(1)</script>' }, 'skin'],
    [{ hairColor: 'red' }, 'hairColor'],
    [{ pupilColor: 'url(https://evil.example/x)' }, 'pupilColor'],
    [{ eyeType: 'laser' }, 'eyeType'],
    [{ toothType: '<g onload=alert(1)>' }, 'toothType'],
    [{ headWidth: '1e9' }, 'headWidth'],
  ]
  for (const [change, field] of cases) {
    const response = await sendJson('/api/avatar', { ...avatarForm, ...change }, { cookie })
    assert.equal(response.statusCode, 400, field)
    assert.deepEqual(
      JSON.parse(response.body).errors.map((error: { field: string }) => error.field),
      [field],
    )
  }

  const missing = await sendJson('/api/avatar', { skin: '#000000' }, { cookie })
  assert.equal(missing.statusCode, 400)

  const form = await request(
    'POST',
    '/api/avatar',
    formBody({ ...avatarForm, skin: '"><script>alert(1)</script>' }),
    { cookie },
  )
  assert.equal(form.statusCode, 400)
  assert.match(form.body, /Skin colour must be a colour like #a1b2c3/)
  assert.doesNotMatch(form.body, /<script>alert/)
  assert.deepEqual((await getUserProfileByUsername('Lars'))?.avatar, before)

  // The database refuses them too, whatever the app does.
  await assert.rejects(
    db().query(`UPDATE user_profiles SET avatar = avatar || '{"skin": "red"}'`),
    /user_profiles_avatar_valid/,
  )
  await assert.rejects(
    db().query(`UPDATE user_profiles SET avatar = avatar - 'eyeType'`),
    /user_profiles_avatar_valid/,
  )
  await assert.rejects(
    db().query(`UPDATE user_profiles SET avatar = avatar || '{"headWidth": "1e9"}'`),
    /user_profiles_avatar_valid/,
  )
})

test('the avatar template only draws known shapes and #rrggbb colours', () => {
  const hostile = {
    headWidth: '2) scale(31337',
    skin: '"/><script>alert(1)</script>',
    hairType: '<image href="https://evil.example/x.png"/>',
    hairColor: 'url(#x)',
    eyeType: 'onload',
    eyeColor: '#fff',
    pupilColor: 'javascript:alert(1)',
    toothType: '__proto__',
    toothColor: '#00000g',
  } as unknown as Avatar
  const svg = renderToString(h(AvatarSvg, { avatar: hostile, label: '<b>x</b>' }))
  assert.doesNotMatch(svg, /<script|<image|evil|javascript|url\(|<b>|31337/)
  assert.match(svg, /viewBox="0 0 100 100"/) // an unknown width is a regular head
  assertSafeSvgs(svg)
  for (const [, color] of svg.matchAll(/(?:fill|stroke)="([^"]*)"/g)) {
    assert.match(color, /^(#[0-9a-f]{6}|none)$/)
  }
})
