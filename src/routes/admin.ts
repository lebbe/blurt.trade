import { Router } from 'express'
import { requireAdmin } from '../middleware/auth.ts'
import { represent, sendError, sendFormSuccess, wantsJson } from '../negotiate.ts'
import { parseBlurtId } from './blurts.ts'
import { accountKey, rateLimit } from '../middleware/rate-limit.ts'
import {
  deleteBlurts,
  dismissReports,
  getBlurt,
  getUserByUsername,
  listOpenReports,
  mintInviteCodes,
} from './state.ts'
import { renderAdminReportsPage, renderAdminToolsPage } from '../templates/index.ts'
import { adminReportsMarkdown, adminToolsMarkdown } from '../templates/pages.md.ts'

const maxMintedCodes = 1000

// Moderation, for users with users.is_admin (set by hand, see docs/routes.md). Deleting a
// reported blurt is POST /api/blurts/:id/delete, which admins may use on any blurt.
export const adminRouter = Router()

// The forms for the admin APIs below.
adminRouter.get('/admin', requireAdmin, (request, response) => {
  represent(
    request,
    response,
    { viewer: response.locals.authenticatedUser },
    { html: renderAdminToolsPage, markdown: adminToolsMarkdown },
  )
})

adminRouter.get('/admin/reports', requireAdmin, async (request, response) => {
  represent(
    request,
    response,
    { viewer: response.locals.authenticatedUser, reports: await listOpenReports() },
    { html: renderAdminReportsPage, markdown: adminReportsMarkdown },
  )
})

// The blurt stays up, and its open reports leave the list.
adminRouter.post('/api/admin/reports/dismiss', requireAdmin, async (request, response) => {
  const blurtId = parseBlurtId(request.body?.blurtId)
  if (blurtId === undefined) {
    sendError(request, response, 404, 'Blurt not found')
    return
  }
  await dismissReports(blurtId)
  sendFormSuccess(request, response, { redirect: '/admin/reports' })
})

// Like /api/blurts/:id/delete, for an id typed into a form.
adminRouter.post('/api/admin/blurts/delete', requireAdmin, async (request, response) => {
  const blurtId = parseBlurtId(request.body?.blurtId)
  const blurt = blurtId === undefined ? undefined : await getBlurt(blurtId)
  if (!blurt || blurt.deleted) {
    sendError(request, response, 404, 'Blurt not found')
    return
  }
  await deleteBlurts([blurt.id])
  sendFormSuccess(request, response, { redirect: '/admin' })
})

// Mints codes owned by an existing user, like `node db/mint-invites.ts`. Forms get the
// admin page back with the codes on it; JSON gets { codes }.
adminRouter.post(
  '/api/admin/invites',
  requireAdmin,
  rateLimit('mintInvites', accountKey),
  async (request, response) => {
    const username = String(request.body?.username ?? '').trim()
    const count = Number(request.body?.count)
    const daysInput = String(request.body?.days ?? '').trim()
    const days = daysInput === '' ? undefined : Number(daysInput)
    if (!Number.isInteger(count) || count < 1 || count > maxMintedCodes) {
      sendError(request, response, 400, `Count must be a whole number from 1 to ${maxMintedCodes}`)
      return
    }
    if (days !== undefined && !(days > 0 && days <= 36_500)) {
      sendError(request, response, 400, 'Days until expiry must be a positive number')
      return
    }
    const user = await getUserByUsername(username)
    if (!user) {
      sendError(request, response, 404, 'User not found')
      return
    }
    const expiresAt = days === undefined ? null : new Date(Date.now() + days * 86_400_000)
    const codes = await mintInviteCodes(user.id, count, expiresAt)
    if (wantsJson(request)) {
      response.status(201).json({ username: user.username, codes })
      return
    }
    response.status(201).type('html').send(
      renderAdminToolsPage({
        viewer: response.locals.authenticatedUser,
        minted: { username: user.username, codes },
      }),
    )
  },
)
