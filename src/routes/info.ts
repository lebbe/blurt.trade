import { Router, type Request, type Response } from 'express'
import { contact } from '../config.ts'
import { getViewer } from '../middleware/auth.ts'
import { represent, type Views } from '../negotiate.ts'
import { isInviteOnly } from './state.ts'
import type { InfoPageData } from '../pages/info/data.ts'
import { renderAboutPage, renderPrivacyPage, renderTermsPage } from '../pages/info/info.html.ts'
import { aboutMarkdown, privacyMarkdown, termsMarkdown } from '../pages/info/info.md.ts'

export const infoRouter = Router()

// About, terms and privacy: fixed text, linked from every page's footer. The data is only
// the viewer and the contact from the environment (CONTACT_EMAIL, CONTACT_REPO_URL), so
// the privacy page has to be kept in step with what the database stores by hand.
function infoPage(views: Views<InfoPageData>) {
  return async (request: Request, response: Response) => {
    const data = {
      viewer: getViewer(request),
      contact: contact(),
      inviteOnly: await isInviteOnly(),
    }
    await represent(request, response, data, views)
  }
}

infoRouter.get('/about', infoPage({ html: renderAboutPage, markdown: aboutMarkdown }))
infoRouter.get('/terms', infoPage({ html: renderTermsPage, markdown: termsMarkdown }))
infoRouter.get('/privacy', infoPage({ html: renderPrivacyPage, markdown: privacyMarkdown }))
