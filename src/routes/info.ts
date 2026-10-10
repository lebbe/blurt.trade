import { Router, type Request, type Response } from 'express'
import { contact } from '../config.ts'
import { getViewer } from '../middleware/auth.ts'
import { represent, type Views } from '../negotiate.ts'
import {
  renderAboutPage,
  renderPrivacyPage,
  renderTermsPage,
  type InfoPageData,
} from '../templates/index.ts'
import { aboutMarkdown, privacyMarkdown, termsMarkdown } from '../templates/pages.md.ts'

export const infoRouter = Router()

// About, terms and privacy: fixed text, linked from every page's footer. The data is only
// the viewer and the contact from the environment (CONTACT_EMAIL, CONTACT_REPO_URL), so
// the privacy page has to be kept in step with what the database stores by hand.
function infoPage(views: Views<InfoPageData>) {
  return (request: Request, response: Response) => {
    represent(request, response, { viewer: getViewer(request), contact: contact() }, views)
  }
}

infoRouter.get('/about', infoPage({ html: renderAboutPage, markdown: aboutMarkdown }))
infoRouter.get('/terms', infoPage({ html: renderTermsPage, markdown: termsMarkdown }))
infoRouter.get('/privacy', infoPage({ html: renderPrivacyPage, markdown: privacyMarkdown }))
