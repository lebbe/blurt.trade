import { Router } from 'express'
import { requireAdmin } from '../middleware/auth.ts'
import { represent, sendError, sendFormSuccess } from '../negotiate.ts'
import { parseBlurtId } from './blurts.ts'
import { dismissReports, listOpenReports } from './state.ts'
import { renderAdminReportsPage } from '../templates/index.ts'
import { adminReportsMarkdown } from '../templates/pages.md.ts'

// Moderation, for users with users.is_admin (set by hand, see docs/routes.md). Deleting a
// reported blurt is POST /api/blurts/:id/delete, which admins may use on any blurt.
export const adminRouter = Router()

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
