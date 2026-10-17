import { Router, type Request, type Response } from 'express'
import { getViewer } from '../middleware/auth.ts'
import { isAdmin, getBlurt } from './state.ts'
import { cachedOgPng, debugOgPage, debugOgPng, ogHash, renderOgPng, type OgInput } from '../og.ts'
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

ogRouter.get('/og/:filename', async (request, response) => {
  const match = /^(\d{1,15})-([a-f0-9]{64})\.png$/.exec(request.params.filename)
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
  const input: OgInput = {
    text: blurt.text,
    username: blurt.username,
    avatar: blurt.avatar,
    style: blurt.text === 'BLURT' ? 'blurt' : 'post',
  }
  const hash = ogHash(input)
  if (hash !== match[2]) {
    response.redirect(301, `/og/${id}-${hash}.png`)
    return
  }
  const debug = request.query.debug === '1' && (await debugAllowed(request))
  if (debug) {
    response
      .set('Cache-Control', 'no-store')
      .type('image/png')
      .send(await renderOgPng(input, true))
    return
  }
  const image = await cachedOgPng(`${id}-${hash}`, () => renderOgPng(input))
  response.set('Cache-Control', 'public, max-age=31536000, immutable').type('image/png').send(image)
})
