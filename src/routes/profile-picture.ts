import { Router, type Request, type Response } from 'express'
import { cutImageSize, maxPictureCut, minPictureCut } from '../avatar.ts'
import { clearSessionCookies, requireAuth } from '../middleware/auth.ts'
import { accountKey, rateLimit } from '../middleware/rate-limit.ts'
import {
  type FieldError,
  sendError,
  sendFormErrors,
  sendFormSuccess,
  wantsJson,
} from '../negotiate.ts'
import type { PicturePart } from '../shared/avatar.ts'
import { photoPartSvg } from '../shared/picture/svg.ts'
import { drawUpload, uploadPicture } from './picture-upload.ts'
import { getNotificationSettings } from './state/notifications.ts'
import {
  getLocation,
  getProfilePicture,
  getUserProfileByUsername,
  setPictureCut,
  setProfilePicture,
} from './state/profiles.ts'
import { renderProfileEditPage } from '../pages/profile-edit/profile-edit.html.ts'

export const profilePictureRouter = Router()

function isGiven(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '' && value !== false
}

// A number from a form field (string) or JSON (number). Undefined if it isn't one.
function toNumber(value: unknown): number | undefined {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  return typeof number === 'number' && Number.isFinite(number) ? number : undefined
}

function clampCut(percent: number): number {
  return Math.min(maxPictureCut, Math.max(minPictureCut, Math.round(percent)))
}

// The body of POST /api/profile-picture/cut: `cut.x` + `cut.y` (a click on the picture,
// only the height counts, near the edges it is pulled in to minPictureCut–maxPictureCut)
// or `cut` (JSON, or a form field: percent from the top, in that range).
export function parseCutInput(body: unknown): { cut: number } | { error: FieldError } {
  const values = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
  if (isGiven(values['cut.x']) || isGiven(values['cut.y'])) {
    const x = toNumber(values['cut.x'])
    const y = toNumber(values['cut.y'])
    // Activating the image from the keyboard submits 0,0: no real click.
    if (x === 0 && y === 0) {
      return { error: { field: 'cut', message: 'Click the picture where the mouth is.' } }
    }
    if (
      x === undefined ||
      y === undefined ||
      !Number.isInteger(x) ||
      !Number.isInteger(y) ||
      x < 0 ||
      y < 0 ||
      x >= cutImageSize ||
      y >= cutImageSize
    ) {
      return { error: { field: 'cut', message: 'That spot is outside the picture.' } }
    }
    return { cut: clampCut((y * 100) / cutImageSize) }
  }
  const cut = toNumber(values.cut)
  if (cut === undefined || !Number.isInteger(cut) || cut < minPictureCut || cut > maxPictureCut) {
    return {
      error: {
        field: 'cut',
        message: `The cut must be a whole number from ${minPictureCut} to ${maxPictureCut}.`,
      },
    }
  }
  return { cut }
}

// The edit page again, with `pictureError` in the profile picture panel.
async function sendPictureErrors(request: Request, response: Response, errors: FieldError[]) {
  const viewer = response.locals.authenticatedUser
  const profile = await getUserProfileByUsername(viewer.username)
  if (!profile) {
    sendError(request, response, 404, 'User not found')
    return
  }
  const location = await getLocation(viewer.id)
  const notifications = await getNotificationSettings(viewer.id)
  await sendFormErrors(request, response, errors, (pictureError) =>
    renderProfileEditPage({ viewer, profile, location, notifications, pictureError }),
  )
}

// After a change: forms go back to the edit page, which shows it; JSON callers get
// `{ avatar }`, the avatar as it is shown (with `photo` while there is a picture).
async function sendPictureSuccess(request: Request, response: Response, saved: boolean) {
  const viewer = response.locals.authenticatedUser
  const profile = saved ? await getUserProfileByUsername(viewer.username) : undefined
  if (!profile) {
    // A still-valid token for a user that no longer exists (e.g. after a database reset).
    clearSessionCookies(response)
    if (wantsJson(request)) {
      sendError(request, response, 401, 'Authentication required')
    } else {
      response.redirect(303, '/')
    }
    return
  }
  sendFormSuccess(request, response, {
    redirect: `/${viewer.username}/edit#picture`,
    data: { avatar: profile.avatar },
  })
}

// Uploads a profile picture (multipart, the file in `picture`, and optionally `cut`, where
// its mouth opens), or removes it (`remove`). The upload is cropped square (its middle;
// with JavaScript the browser crops it where the person chose and uploads that square)
// and redrawn like a blurt's picture; only the drawing is kept. While there is one, it is
// shown instead of the cartoon avatar.
profilePictureRouter.post(
  '/api/profile-picture',
  requireAuth,
  rateLimit('profilePicture', accountKey),
  uploadPicture,
  async (request, response) => {
    const viewer = response.locals.authenticatedUser
    if (isGiven(request.body?.remove)) {
      await sendPictureSuccess(request, response, await setProfilePicture(viewer.id, null))
      return
    }
    if (!request.file) {
      await sendPictureErrors(request, response, [
        { field: 'picture', message: 'Choose a picture to upload.' },
      ])
      return
    }
    // Where its mouth opens, chosen before the upload (with JavaScript, the picture is
    // previewed in the browser first, src/client/picture-upload.ts). Without it, the cut
    // stays where it was, and is set by clicking the picture afterwards.
    let cut: number | undefined
    if (isGiven(request.body?.cut)) {
      const input = parseCutInput({ cut: request.body.cut })
      if ('error' in input) {
        await sendPictureErrors(request, response, [input.error])
        return
      }
      cut = input.cut
    }
    const drawn = await drawUpload(request, response, request.file, { square: true })
    if (!drawn) {
      return
    }
    if ('error' in drawn) {
      await sendPictureErrors(request, response, [drawn.error])
      return
    }
    await sendPictureSuccess(
      request,
      response,
      await setProfilePicture(viewer.id, drawn.picture.shapes, cut),
    )
  },
)

// Where the picture is cut apart to talk: a click on the picture on the edit page (no JS,
// like the location map), or `cut` in percent from the top.
profilePictureRouter.post(
  '/api/profile-picture/cut',
  requireAuth,
  rateLimit('avatar', accountKey),
  async (request, response) => {
    const input = parseCutInput(request.body)
    if ('error' in input) {
      await sendPictureErrors(request, response, [input.error])
      return
    }
    const viewer = response.locals.authenticatedUser
    await sendPictureSuccess(request, response, await setPictureCut(viewer.id, input.cut))
  },
)

// The parts of a profile picture, as SVG (photoUrl in src/avatar.ts): `top` and `jaw`, the
// halves above and below the cut, which the page stacks as two images and flaps apart to
// talk, and `edit`, the whole picture with the cut drawn on it. The URL holds the version
// (an old one is a 404) and the cut, so each URL always gives the same SVG and can be
// cached for ever. No auth: like the avatar, it is public.
profilePictureRouter.get('/profile-pictures/:file', async (request, response) => {
  const match = /^(\d{1,15})-(\d{1,9})-(\d{1,2})-(top|jaw|edit)\.svg$/.exec(request.params.file)
  const cut = match ? Number(match[3]) : NaN
  const shapes =
    match && cut >= minPictureCut && cut <= maxPictureCut
      ? await getProfilePicture(Number(match[1]), Number(match[2]))
      : undefined
  if (!match || !shapes) {
    sendError(request, response, 404, 'Not found')
    return
  }
  const svg = photoPartSvg(shapes, cut, match[4] as PicturePart)
  response
    .set('Cache-Control', 'public, max-age=31536000, immutable')
    .type('image/svg+xml')
    .send(svg)
})
