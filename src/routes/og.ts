import { Router, type Request, type Response } from 'express'
import { getViewer } from '../middleware/auth.ts'
import { getBlurt, getCardColor, getUserProfileByUsername, isAdmin } from './state.ts'
import { isCardColor, type CardColorId } from '../card-colors.ts'
import {
  blurtOgInput,
  cachedOgPng,
  debugOgPage,
  debugOgPng,
  ogHash,
  ogImagePath,
  ogProfileImagePath,
  profileCardText,
  renderOgPng,
  type OgInput,
} from '../og.ts'
import { parseBlurtId } from './blurts.ts'

export const ogRouter = Router()

async function debugAllowed(request: Request): Promise<boolean> {
  if (process.env.NODE_ENV !== 'production') {
    return true
  }
  const viewer = getViewer(request)
  return viewer ? isAdmin(viewer.id) : false
}

function notFound(response: Response): void {
  response.status(404).type('text/plain').send('Not found')
}

ogRouter.get('/debug/og', async (request, response) => {
  if (!(await debugAllowed(request))) {
    notFound(response)
    return
  }
  response.set('Cache-Control', 'no-store').type('html').send(debugOgPage())
})

ogRouter.get('/og/debug/:id.png', async (request, response) => {
  if (!(await debugAllowed(request))) {
    notFound(response)
    return
  }
  const image = await debugOgPng(request.params.id, request.query.debug === '1')
  if (!image) {
    notFound(response)
    return
  }
  response.set('Cache-Control', 'no-store').type('image/png').send(image)
})

// ?color=<id> on a link to the image overrides the card's background. The file name's hash
// is the one of the stored colour, so the same link keeps working with any override, and
// the override is part of the cache key.
function colorOverride(request: Request): CardColorId | undefined {
  const { color } = request.query
  return isCardColor(color) ? color : undefined
}

function withQuery(path: string, color: CardColorId | undefined): string {
  return color ? `${path}?color=${color}` : path
}

async function sendCard(
  request: Request,
  response: Response,
  input: OgInput,
  cacheKey: string,
): Promise<void> {
  if (request.query.debug === '1' && (await debugAllowed(request))) {
    response
      .set('Cache-Control', 'no-store')
      .type('image/png')
      .send(await renderOgPng(input, true))
    return
  }
  const image = await cachedOgPng(cacheKey, () => renderOgPng(input))
  response.set('Cache-Control', 'public, max-age=31536000, immutable').type('image/png').send(image)
}

ogRouter.get('/og/u/:username/:filename', async (request, response) => {
  const match = /^([a-f0-9]{64})\.png$/.exec(request.params.filename)
  const profile = match ? await getUserProfileByUsername(request.params.username) : undefined
  const text = profile ? profileCardText(profile.bio) : ''
  if (!match || !profile || !text) {
    notFound(response)
    return
  }
  const stored: OgInput = {
    text,
    username: profile.username,
    avatar: profile.avatar,
    color: profile.cardColor,
  }
  const hash = ogHash(stored)
  const override = colorOverride(request)
  if (hash !== match[1] || profile.username !== request.params.username) {
    response.redirect(301, withQuery(ogProfileImagePath(profile.username, hash), override))
    return
  }
  const input = override ? { ...stored, color: override } : stored
  await sendCard(
    request,
    response,
    input,
    `u-${profile.userId}-${hash}${override ? `-${override}` : ''}`,
  )
})

ogRouter.get('/og/:filename', async (request, response) => {
  const match = /^(\d{1,15})(?:-([a-f0-9]{64}))?\.png$/.exec(request.params.filename)
  const id = match ? parseBlurtId(match[1]) : undefined
  if (!match || id === undefined) {
    notFound(response)
    return
  }
  const blurt = await getBlurt(id)
  if (!blurt || blurt.id !== id || blurt.deleted || !blurt.username || !blurt.text) {
    notFound(response)
    return
  }
  const stored = blurtOgInput(
    { text: blurt.text, username: blurt.username, avatar: blurt.avatar },
    await getCardColor(blurt.username),
  )
  const hash = ogHash(stored)
  const override = colorOverride(request)
  if (hash !== match[2]) {
    // A stale hash gets a permanent redirect, a missing one (a hand-written link) a temporary one.
    response.redirect(match[2] ? 301 : 302, withQuery(ogImagePath(id, hash), override))
    return
  }
  const input = override && stored.style !== 'blurt' ? { ...stored, color: override } : stored
  await sendCard(request, response, input, `${id}-${hash}${input === stored ? '' : `-${override}`}`)
})
