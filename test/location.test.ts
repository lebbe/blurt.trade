import test from 'node:test'
import assert from 'node:assert/strict'
import { db } from '../src/db.ts'
import { mapHeight, mapUrl, mapWidth } from '../src/geo.ts'
import { createSession, insertBlurt, json, placeAt, request, sendJson } from './helpers.ts'

// The stored location as WKT, e.g. 'POINT(10.5 59.5)' (longitude first), or null.
async function storedLocation(username: string): Promise<string | null> {
  const { rows } = await db().query(
    `SELECT ST_AsText(p.location::geometry) AS point FROM user_profiles p
     JOIN users u ON u.id = p.user_id WHERE u.username = $1`,
    [username],
  )
  return rows[0].point
}

test('serves the world map at its fixed pixel size', async () => {
  const response = await request('GET', mapUrl)
  assert.equal(response.statusCode, 200)
  assert.match(response.contentType ?? '', /^image\/svg\+xml/)
  assert.match(response.body, new RegExp(`width="${mapWidth}" height="${mapHeight}"`))
})

test('sets, moves and removes a coarse location by clicking the map without JS', async () => {
  const cookie = await createSession('Lars')
  const before = await request('GET', '/Lars/edit', '', { cookie })
  assert.match(before.body, /<input type="image" name="location" src="\/static\/world-map\.svg"/)
  assert.match(before.body, /You haven't set a location\./)
  assert.doesNotMatch(before.body, /Remove my location/)

  // Pixel (381, 60) is around 59.75° N, 10.75° E: stored as the middle of its 1° cell.
  const click = await request('POST', '/api/location', 'location.x=381&location.y=60', { cookie })
  assert.equal(click.statusCode, 303)
  assert.equal(click.location, '/Lars/edit#location')
  assert.equal(await storedLocation('Lars'), 'POINT(10.5 59.5)')

  const after = await request('GET', '/Lars/edit', '', { cookie })
  assert.match(after.body, /Your location: <strong>59\.5° N, 10\.5° E<\/strong>/)
  assert.match(after.body, /class="map-marker"[^]*?<circle cx="381" cy="61"/)

  const moved = await request('POST', '/api/location', 'location.x=100&location.y=300', {
    cookie,
  })
  assert.equal(moved.statusCode, 303)
  assert.equal(await storedLocation('Lars'), 'POINT(-129.5 -60.5)')
  assert.match((await request('GET', '/Lars/edit', '', { cookie })).body, /60\.5° S, 129\.5° W/)

  const removed = await request('POST', '/api/location', 'clear=1', { cookie })
  assert.equal(removed.statusCode, 303)
  assert.equal(removed.location, '/Lars/edit#location')
  assert.equal(await storedLocation('Lars'), null)
  assert.match((await request('GET', '/Lars/edit', '', { cookie })).body, /You haven't set/)
})

test('locations are snapped to the grid, validated, and shown only to their owner', async () => {
  const cookie = await createSession('Lars')
  const adaCookie = await createSession('Ada')

  const precise = await sendJson('/api/location', { lat: 59.91234, lon: 10.75678 }, { cookie })
  assert.equal(precise.statusCode, 200)
  assert.deepEqual(JSON.parse(precise.body), { location: { lat: 59.5, lon: 10.5 } })

  // The edges of the world.
  const corner = await sendJson('/api/location', { lat: 90, lon: 180 }, { cookie })
  assert.deepEqual(JSON.parse(corner.body), { location: { lat: 89.5, lon: -179.5 } })

  // A keyboard "click" on the image sends 0,0: the form comes back with the error.
  const keyboard = await request('POST', '/api/location', 'location.x=0&location.y=0', { cookie })
  assert.equal(keyboard.statusCode, 400)
  assert.match(keyboard.body, /Click a spot on the map\./)
  assert.match(keyboard.body, /<h1>Edit profile: Lars<\/h1>/)

  const invalid: [Record<string, unknown>, string][] = [
    [{ 'location.x': 720, 'location.y': 10 }, 'location'],
    [{ 'location.x': '5', 'location.y': '-1' }, 'location'],
    [{ 'location.x': '1.5', 'location.y': '10' }, 'location'],
    [{ lat: 91, lon: 0 }, 'lat'],
    [{ lat: '', lon: 0 }, 'lat'],
    [{ lat: 0, lon: 'east' }, 'lon'],
    [{}, 'lat'],
  ]
  for (const [body, field] of invalid) {
    const response = await sendJson('/api/location', body, { cookie })
    assert.equal(response.statusCode, 400, JSON.stringify(body))
    assert.equal(JSON.parse(response.body).errors[0].field, field, JSON.stringify(body))
  }
  assert.equal(await storedLocation('Lars'), 'POINT(-179.5 89.5)')

  // The owner sees it on the edit page; nobody sees it on the profile, not even the owner.
  const edit = JSON.parse((await request('GET', '/Lars/edit', '', { ...json, cookie })).body)
  assert.deepEqual(edit.location, { lat: 89.5, lon: -179.5 })
  for (const headers of [{ cookie }, { cookie: adaCookie }, {}]) {
    const profile = await request('GET', '/Lars/', '', { ...json, ...headers })
    assert.doesNotMatch(profile.body, /location|"lat"|"lon"|89\.5/)
  }

  const cleared = await sendJson('/api/location', { clear: true }, { cookie })
  assert.deepEqual(JSON.parse(cleared.body), { location: null })
  assert.equal((await sendJson('/api/location', { lat: 1, lon: 1 })).statusCode, 401)

  // The database refuses anything but a cell centre, whatever the app does.
  await assert.rejects(
    db().query(
      `UPDATE user_profiles SET location = ST_SetSRID(ST_MakePoint(10.75, 59.91), 4326)::geography`,
    ),
    /user_profiles_location_grid/,
  )
})

test('"blurts near you" lists blurts from people within the radius, without JS', async () => {
  const cookie = await createSession('Lars')
  for (const name of ['Ada', 'Bob', 'Zed']) {
    await createSession(name)
  }
  await placeAt('Lars', 59.5, 10.5) // Oslo
  await placeAt('Ada', 59.5, 11.5) // about 56 km away
  await placeAt('Bob', 59.5, 18.5) // Stockholm, about 450 km away
  await insertBlurt('Lars', 'my own blurt', new Date())
  await insertBlurt('Ada', 'hello from next door', new Date())
  await insertBlurt('Bob', 'hello from Stockholm', new Date())
  await insertBlurt('Zed', 'hello from nowhere', new Date())

  const near = async (query: string) => {
    const response = await request('GET', `/near${query}`, '', { ...json, cookie })
    assert.equal(response.statusCode, 200, query)
    return JSON.parse(response.body)
  }
  const texts = (data: { blurts: { text: string }[] }) => data.blurts.map((blurt) => blurt.text)

  const nearby = await near('')
  assert.deepEqual(nearby.location, { lat: 59.5, lon: 10.5 })
  assert.equal(nearby.radius, 250)
  assert.deepEqual(nearby.radii, [50, 100, 250, 500, 1000, 2500])
  assert.deepEqual(texts(nearby), ['hello from next door'])
  assert.deepEqual(texts(await near('?radius=500')), [
    'hello from Stockholm',
    'hello from next door',
  ])
  assert.deepEqual(texts(await near('?radius=50')), [])

  const html = await request('GET', '/near?radius=500', '', { cookie })
  assert.match(html.body, /<form method="get" action="\/near"/)
  assert.match(html.body, /10\.5° E\. <a href="\/Lars\/edit#location">Change your location<\/a>/)
  assert.match(html.body, /<option value="500" selected>500 km<\/option>/)
  assert.match(html.body, /hello from Stockholm/)
  assert.doesNotMatch(html.body, /hello from nowhere|my own blurt/)

  const markdown = await request('GET', '/near', '', { accept: 'text/markdown', cookie })
  assert.match(markdown.body, /^# Blurts near you\n[^]*within 250 km of 59\\?\.5° N, 10\.5° E/)
  assert.match(markdown.body, /### Ada\n/)

  assert.equal((await request('GET', '/near?radius=7', '', { cookie })).statusCode, 400)
  assert.equal((await request('GET', '/near?radius=abc', '', json)).statusCode, 401)
  assert.equal((await request('GET', '/near', '', json)).statusCode, 401)

  // Without a location there is nothing to be near.
  const zedCookie = (
    await request('POST', '/login', 'username=Zed&password=correct-horse')
  ).setCookie?.[0]?.split(';', 1)[0]
  const zed = await request('GET', '/near', '', { cookie: zedCookie ?? '' })
  assert.match(zed.body, /<input type="hidden" name="return" value="near"\/>/)
  assert.match(zed.body, /<input type="image" name="location"/)

  // Paging keeps the radius, as a plain link.
  await db().query(
    `INSERT INTO blurts (user_id, text, created_at)
     SELECT u.id, 'old ' || i, timestamptz '2020-01-01' + i * interval '1 minute'
     FROM users u, generate_series(1, 100) AS i WHERE u.username = 'Ada'`,
  )
  const first = await near('?radius=100')
  assert.equal(first.blurts.length, 100)
  const page = await request('GET', '/near?radius=100', '', { cookie })
  assert.match(page.body, /<a href="\/near\?radius=100&amp;before=[^"]+" rel="next">Older blurts/)
  assert.deepEqual(texts(await near(`?radius=100&before=${first.next}`)), ['old 1'])
})

test('setting a location also sets the time zone of that place, removing it keeps the zone', async () => {
  const cookie = await createSession('Lars')
  const zone = async () =>
    (
      await db().query(
        `SELECT p.timezone FROM user_profiles p JOIN users u ON u.id = p.user_id WHERE u.username = 'Lars'`,
      )
    ).rows[0].timezone

  assert.equal(await zone(), null)
  const oslo = await request('POST', '/api/location', 'location.x=381&location.y=60', { cookie })
  assert.equal(await zone(), 'Europe/Oslo')
  assert.ok(oslo.headers['set-cookie']?.some((header) => header.startsWith('access_token=')))

  await request('POST', '/api/location', 'lat=-33.8688&lon=151.2093', { cookie })
  assert.equal(await zone(), 'Australia/Sydney')

  await request('POST', '/api/location', 'clear=1', { cookie })
  assert.equal(await zone(), 'Australia/Sydney')
})
